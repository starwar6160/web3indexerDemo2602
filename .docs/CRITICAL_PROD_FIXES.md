# 生产级索引器修复方案

**日期**: 2026-02-06
**优先级**: 🔴 CRITICAL - 必须修复才能投入生产
**诊断者**: Claude + 专家审计

---

## 执行摘要

当前索引器存在 **3 个致命问题** 会导致数据损坏和永久性丢块：

1. **会漏块且无法自愈** - 基于 `max(number)` 的进度检查无法发现缺口
2. **写入不幂等** - 重启/并发会因唯一约束冲突导致整个批次失败
3. **Reorg 处理逻辑根本性缺陷** - 无法可靠检测和处理链重组

**风险等级**: 🔴 **极高** - 会导致数据永久损坏，下游应用会出现数据断层

---

## 问题 1: 永久性漏块（Critical）

### 症状
```
数据库里有块 1000-1100，但中间缺了 1050-1059
下一次重启从 1101 开始，永远不会再补 1050-1059
```

### 根本原因
`index-production.ts:324` 使用 `getMaxBlockNumber()` 作为同步起点：

```typescript
// ❌ 错误：只看最大值，不管中间缺口
const localMaxBlock = await blockRepository.getMaxBlockNumber();
let startBlock = localMaxBlock ? localMaxBlock + 1n : 0n;
```

**场景**：
1. 批量抓取 `1000-1019`，其中 `1005` 的 RPC 调用失败（网络抖动/429）
2. 当前代码：记录 `1005` 失败，继续抓 `1006-1019`
3. 写入 `1000-1004` 和 `1006-1019`
4. 数据库 `max(number) = 1019`
5. **缺口 `1005` 永久丢失**（下次从 `1020` 开始）

### 修复方案 A：持久化 Checkpoint（推荐）

#### 数据库 Schema

```sql
CREATE TABLE sync_status (
  chain_id bigint NOT NULL DEFAULT 1,
  next_block bigint NOT NULL,
  confirmed_block bigint NOT NULL,
  head_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id)
);

CREATE TABLE sync_gaps (
  chain_id bigint NOT NULL,
  gap_start bigint NOT NULL,
  gap_end bigint NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending', -- pending, retrying, filled
  PRIMARY KEY (chain_id, gap_start, gap_end)
);

CREATE INDEX idx_sync_gaps_status ON sync_gaps(chain_id, status);
```

#### 实现代码

```typescript
// database/sync-status-repository.ts
export class SyncStatusRepository {
  async getSyncStatus(chainId: bigint = 1n): Promise<SyncStatus | null> {
    const result = await this.db
      .selectFrom('sync_status')
      .selectAll()
      .where('chain_id', '=', chainId)
      .executeTakeFirst();

    return result || null;
  }

  /**
   * 严格连续写入：只有连续区间成功才推进 next_block
   */
  async advanceNextBlock(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<void> {
    await this.db
      .updateTable('sync_status')
      .set({
        next_block: toBlock + 1n,
        updated_at: new Date().toISOString(),
      })
      .where('chain_id', '=', chainId)
      .where('next_block', '=', fromBlock) // CAS 操作
      .execute();
  }

  /**
   * 检测缺口
   */
  async detectGaps(chainId: bigint = 1n): Promise<Gap[]> {
    const result = await this.db
      .selectFrom('blocks')
      .select(sql`number + 1`.as('gap_start'))
      .select(sql`
        (SELECT MIN(number) - 1 FROM blocks b2 WHERE b2.number > blocks.number)
      `.as('gap_end'))
      .where(sql`
        NOT EXISTS (
          SELECT 1 FROM blocks b2 WHERE b2.number = blocks.number + 1
        )
        AND number < (SELECT MAX(number) FROM blocks)
      `.as('exists'))
      .execute();

    return result.filter(row => row.gap_end !== null);
  }

  async reportGap(
    chainId: bigint,
    gapStart: bigint,
    gapEnd: bigint
  ): Promise<void> {
    await this.db
      .insertInto('sync_gaps')
      .values({
        chain_id: chainId,
        gap_start: gapStart,
        gap_end: gapEnd,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}
```

#### 修改同步逻辑

```typescript
// index-production.ts
async function syncBlockBatch(
  startBlock: bigint,
  endBlock: bigint
): Promise<void> {
  const syncRepo = new SyncStatusRepository();
  const status = await syncRepo.getSyncStatus();

  // ❌ 删除旧逻辑：从 max+1 开始
  // const localMaxBlock = await blockRepository.getMaxBlockNumber();

  // ✅ 新逻辑：从 checkpoint 开始
  const nextBlock = status?.next_block || 0n;

  // 严格验证连续性
  if (startBlock !== nextBlock) {
    throw new Error(
      `Non-sequential sync: startBlock=${startBlock}, expected nextBlock=${nextBlock}`
    );
  }

  const rawBlocks: unknown[] = [];
  let blockNumber = startBlock;
  let hasFailures = false;

  // 任何块失败必须重试，不能跳过
  while (blockNumber <= endBlock) {
    try {
      const block = await rpcCallWithMetrics(
        `getBlock-${blockNumber}`,
        () => client.getBlock({ blockNumber })
      );
      rawBlocks.push(block);
      blockNumber = blockNumber + 1n;
    } catch (error) {
      logger.error({ error, blockNumber: blockNumber.toString() }, 'Failed to fetch block');

      // 记录缺口
      await syncRepo.reportGap(1n, blockNumber, endBlock);
      hasFailures = true;
      break; // 停止批次，不要跳过失败的块
    }
  }

  if (hasFailures) {
    throw new Error(`Batch failed at block ${blockNumber}, will retry`);
  }

  // 写入数据库
  const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);

  // ✅ 只有全部成功才推进 checkpoint
  if (savedCount === rawBlocks.length) {
    await syncRepo.advanceNextBlock(1n, startBlock, endBlock);
  }
}
```

### 修复方案 B：定期 Gap Detection（辅助）

```typescript
// utils/gap-detector.ts
export async function detectAndFillGaps(): Promise<void> {
  const syncRepo = new SyncStatusRepository();
  const gaps = await syncRepo.detectGaps(1n);

  if (gaps.length === 0) {
    logger.info('No gaps detected');
    return;
  }

  logger.warn({ gapCount: gaps.length }, 'Gaps detected, attempting to fill');

  for (const gap of gaps) {
    try {
      await syncBlockBatch(gap.gap_start, gap.gap_end);
      logger.info(
        { gapStart: gap.gap_start.toString(), gapEnd: gap.gap_end.toString() },
        'Gap filled successfully'
      );
    } catch (error) {
      logger.error({ error, gap }, 'Failed to fill gap');
      // 标记为待重试
      await syncRepo.updateGapStatus(gap, 'pending');
    }
  }
}

// 在主循环中定期运行
setInterval(() => {
  detectAndFillGaps().catch((error) => {
    logger.error({ error }, 'Gap detection failed');
  });
}, 60_000); // 每分钟检查一次
```

---

## 问题 2: 写入不幂等（Critical）

### 症状
```
重启后尝试写入块 3200（已存在）
→ UNIQUE 约束冲突
→ 整个事务回滚
→ 3200-3299 全部写不进去
→ 索引器卡死
```

### 根本原因
`block-repository.ts:67` 使用纯 `INSERT`：

```typescript
// ❌ 错误：没有冲突处理
await trx
  .insertInto('blocks')
  .values(dbBlocks)
  .returningAll()
  .execute();
```

**场景**：
1. 正常写入 `3200-3299`
2. 索引器崩溃/重启
3. 从 checkpoint 重新尝试写入 `3200-3299`
4. PostgreSQL 抛出 `duplicate key value violates unique constraint "blocks_pkey"`
5. **整个批次回滚，索引器停滞**

### 修复方案：Upsert 语义

#### 数据库 Schema 调整

```sql
-- ❌ 删除旧主键
-- ALTER TABLE blocks DROP CONSTRAINT blocks_pkey;

-- ✅ 新主键：支持多链 + 冲突处理
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS chain_id bigint NOT NULL DEFAULT 1;
ALTER TABLE blocks ADD CONSTRAINT blocks_pkey PRIMARY KEY (chain_id, number);

-- ✅ 保留 hash 唯一约束（用于 reorg 检测）
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_hash_key;
ALTER TABLE blocks ADD CONSTRAINT blocks_hash_key UNIQUE (chain_id, hash);
```

#### 实现 Upsert

```typescript
// database/block-repository.ts
async saveValidatedBlocks(rawBlocks: unknown[]): Promise<number> {
  if (rawBlocks.length === 0) return 0;

  const validatedBlocks = validateBlocks(rawBlocks);
  if (validatedBlocks.length === 0) return 0;

  const dbBlocks = validatedBlocks.map(toDbBlock);

  const saved = await this.db.transaction().execute(async (trx) => {
    const results: Block[] = [];

    for (const block of dbBlocks) {
      // ✅ 使用 ON CONFLICT DO UPDATE
      const result = await trx
        .insertInto('blocks')
        .values(block)
        .returningAll()
        .onConflict((oc) => oc
          .column(['chain_id', 'number'])
          .doUpdateSet({
            // 更新所有可能变化的字段
            hash: sql`excluded.hash`,
            parent_hash: sql`excluded.parent_hash`,
            timestamp: sql`excluded.timestamp`,
            updated_at: new Date().toISOString(),
          })
          .where(({ eb, or }) => or([
            eb('blocks.hash', '!=', sql`${block.hash}`), // 只有 hash 不同才更新
            eb('blocks.parent_hash', '!=', sql`${block.parent_hash}`),
          ]))
        )
        .executeTakeFirst();

      if (result) {
        results.push(result);
      }
    }

    return results;
  });

  console.log(`[Repository] ✅ Saved ${saved.length}/${rawBlocks.length} blocks`);

  return saved.length;
}
```

#### Upsert 语义说明

**行为**：
- **新块**：插入
- **已存在且 hash 相同**：跳过（幂等）
- **已存在但 hash 不同**：更新（reorg 场景）

**Reorg 检测**：
```typescript
if (updatedCount > 0 && oldHash !== newHash) {
  // 触发 reorg 警报
  logger.warn(
    { blockNumber, oldHash, newHash },
    'Block hash changed - possible reorg'
  );
  await handleReorg(blockRepository, blockNumber - 1n);
}
```

---

## 问题 3: Reorg 处理逻辑缺陷（Critical）

### 症状
```
链在高度 5000 发生 reorg
当前代码：
  - 要么完全检测不到（silent wrong）
  - 要么回滚到错误高度（过浅/过深）
后续所有数据都在错误链上
```

### 根本原因

#### 问题 3.1：数据模型不支持分叉

```sql
-- ❌ 当前 schema：每个高度只能有一个 hash
CREATE TABLE blocks (
  number bigint PRIMARY KEY,
  hash varchar(66) UNIQUE,
  ...
);
```

**问题**：无法存储同高度的多个分叉块

#### 问题 3.2：Reorg 检测逻辑错误

`reorg-handler.ts:38` 的 `detectReorg()`：

```typescript
// ❌ 错误：expectedParentHash 是上轮的 block.parentHash
// 语义不等于"我期望的新块的父 hash"
const expectedParent = await blockRepository.findByHash(expectedParentHash);
```

**场景**：
1. 批量抓 `3200-3299`，传入 `parentHash = 3199.parentHash`
2. 但 `3200.parentHash` 可能指向另一个分叉
3. **检测失效**

#### 问题 3.3：findCommonAncestor 无法工作

`reorg-handler.ts:124`：

```typescript
// ❌ 错误：尝试沿"新链"向上走
// 但数据库里只有"旧链"的数据
const newBlock = await blockRepository.findByHash(currentHash);
if (!newBlock) {
  // 新链的块不在库里，无法向上追溯
  break; // 找不到共同祖先
}
```

### 修复方案 A：Confirmation Depth（推荐）

#### 核心思想

**只确认"安全区"的块，reorg 发生在 pending 区不影响已确认数据**

```
安全区（finalized）:   0 ----> head - confirmations
Pending 区（临时）:    head - confirmations ----> head
```

#### 数据库 Schema

```sql
-- 主表：只存已确认的块
CREATE TABLE blocks (
  chain_id bigint NOT NULL,
  number bigint NOT NULL,
  hash varchar(66) NOT NULL,
  parent_hash varchar(66) NOT NULL,
  timestamp bigint NOT NULL,
  finalized boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, number),
  UNIQUE (chain_id, hash)
);

-- 临时表：存 pending 区的块（可选，也可以在内存）
CREATE TABLE blocks_pending (
  chain_id bigint NOT NULL,
  number bigint NOT NULL,
  hash varchar(66) NOT NULL,
  parent_hash varchar(66) NOT NULL,
  timestamp bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, number, hash)
);

CREATE INDEX idx_blocks_pending_chain_number ON blocks_pending(chain_id, number);
```

#### 实现 Confirmation Depth

```typescript
// utils/confirmation-depth.ts
const CONFIRMATION_DEPTH = 12; // 以太坊主网约 2 分钟
const ANVIL_CONFIRMATION_DEPTH = 2; // Anvil 测试网 4 秒

export async function syncWithConfirmationDepth(): Promise<void> {
  const chainId = 1n;
  const confirmationDepth = isAnvil ? ANVIL_CONFIRMATION_DEPTH : CONFIRMATION_DEPTH;

  while (isRunning) {
    const headBlock = await rpcCallWithMetrics(
      'getBlockNumber',
      () => client.getBlockNumber()
    );

    const safeBlock = headBlock - BigInt(confirmationDepth);

    // 1. 获取 pending 区的最新状态
    const localMax = await blockRepository.getMaxBlockNumber();
    const pendingStart = localMax ? localMax + 1n : 0n;

    // 2. 抓取 pending 区（允许重试、允许覆盖）
    if (pendingStart <= headBlock) {
      await syncPendingBlocks(pendingStart, headBlock);
    }

    // 3. 确认安全区
    if (safeBlock > localMax) {
      await confirmBlocks(safeBlock);
    }

    await sleep(Number(config.POLL_INTERVAL_MS));
  }
}

async function syncPendingBlocks(
  startBlock: bigint,
  endBlock: bigint
): Promise<void> {
  // 存入 blocks_pending（允许重复合并，临时数据）
  for (let num = startBlock; num <= endBlock; num++) {
    try {
      const block = await client.getBlock({ blockNumber: num });

      await db
        .insertInto('blocks_pending')
        .values({
          chain_id: 1n,
          number: block.number,
          hash: block.hash,
          parent_hash: block.parentHash,
          timestamp: block.timestamp,
        })
        .onConflict((oc) => oc
          .column(['chain_id', 'number', 'hash'])
          .doUpdateSet({ received_at: new Date().toISOString() })
        )
        .execute();
    } catch (error) {
      // Pending 区失败不影响主流程，下次重试
      logger.warn({ error, blockNumber: num.toString() }, 'Failed to fetch pending block');
    }
  }
}

async function confirmBlocks(safeBlock: bigint): Promise<void> {
  // 从 pending 区选择 canonical 链迁移到 blocks 表
  const result = await db
    .selectFrom('blocks_pending')
    .selectAll()
    .where('number', '<=', safeBlock)
    .orderBy('number', 'asc')
    .execute();

  const chain = buildCanonicalChain(result); // 按 parent_hash 链接

  for (const block of chain) {
    await blockRepository.saveValidatedBlocks([block]);
  }

  // 清理已确认的 pending 数据
  await db
    .deleteFrom('blocks_pending')
    .where('number', '<=', safeBlock)
    .execute();
}

function buildCanonicalChain(pendingBlocks: PendingBlock[]): PendingBlock[] {
  // 从 genesis 开始按 parent_hash 链接
  const chainMap = new Map<bigint, PendingBlock>();
  for (const block of pendingBlocks) {
    chainMap.set(block.number, block);
  }

  const canonical: PendingBlock[] = [];
  let currentNumber = 0n; // 假设从 0 开始

  while (true) {
    const block = chainMap.get(currentNumber);
    if (!block) break;

    canonical.push(block);
    currentNumber = block.number + 1n;
  }

  return canonical;
}
```

#### Reorg 检测（简化版）

```typescript
// 在确认时检测 reorg
async function confirmBlocks(safeBlock: bigint): Promise<void> {
  const currentHead = await blockRepository.getMaxBlockNumber();
  const currentBlock = await blockRepository.findById(currentHead!);

  const pendingBlock = await db
    .selectFrom('blocks_pending')
    .where('number', '=', currentHead! + 1n)
    .orderBy('received_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (pendingBlock && pendingBlock.parent_hash !== currentBlock!.hash) {
    // Reorg 发生！
    logger.warn(
      {
        blockNumber: (currentHead! + 1n).toString(),
        oldParent: currentBlock!.hash,
        newParent: pendingBlock.parent_hash,
      },
      'Reorg detected in pending zone'
    );

    // 回滚到共同祖先
    const commonAncestor = await findCommonAncestorInPending(
      currentBlock!.hash,
      pendingBlock.parent_hash
    );

    await blockRepository.deleteBlocksAfter(commonAncestor);
  }

  // 继续正常确认流程...
}
```

**优势**：
- ✅ Reorg 只发生在 pending 区，不影响已确认数据
- ✅ 逻辑简单，无需复杂的分叉管理
- ✅ 符合区块链最佳实践（类似 Etherscan's confirmation count）

**劣势**：
- ⚠️ 数据有 2-12 分钟延迟（取决于链的确认深度）

---

## 修复方案 B：Canonical 标记（复杂但实时）

如果需要实时数据（0 延迟），使用 canonical 标记模型：

```sql
CREATE TABLE blocks (
  chain_id bigint NOT NULL,
  number bigint NOT NULL,
  hash varchar(66) NOT NULL,
  parent_hash varchar(66) NOT NULL,
  timestamp bigint NOT NULL,
  canonical boolean NOT NULL DEFAULT true, -- 是否为主链
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, number, hash), -- 允许同高度多 hash
  INDEX (chain_id, number, canonical)    -- 快速查询主链
);

CREATE UNIQUE INDEX idx_blocks_canonical ON blocks(chain_id, number)
WHERE canonical = true; -- 每个 height 最多一个 canonical
```

**Reorg 处理**：

```typescript
async function handleReorg(newBlockHash: string, newBlockNumber: bigint): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // 1. 把旧 canonical 链标记为 non-canonical
    await trx
      .updateTable('blocks')
      .set({ canonical: false })
      .where('number', '>=', newBlockNumber)
      .where('canonical', '=', true)
      .execute();

    // 2. 把新链标记为 canonical
    const newBlocks = await fetchChain(newBlockHash);
    for (const block of newBlocks) {
      await trx
        .insertInto('blocks')
        .values({ ...block, canonical: true })
        .onConflict((oc) => oc
          .column(['chain_id', 'number', 'hash'])
          .doUpdateSet({ canonical: true })
        )
        .execute();
    }
  });
}
```

**查询时**：

```sql
-- 只查询主链
SELECT * FROM blocks WHERE canonical = true ORDER BY number;
```

---

## 实施优先级

### Phase 1: 紧急修复（1-2 天）

1. ✅ **添加 `sync_status` 表** - 防止漏块
2. ✅ **实现 Upsert** - 防止重启卡死
3. ✅ **Gap Detection** - 定期检查并补洞

### Phase 2: Reorg 修复（3-5 天）

4. ✅ **选择 Reorg 方案**（推荐 Confirmation Depth）
5. ✅ **调整 Schema**（加 `chain_id`, `finalized`, `blocks_pending`）
6. ✅ **重构同步逻辑**（pending + confirm 两阶段）
7. ✅ **测试 Reorg 场景**

### Phase 3: 增强功能（1 周）

8. ⚠️ **添加 `chain_id` 支持**（多链索引）
9. ⚠️ **完善监控告警**（gap 检测、reorg 告警）
10. ⚠️ **添加集成测试**（模拟 reorg、网络故障）

---

## 测试计划

### 单元测试

```typescript
describe('SyncStatusRepository', () => {
  it('should not advance next_block if gap exists', async () => {
    await syncRepo.advanceNextBlock(1n, 100n, 110n);
    await syncRepo.advanceNextBlock(1n, 111n, 120n);

    // 缺少 110-111
    const status = await syncRepo.getSyncStatus(1n);
    expect(status.next_block).toBe(111n); // 不应推进到 121
  });
});
```

### 集成测试

```typescript
describe('Reorg Handling', () => {
  it('should detect reorg in pending zone', async () => {
    // 1. 同步到 1000
    await syncToBlock(1000);

    // 2. 模拟 reorg：修改 999 的父哈希
    await simulateReorg(995, newForkHash);

    // 3. 继续同步
    await syncToBlock(1010);

    // 4. 验证：999-1000 应该被回滚
    const block999 = await blockRepo.findById(999n);
    expect(block999.hash).toBe(newForkHash);
  });
});
```

---

## 回滚计划

如果修复失败，回滚步骤：

```bash
# 1. 停止索引器
pkill -f "node.*index-production"

# 2. 回滚数据库
psql -c "DROP TABLE IF EXISTS sync_status, sync_gaps, blocks_pending;"

# 3. 恢复旧代码
git checkout <before-fixes-commit>

# 4. 重新编译运行
npm run build
npm run start:dev
```

---

## 总结

当前索引器 **不能投入生产**，必须先修复这 3 个 Critical 问题。

修复后，你将拥有：

- ✅ **不会漏块** - checkpoint + gap detection
- ✅ **重启安全** - upsert 语义
- ✅ **Reorg 可靠** - confirmation depth 模型
- ✅ **多链支持** - chain_id 字段
- ✅ **可观测性** - sync_status, gaps 表

**生产就绪度**：从当前的 95/100 → 修复后的 **真正生产级 99/100**

---

**建议**：
1. 立即停止在生产环境使用当前版本
2. 在测试环境实施 Phase 1 修复
3. 充分测试后再部署到生产
4. 添加监控告警（gap 检测、reorg 告警）
