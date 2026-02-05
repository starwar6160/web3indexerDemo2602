import { z } from 'zod';
import logger from '../utils/logger';

/**
 * 严格的区块数据验证 Schema - Fail Fast 版本
 * 任何不符合条件的数据都会立即抛出异常
 */
export const StrictBlockSchema = z.object({
  number: z.bigint().nonnegative(), // 区块号必须 >= 0
  hash: z.string()
    .length(66) // 0x + 64 hex characters
    .startsWith('0x')
    .regex(/^0x[a-f0-9]+$/, 'Hash must contain only hexadecimal characters'),
  timestamp: z.coerce.number().int().positive(), // 时间戳必须是正整数
  parentHash: z.string().length(66).startsWith('0x'),
}).refine(
  (data) => data.hash !== data.parentHash,
  'Block hash cannot be same as parent hash (possible loop)'
);

/**
 * 交易数据验证 Schema（预备 - 用于后续 Phase 1）
 */
export const TransactionSchema = z.object({
  hash: z.string().length(66).startsWith('0x'),
  blockNumber: z.bigint().nonnegative(),
  from: z.string().length(42).startsWith('0x'),
  to: z.string().length(42).startsWith('0x').nullable(),
  value: z.bigint(),
  gas: z.bigint().nonnegative(),
});

/**
 * 严格的区块验证 - 使用 .parse() 强制验证
 * @param data - 从 RPC 获取的原始区块数据
 * @param source - 数据来源（用于日志追踪）
 * @throws ZodError 如果数据无效
 */
export function strictValidateBlock(data: unknown, source: string = 'unknown') {
  try {
    return StrictBlockSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error({
        source,
        errors: error.errors,
        data: JSON.stringify(data).slice(0, 500), // 只记录前500字符
      }, '❌ Block validation failed - data corrupted from RPC');
    }
    throw error; // 重新抛出，让程序崩溃
  }
}

/**
 * 严格的批量验证
 * 只要有一个区块无效，整个批次都拒绝
 * @param blocks - 区块数组
 * @param source - 数据来源
 * @returns 所有验证通过的区块
 * @throws 如果任何区块无效
 */
export function strictValidateBlocks(blocks: unknown[], source: string = 'batch'): ValidatedBlock[] {
  logger.debug({ count: blocks.length, source }, 'Validating block batch');

  const validatedBlocks: ValidatedBlock[] = [];
  const errors: Array<{ index: number; error: z.ZodError }> = [];

  blocks.forEach((block, index) => {
    try {
      validatedBlocks.push(strictValidateBlock(block, `${source}[${index}]`));
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push({ index, error });
      } else {
        throw error;
      }
    }
  });

  // Fail fast: 如果有任何错误，立即抛出
  if (errors.length > 0) {
    logger.error({
      totalErrors: errors.length,
      totalBlocks: blocks.length,
      errors: errors.map(e => ({
        index: e.index,
        issues: e.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      })),
    }, '❌ Batch validation failed - rejecting entire batch');

    throw new Error(`Batch validation failed: ${errors.length}/${blocks.length} blocks are invalid`);
  }

  logger.info({
    inputCount: blocks.length,
    validatedCount: validatedBlocks.length,
  }, '✅ All blocks validated successfully');

  return validatedBlocks;
}

/**
 * 数据库输出验证
 * 确保写入数据库前的数据完全符合要求
 */
export const DbOutputSchema = z.object({
  number: z.bigint().nonnegative(),
  hash: z.string().length(66).startsWith('0x'),
  timestamp: z.number().int().positive(),
  parent_hash: z.string().length(66).startsWith('0x'),
});

/**
 * 验证即将写入数据库的数据
 * @param data - 待写入的数据
 * @throws 如果数据无效
 */
export function validateDbOutput(data: unknown) {
  try {
    return DbOutputSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error({
        errors: error.errors,
        data,
      }, '❌ Database output validation failed - data corruption detected');
    }
    throw error;
  }
}

export type ValidatedBlock = z.infer<typeof StrictBlockSchema>;
