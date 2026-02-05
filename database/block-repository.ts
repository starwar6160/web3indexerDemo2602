import { getDb } from './database-config';
import { Block, NewBlock } from './database-types';
import { sql } from 'kysely';
import { validateBlocks, toDbBlock, ValidatedBlock } from './schemas';
import { Transaction } from 'kysely';

export class BlockRepository {
  private db = getDb();

  async create(blockData: Omit<NewBlock, 'created_at' | 'updated_at'>): Promise<Block> {
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

  async createMany(blocksData: Omit<NewBlock, 'created_at' | 'updated_at'>[]): Promise<Block[]> {
    if (blocksData.length === 0) return [];

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
   * 使用 Zod 验证并保存区块数据 (with transaction isolation)
   * @param rawBlocks - 从 viem 获取的原始区块数据
   * @returns 保存的区块数量
   */
  async saveValidatedBlocks(rawBlocks: unknown[]): Promise<number> {
    if (rawBlocks.length === 0) return 0;

    // 使用 Zod 验证数据
    const validatedBlocks = validateBlocks(rawBlocks);

    if (validatedBlocks.length === 0) {
      console.warn(`[Repository] No valid blocks after validation`);
      return 0;
    }

    // 转换为数据库格式并保存
    const dbBlocks = validatedBlocks.map(toDbBlock);

    // Use transaction for atomic batch write
    const saved = await this.db.transaction().execute(async (trx) => {
      return await trx
        .insertInto('blocks')
        .values(dbBlocks)
        .returningAll()
        .execute();
    });

    console.log(`[Repository] ✅ Saved ${saved.length}/${rawBlocks.length} blocks (${rawBlocks.length - saved.length} invalid)`);

    return saved.length;
  }

  /**
   * Verify blocks were written by querying them back
   */
  async verifyBlocksWritten(blockNumbers: bigint[]): Promise<boolean> {
    if (blockNumbers.length === 0) return true;

    const found = await this.db
      .selectFrom('blocks')
      .select('number')
      .where('number', 'in', blockNumbers)
      .execute();

    return found.length === blockNumbers.length;
  }

  async findById(number: bigint): Promise<Block | undefined> {
    return await this.db
      .selectFrom('blocks')
      .where('number', '=', number)
      .selectAll()
      .executeTakeFirst();
  }

  async findByHash(hash: string): Promise<Block | undefined> {
    return await this.db
      .selectFrom('blocks')
      .where('hash', '=', hash)
      .selectAll()
      .executeTakeFirst();
  }

  async getMaxBlockNumber(): Promise<bigint | null> {
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
    // 如果返回的是字符串或数字，转换为 BigInt
    return typeof num === 'bigint' ? num : BigInt(num);
  }

  async getBlockCount(): Promise<number> {
    const result = await this.db
      .selectFrom('blocks')
      .select(sql`count(*)`.as('count'))
      .executeTakeFirst();

    return result?.count as number ?? 0;
  }

  async existsByNumber(number: bigint): Promise<boolean> {
    const result = await this.db
      .selectFrom('blocks')
      .select('number')
      .where('number', '=', number)
      .limit(1)
      .executeTakeFirst();

    return !!result;
  }

  async existsByHash(hash: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('blocks')
      .select('hash')
      .where('hash', '=', hash)
      .limit(1)
      .executeTakeFirst();

    return !!result;
  }

  async getBlocksInRange(start: bigint, end: bigint): Promise<Block[]> {
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
  async findByIds(numbers: bigint[]): Promise<Block[]> {
    if (numbers.length === 0) return [];
    return await this.db
      .selectFrom('blocks')
      .selectAll()
      .where('number', 'in', numbers)
      .orderBy('number', 'asc')
      .execute();
  }

  /**
   * Delete all blocks after a specific block number (for reorg handling)
   */
  async deleteBlocksAfter(blockNumber: bigint): Promise<number> {
    const result = await this.db
      .deleteFrom('blocks')
      .where('number', '>', blockNumber)
      .execute();

    return result.length; // Number of deleted rows
  }

  /**
   * Get multiple blocks by their hashes
   */
  async findByHashes(hashes: string[]): Promise<Block[]> {
    if (hashes.length === 0) return [];
    return await this.db
      .selectFrom('blocks')
      .selectAll()
      .where('hash', 'in', hashes)
      .execute();
  }
}