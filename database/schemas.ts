import { z } from 'zod';

/**
 * 区块数据验证 Schema
 * 用于从 viem 获取的原始数据进行验证和类型转换
 */
export const BlockSchema = z.object({
  number: z.bigint().min(0n, 'Block number must be non-negative'),
  hash: z.string()
    .startsWith('0x', 'Hash must start with 0x')
    .length(66, 'Hash must be 66 characters (0x + 64 hex chars)')
    .regex(/^0x[a-f0-9]{64}$/, 'Hash must contain only hexadecimal characters'),
  timestamp: z.coerce.bigint().min(0n, 'Timestamp must be non-negative'),
  parentHash: z.string()
    .startsWith('0x', 'Parent hash must start with 0x')
    .length(66, 'Parent hash must be 66 characters')
    .regex(/^0x[a-f0-9]{64}$/, 'Parent hash must contain only hexadecimal characters')
    .refine(hash => hash !== '0x0000000000000000000000000000000000000000000000000000000000000000', {
      message: 'Parent hash cannot be zero address (except for genesis block)',
    })
    .optional(), // Genesis block may not have parent hash
});

/**
 * 区块数据类型（从 Schema 自动推导）
 */
export type ValidatedBlock = z.infer<typeof BlockSchema>;

/**
 * 数据库区块 Schema
 * 用于验证从数据库读取的数据
 */
export const DbBlockSchema = z.object({
  number: z.bigint(),
  hash: z.string().startsWith('0x'),
  timestamp: z.number(),
  parent_hash: z.string().startsWith('0x'),
  created_at: z.coerce.date(), // 自动处理字符串 -> Date
  updated_at: z.coerce.date(),
});

/**
 * 数据库区块类型（从 Schema 自动推导）
 */
export type DbBlock = z.infer<typeof DbBlockSchema>;

/**
 * 验证区块数据
 * @param data - 从 viem 获取的原始区块数据
 * @returns 验证后的区块数据
 */
export function validateBlock(data: unknown): ValidatedBlock {
  return BlockSchema.parse(data);
}

/**
 * 安全验证区块数据（不抛出异常）
 * @param data - 从 viem 获取的原始区块数据
 * @returns 验证结果
 */
export function safeValidateBlock(data: unknown) {
  return BlockSchema.safeParse(data);
}

/**
 * 批量验证区块数据
 * @param blocks - 区块数据数组
 * @returns 验证后的区块数据数组（过滤掉无效数据）
 */
export function validateBlocks(blocks: unknown[]): ValidatedBlock[] {
  return blocks
    .map((block) => safeValidateBlock(block))
    .filter((result) => result.success)
    .map((result) => (result as { success: true; data: ValidatedBlock }).data);
}

/**
 * 转换为数据库格式
 * @param block - 验证后的区块数据
 * @returns 数据库区块数据
 */
export function toDbBlock(block: ValidatedBlock) {
  // 将 bigint timestamp 转换为 number 用于存储（如果还在使用 integer）
  // 迁移到 bigint 后可以直接使用
  return {
    number: block.number,
    hash: block.hash,
    timestamp: Number(block.timestamp), // 转换为 number（兼容现有 schema）
    parent_hash: block.parentHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
  };
}