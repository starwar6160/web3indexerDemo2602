import { z } from 'zod';

/**
 * 区块数据验证 Schema
 * 用于从 viem 获取的原始数据进行验证和类型转换
 */
export const BlockSchema = z.object({
  number: z.bigint()
    .min(0n, 'Block number must be non-negative')
    .max(2n ** 64n - 1n, 'Block number exceeds safe range'), // 防止 uint256 溢出
  hash: z.string()
    .startsWith('0x', 'Hash must start with 0x')
    .length(66, 'Hash must be 66 characters (0x + 64 hex chars)')
    .regex(/^0x[a-f0-9]{64}$/, 'Hash must contain only hexadecimal characters'),
  timestamp: z.coerce.bigint()
    .min(0n, 'Timestamp must be non-negative')
    .max(BigInt(Math.floor(Date.now() / 1000) + 86400), 'Timestamp is too far in the future (more than 24h)')
    .refine(ts => ts < BigInt(Math.floor(Date.now() / 1000) + 86400), {
      message: 'Timestamp cannot be more than 24 hours in the future',
    }),
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
 *
 * CRITICAL FIX: timestamp 使用 bigint 而不是 number
 * 防止 JS Number 精度丢失（安全整数范围 ±2^53）
 * 适用于毫秒时间戳和未来更大的值
 */
export const DbBlockSchema = z.object({
  number: z.bigint(),
  hash: z.string().startsWith('0x'),
  timestamp: z.bigint(), // ✅ 使用 bigint（而不是 number）
  parent_hash: z.string().startsWith('0x'),
  chain_id: z.bigint().optional(), // 可选的 chain_id（Phase 1 已添加）
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
 * @returns 验证后的区块数据数组
 * @throws {Error} 如果任何一个区块验证失败，立即抛出异常（SpaceX哲学）
 *
 * CRITICAL: 使用 parse() 而不是 safeParse()
 * - 任何一个区块格式错误 → 整个批次失败
 * - 静默跳过 = 数据完整性风险
 * - "炸得早"胜过"静默错误"
 *
 * C++风格：防御性编程 - 先过滤无效输入，再验证
 */
export function validateBlocks(blocks: unknown[]): ValidatedBlock[] {
  // ✅ C++风格：输入清理（Input Sanitization）
  // 类似于 C++ 的 std::remove_if + exception
  const sanitizedBlocks = blocks.map((block, index) => {
    // SpaceX哲学：当场炸，给出明确的错误信息
    if (block === null || block === undefined) {
      throw new Error(
        `Block at index ${index} is ${block}. ` +
        `Null/undefined blocks are not allowed. ` +
        `This indicates a serious data source issue.`
      );
    }
    return { block, index };
  });

  // SpaceX哲学: 当场炸，不要吞异常
  return sanitizedBlocks.map(({ block, index }) => {
    try {
      return BlockSchema.parse(block);
    } catch (error) {
      throw new Error(
        `Block at index ${index} validation failed: ${error}`
      );
    }
  });
}

/**
 * 转换为数据库格式
 * @param block - 验证后的区块数据
 * @returns 数据库区块数据
 *
 * CRITICAL FIX: 保持 bigint 类型，不进行 Number() 转换
 * 防止精度丢失（JS Number 安全整数范围: ±2^53-1）
 */
export function toDbBlock(block: ValidatedBlock) {
  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp, // ✅ 保持 bigint，不转换
    parent_hash: block.parentHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
    chain_id: 1n, // ✅ 默认 chain_id（Phase 1 已添加到 schema）
  };
}