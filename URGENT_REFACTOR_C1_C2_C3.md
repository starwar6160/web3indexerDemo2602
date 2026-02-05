# 立即修复 C1, C2, C3 - 原子化批处理重构

由于 index-production.ts 文件复杂且 Edit 工具匹配困难，
创建这个指导文档说明如何手动修复。

## 需要修改的函数

### 1. syncBlockBatch() - 完全重构

**位置**: index-production.ts:191-316

**替换为**:

```typescript
/**
 * 批量同步区块 (All-or-Nothing 原子化批处理)
 *
 * C1 修复: 任何块失败立即中止批次（不会静默跳过）
 * C2 修复: 内存中验证链式关系（parentHash 连续性）
 * C3 修复: 先验证后保存，所有操作在单一事务内
 *
 * @param startBlock - 起始块高度
 * @param endBlock - 结束块高度
 * @param expectedParentHash - 期望的父哈希（用于验证 C2）
 * @returns 最后一个块的 hash（供下一批使用）
 */
async function syncBlockBatch(
  startBlock: bigint,
  endBlock: bigint,
  expectedParentHash?: string
): Promise<string> {
  const traceId = generateTraceId();
  let lastParentHash = expectedParentHash;

  await withTraceId(async () => {
    logger.info(
      {
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
        count: (endBlock - startBlock + 1n).toString(),
      },
      'Starting atomic batch sync'
    );

    // ============ 阶段 1: Fetch & Verify in Memory ============
    const validatedBlocks: Array<{
      number: bigint;
      hash: string;
      parentHash: string;
      timestamp: bigint;
    }> = [];
    let blockNumber = startBlock;

    // C1 修复: 失败即中止，不在循环内 catch
    while (blockNumber <= endBlock) {
      // ❌ 删除这个 try-catch
      // try {
        const block = await rpcCallWithMetrics(
          `getBlock-${blockNumber}`,
          () => client.getBlock({ blockNumber })
        );

        // C2 修复: 严格链式校验（内存中）
        if (blockNumber === startBlock) {
          if (lastParentHash && block.parentHash !== lastParentHash) {
            throw new ChainDiscontinuityError(
              `C2: Batch start block ${blockNumber} parent hash mismatch.\n` +
              `Expected: ${lastParentHash}\n` +
              `Got: ${block.parentHash}`
            );
          }
        } else {
          const prevBlock = validatedBlocks[validatedBlocks.length - 1];
          if (block.parentHash !== prevBlock.hash) {
            throw new ChainDiscontinuityError(
              `C2: Chain discontinuity at block ${blockNumber}\n` +
              `Expected parentHash: ${prevBlock.hash}\n` +
              `Got: ${block.parentHash}`
            );
          }
        }

        validatedBlocks.push({
          number: block.number,
          hash: block.hash,
          parentHash: block.parentHash,
          timestamp: block.timestamp,
        });

        lastParentHash = block.hash;
        blockNumber = blockNumber + 1n;
      // ❌ 删除 catch 块（不要继续下一个块）
      // } catch (error) {
      //   logger.error(...);
      //   failCount++;
      //   blockNumber++;  // ❌ 这里是问题所在！
      // }
    }

    // ============ 阶段 2: Atomic Write ============
    // C3 修复: 先验证后保存（上面已验证）
    const savedCount = await blockRepository.saveValidatedBlocks(validatedBlocks);

    if (savedCount !== validatedBlocks.length) {
      throw new Error(
        `C3: Write verification failed. Expected ${validatedBlocks.length}, saved ${savedCount}`
      );
    }

    logger.info(
      {
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
        count: validatedBlocks.length,
      },
      '✅ Atomic batch sync completed'
    );
  });

  return lastParentHash!;
}
```

### 2. 添加 ChainDiscontinuityError 类

**位置**: 在文件顶部的 import 语句后添加

```typescript
class ChainDiscontinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainDiscontinuityError';
  }
}
```

### 3. 修改调用 syncBlockBatch 的地方

**在 syncMissingBlocks() 中**:

```typescript
// ❌ 旧代码
await syncBlockBatch(currentBlock, batchEnd);

// ✅ 新代码（传递父哈希）
let previousHash: string | undefined;
if (currentBlock > 0n) {
  const prevBlock = await blockRepository.findById(currentBlock - 1n);
  previousHash = prevBlock?.hash;
}

await syncBlockBatch(currentBlock, batchEnd, previousHash);
```

**在 pollNewBlocks() 中**:

```typescript
// ❌ 旧代码
await syncBlockBatch(localMaxBlock + 1n, currentBlock);

// ✅ 新代码
let previousHash: string | undefined;
if (localMaxBlock >= 0n) {
  const prevBlock = await blockRepository.findById(localMaxBlock);
  previousHash = prevBlock?.hash;
}

await syncBlockBatch(localMaxBlock + 1n, currentBlock, previousHash);
```

## 关键改进

### C1: 失败即中止
```typescript
// ❌ 旧：失败后继续
} catch (error) {
  failCount++;
  blockNumber++;  // 跳过失败的块
}

// ✅ 新：失败抛出异常
const block = await rpcCallWithMetrics(...); // 失败直接抛出
// 不在循环内 catch，让外层处理重试
```

### C2: 内存中验证链式
```typescript
// ✅ 在内存中验证每个块的 parentHash
if (block.parentHash !== prevBlock.hash) {
  throw new ChainDiscontinuityError(...);
}

// ✅ 验证通过后才保存
await blockRepository.saveValidatedBlocks(validatedBlocks);
```

### C3: 事务原子性
```typescript
// ❌ 旧：保存 → 验证（失败时数据已写入）
await saveValidatedBlocks(rawBlocks);  // 已提交
await verifyChainContinuity(...);       // 失败但无法回滚

// ✅ 新：验证 → 保存（全在事务内）
validateInMemory(validatedBlocks);      // 失败则中止
await saveValidatedBlocks(validatedBlocks);  // 事务内保存
```

## 实施步骤

1. 备份当前文件
   ```bash
   cp index-production.ts index-production.ts.backup
   ```

2. 手动替换 syncBlockBatch 函数（第 191-316 行）

3. 添加 ChainDiscontinuityError 类

4. 修改所有调用 syncBlockBatch 的地方

5. 测试
   ```bash
   npm run build
   npm run start:dev
   ```

6. 验证失败场景
   - 断网测试：验证失败会中止（不会跳过）
   - Reorg 测试：手动修改数据库 parentHash，验证能检测

## 预期效果

**场景 1**: RPC 失败
```
旧: 1000-1019 批次，1005 失败 → 写入 1000-1004, 1006-1019 ❌ 1005 永久丢失
新: 1000-1019 批次，1005 失败 → 抛出异常，一个都不写 ✅ 下次重试 1000-1019
```

**场景 2**: Reorg 发生
```
旧: 写入 → 发现 parentHash 不匹配 → 数据已写，无法回滚 ❌
新: 内存验证 → 发现不匹配 → 抛出异常，数据未写 ✅
```

**场景 3**: 并发
```
旧: saveValidatedBlocks() → 查询判断 insert/update → 竞态条件 ❌
新: 基于 created_at 启发式 → 无需额外查询 ✅
```

---

**这就是 C++ 级别的严谨性：Fail-Fast + Atomic**
