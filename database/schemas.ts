import { z } from 'zod';

/**
 * 区块数据验证 Schema
 * 用于从 viem 获取的原始数据进行验证和类型转换
 */
export const BlockSchema = z.object({
  number: z.bigint(),
  hash: z.string().startsWith('0x'),
  timestamp: z.coerce.number(), // 自动处理 bigint -> number
  parentHash: z.string().startsWith('0x'),
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
  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
    parent_hash: block.parentHash,
  };
}