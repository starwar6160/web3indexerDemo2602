import { getDb } from './database-config';
import { Block, NewBlock } from './database-types';
import { sql } from 'kysely';
import { validateBlocks, toDbBlock, ValidatedBlock } from './schemas';

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
   * 使用 Zod 验证并保存区块数据
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
    const saved = await this.createMany(dbBlocks);

    console.log(`[Repository] ✅ Saved ${saved.length}/${rawBlocks.length} blocks (${rawBlocks.length - saved.length} invalid)`);

    return saved.length;
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

    return result?.number ?? null;
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
}