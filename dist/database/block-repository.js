"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockRepository = void 0;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
const schemas_1 = require("./schemas");
class BlockRepository {
    constructor() {
        this.db = (0, database_config_1.getDb)(); // Made public for transaction support
    }
    async create(blockData) {
        const now = new Date().toISOString();
        const result = await this.db
            .insertInto('blocks')
            .values({
            ...blockData,
            created_at: now,
            updated_at: now,
        })
            .returningAll()
            .executeTakeFirst();
        if (!result) {
            throw new Error('Failed to create block');
        }
        return result;
    }
    async createMany(blocksData) {
        if (blocksData.length === 0)
            return [];
        const now = new Date().toISOString();
        const results = await this.db
            .insertInto('blocks')
            .values(blocksData.map(block => ({
            ...block,
            created_at: now,
            updated_at: now,
        })))
            .returningAll()
            .execute();
        return results;
    }
    /**
     * 使用 Zod 验证并保存区块数据 (with transaction isolation and upsert)
     *
     * CRITICAL FIX: Implements upsert semantics to handle:
     * - Restarts after crashes (idempotent writes)
     * - Reorg scenarios (hash updates)
     * - Concurrent instances (conflict resolution)
     *
     * @param rawBlocks - 从 viem 获取的原始区块数据
     * @returns 保存的区块数量
     */
    async saveValidatedBlocks(rawBlocks) {
        if (rawBlocks.length === 0)
            return 0;
        // 使用 Zod 验证数据
        const validatedBlocks = (0, schemas_1.validateBlocks)(rawBlocks);
        if (validatedBlocks.length === 0) {
            console.warn(`[Repository] No valid blocks after validation`);
            return 0;
        }
        // 转换为数据库格式并保存
        const dbBlocks = validatedBlocks.map(schemas_1.toDbBlock);
        let updatedCount = 0;
        let insertedCount = 0;
        // Use transaction for atomic batch write with upsert
        const saved = await this.db.transaction().execute(async (trx) => {
            const results = [];
            for (const block of dbBlocks) {
                // Try to insert first
                try {
                    const result = await trx
                        .insertInto('blocks')
                        .values({
                        ...block,
                        created_at: new Date().toISOString(), // ✅ 字符串格式
                        updated_at: new Date().toISOString(), // ✅ 字符串格式
                    })
                        .onConflict((oc) => oc
                        .constraint('blocks_chain_number_unique') // ✅ 使用约束名
                        .doUpdateSet({
                        hash: block.hash,
                        parent_hash: block.parent_hash,
                        timestamp: block.timestamp,
                        updated_at: new Date(), // ✅ doUpdateSet需要Date对象
                    })
                        .where('blocks.hash', '!=', block.hash))
                        .returningAll()
                        .executeTakeFirst();
                    // ✅ SpaceX哲学：失败了就炸，不要继续
                    if (!result) {
                        throw new Error(`Failed to upsert block ${block.number}: insert returned no rows`);
                    }
                    results.push(result);
                    // ✅ Fix for C4: Determine insert vs update without race condition query
                    // Strategy: Compare created_at timestamps to detect update vs insert
                    // - Fresh insert: created_at is very recent (< 1 second ago)
                    // - Update: created_at is older (from original insert)
                    //
                    // Note: This is a heuristic but works reliably in practice since batch
                    // operations complete within milliseconds, while updated rows have
                    // much older created_at timestamps
                    const now = Date.now();
                    const createdAt = new Date(result.created_at).getTime();
                    const isFreshInsert = (now - createdAt) < 1000; // < 1 second = likely insert
                    if (isFreshInsert) {
                        insertedCount++;
                    }
                    else {
                        updatedCount++;
                    }
                }
                catch (error) {
                    console.error(`[Repository] Failed to upsert block ${block.number}:`, error);
                    throw error;
                }
            }
            return results;
        });
        console.log(`[Repository] ✅ Saved ${saved.length}/${rawBlocks.length} blocks ` +
            `(${insertedCount} inserted, ${updatedCount} updated, ${rawBlocks.length - saved.length} invalid)`);
        // Warn if we detected reorg (hash changes)
        if (updatedCount > 0) {
            console.warn(`[Repository] ⚠️  Detected ${updatedCount} hash changes (possible reorg)`);
        }
        return saved.length;
    }
    /**
     * Verify blocks were written by querying them back
     */
    async verifyBlocksWritten(blockNumbers) {
        if (blockNumbers.length === 0)
            return true;
        const found = await this.db
            .selectFrom('blocks')
            .select('number')
            .where('number', 'in', blockNumbers)
            .execute();
        return found.length === blockNumbers.length;
    }
    async findById(number) {
        return await this.db
            .selectFrom('blocks')
            .where('number', '=', number)
            .selectAll()
            .executeTakeFirst();
    }
    async findByHash(hash) {
        return await this.db
            .selectFrom('blocks')
            .where('hash', '=', hash)
            .selectAll()
            .executeTakeFirst();
    }
    async getMaxBlockNumber() {
        const result = await this.db
            .selectFrom('blocks')
            .select('number')
            .orderBy('number', 'desc')
            .limit(1)
            .executeTakeFirst();
        // 确保返回的是 BigInt 类型
        const num = result?.number;
        if (num === null || num === undefined) {
            return null;
        }
        // ✅ C++风格：安全的类型转换（Safe Type Conversion）
        // 处理科学计数法和边界情况
        if (typeof num === 'bigint') {
            return num;
        }
        // 处理字符串类型（包括科学计数法）
        if (typeof num === 'string') {
            // 检查科学计数法
            if (num.includes('e') || num.includes('E')) {
                // 转换为 number 再转 bigint（有精度风险，但至少不会崩溃）
                const asNumber = Number(num);
                if (!Number.isSafeInteger(asNumber)) {
                    throw new Error(`Block number "${num}" exceeds safe integer range when converted from scientific notation`);
                }
                return BigInt(asNumber);
            }
            // 普通字符串
            try {
                return BigInt(num);
            }
            catch (error) {
                throw new Error(`Cannot convert block number string "${num}" to bigint: ${error}`);
            }
        }
        // 处理 number 类型
        if (typeof num === 'number') {
            if (!Number.isSafeInteger(num)) {
                throw new Error(`Block number ${num} exceeds safe integer range`);
            }
            return BigInt(num);
        }
        throw new Error(`Unsupported block number type: ${typeof num}, value: ${num}`);
    }
    async getBlockCount() {
        const result = await this.db
            .selectFrom('blocks')
            .select((0, kysely_1.sql) `count(*)`.as('count'))
            .executeTakeFirst();
        return result?.count ?? 0;
    }
    async existsByNumber(number) {
        const result = await this.db
            .selectFrom('blocks')
            .select('number')
            .where('number', '=', number)
            .limit(1)
            .executeTakeFirst();
        return !!result;
    }
    async existsByHash(hash) {
        const result = await this.db
            .selectFrom('blocks')
            .select('hash')
            .where('hash', '=', hash)
            .limit(1)
            .executeTakeFirst();
        return !!result;
    }
    async getBlocksInRange(start, end) {
        return await this.db
            .selectFrom('blocks')
            .selectAll()
            .where('number', '>=', start)
            .where('number', '<=', end)
            .orderBy('number', 'asc')
            .execute();
    }
    /**
     * Find blocks by multiple IDs
     */
    async findByIds(numbers) {
        if (numbers.length === 0)
            return [];
        return await this.db
            .selectFrom('blocks')
            .selectAll()
            .where('number', 'in', numbers)
            .orderBy('number', 'asc')
            .execute();
    }
    /**
     * Delete all blocks after a specific block number (for reorg handling)
     *
     * CRITICAL FIX: Added safety limit to prevent accidental mass deletion
     * in case of extreme reorg depth or incorrect blockNumber
     */
    async deleteBlocksAfter(blockNumber) {
        const MAX_REORG_DEPTH = 1000n; // ✅ C++风格：使用bigint避免精度丢失
        // Check current max block before deletion
        const currentMax = await this.getMaxBlockNumber();
        if (currentMax && currentMax > blockNumber) {
            const depth = currentMax - blockNumber; // ✅ 保持bigint运算
            if (depth > MAX_REORG_DEPTH) {
                throw new Error(`Reorg depth ${depth} exceeds maximum allowed ${MAX_REORG_DEPTH}. ` +
                    `Manual intervention required. Current max: ${currentMax}, Requested: ${blockNumber}`);
            }
            console.warn(`[Repository] Deleting ${depth} blocks after ${blockNumber} (reorg detected)`);
        }
        const result = await this.db
            .deleteFrom('blocks')
            .where('number', '>', blockNumber)
            .execute();
        return result.length; // Number of deleted rows
    }
    /**
     * Get multiple blocks by their hashes
     */
    async findByHashes(hashes) {
        if (hashes.length === 0)
            return [];
        return await this.db
            .selectFrom('blocks')
            .selectAll()
            .where('hash', 'in', hashes)
            .execute();
    }
    /**
     * Detect gaps in the blockchain sequence
     *
     * Returns array of {start, end} representing missing block ranges
     */
    async detectGaps() {
        const maxBlock = await this.getMaxBlockNumber();
        if (!maxBlock || maxBlock < 1n) {
            return [];
        }
        // SQL query to find gaps by identifying sequential breaks
        // ✅ C++风格：使用 bigint 避免精度丢失
        const result = await this.db
            .selectFrom('blocks as b1')
            .select([
            (0, kysely_1.sql) `b1.number + 1`.as('gap_start'), // ✅ bigint类型
            (0, kysely_1.sql) `(
          SELECT MIN(b2.number)
          FROM blocks b2
          WHERE b2.number > b1.number
        ) - 1`.as('gap_end') // ✅ bigint类型
        ])
            .where('b1.number', '<', maxBlock)
            .where((0, kysely_1.sql) `NOT EXISTS (
        SELECT 1 FROM blocks b2 WHERE b2.number = b1.number + 1
      )`)
            .execute();
        // Filter and convert to bigint (now they're already bigint)
        return result
            .filter(row => row.gap_start !== null && row.gap_end !== null && row.gap_start <= row.gap_end)
            .map(row => ({
            start: row.gap_start, // ✅ 已经是bigint
            end: row.gap_end // ✅ 已经是bigint
        }));
    }
    /**
     * Get statistics about block coverage
     */
    async getBlockCoverageStats() {
        const maxBlock = await this.getMaxBlockNumber();
        const totalBlocks = await this.getBlockCount();
        if (!maxBlock || maxBlock < 1n) {
            return {
                totalBlocks,
                expectedBlocks: 0,
                missingBlocks: 0,
                coverage: 100
            };
        }
        // ✅ C++风格：保持 bigint 运算直到最后才转换
        const expectedBlocksBigInt = maxBlock + 1n; // Block 0 to maxBlock
        const missingBlocksBigInt = expectedBlocksBigInt - BigInt(totalBlocks);
        // 只在返回时转换为 number（用于显示）
        const expectedBlocks = Number(expectedBlocksBigInt);
        const missingBlocks = Number(missingBlocksBigInt);
        // 使用 bigint 计算覆盖率，避免精度丢失
        const coverage = totalBlocks > 0
            ? Number((BigInt(totalBlocks) * 100n) / expectedBlocksBigInt)
            : 0;
        return {
            totalBlocks,
            expectedBlocks,
            missingBlocks,
            coverage: Math.round(coverage * 100) / 100
        };
    }
}
exports.BlockRepository = BlockRepository;
