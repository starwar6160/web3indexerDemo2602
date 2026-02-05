"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbBlockSchema = exports.BlockSchema = void 0;
exports.validateBlock = validateBlock;
exports.safeValidateBlock = safeValidateBlock;
exports.validateBlocks = validateBlocks;
exports.toDbBlock = toDbBlock;
const zod_1 = require("zod");
/**
 * 区块数据验证 Schema
 * 用于从 viem 获取的原始数据进行验证和类型转换
 */
exports.BlockSchema = zod_1.z.object({
    number: zod_1.z.bigint()
        .min(0n, 'Block number must be non-negative')
        .max(2n ** 64n - 1n, 'Block number exceeds safe range'), // 防止 uint256 溢出
    hash: zod_1.z.string()
        .startsWith('0x', 'Hash must start with 0x')
        .length(66, 'Hash must be 66 characters (0x + 64 hex chars)')
        .regex(/^0x[a-f0-9]{64}$/, 'Hash must contain only hexadecimal characters'),
    timestamp: zod_1.z.coerce.bigint()
        .min(0n, 'Timestamp must be non-negative')
        .max(BigInt(Math.floor(Date.now() / 1000) + 86400), 'Timestamp is too far in the future (more than 24h)')
        .refine(ts => ts < BigInt(Math.floor(Date.now() / 1000) + 86400), {
        message: 'Timestamp cannot be more than 24 hours in the future',
    }),
    parentHash: zod_1.z.string()
        .startsWith('0x', 'Parent hash must start with 0x')
        .length(66, 'Parent hash must be 66 characters')
        .regex(/^0x[a-f0-9]{64}$/, 'Parent hash must contain only hexadecimal characters')
        .refine(hash => hash !== '0x0000000000000000000000000000000000000000000000000000000000000000', {
        message: 'Parent hash cannot be zero address (except for genesis block)',
    })
        .optional(), // Genesis block may not have parent hash
});
/**
 * 数据库区块 Schema
 * 用于验证从数据库读取的数据
 *
 * CRITICAL FIX: timestamp 使用 bigint 而不是 number
 * 防止 JS Number 精度丢失（安全整数范围 ±2^53）
 * 适用于毫秒时间戳和未来更大的值
 */
exports.DbBlockSchema = zod_1.z.object({
    number: zod_1.z.bigint(),
    hash: zod_1.z.string().startsWith('0x'),
    timestamp: zod_1.z.bigint(), // ✅ 使用 bigint（而不是 number）
    parent_hash: zod_1.z.string().startsWith('0x'),
    chain_id: zod_1.z.bigint().optional(), // 可选的 chain_id（Phase 1 已添加）
    created_at: zod_1.z.coerce.date(), // 自动处理字符串 -> Date
    updated_at: zod_1.z.coerce.date(),
});
/**
 * 验证区块数据
 * @param data - 从 viem 获取的原始区块数据
 * @returns 验证后的区块数据
 */
function validateBlock(data) {
    return exports.BlockSchema.parse(data);
}
/**
 * 安全验证区块数据（不抛出异常）
 * @param data - 从 viem 获取的原始区块数据
 * @returns 验证结果
 */
function safeValidateBlock(data) {
    return exports.BlockSchema.safeParse(data);
}
/**
 * 批量验证区块数据
 * @param blocks - 区块数据数组
 * @returns 验证后的区块数据数组（过滤掉无效数据）
 */
function validateBlocks(blocks) {
    return blocks
        .map((block) => safeValidateBlock(block))
        .filter((result) => result.success)
        .map((result) => result.data);
}
/**
 * 转换为数据库格式
 * @param block - 验证后的区块数据
 * @returns 数据库区块数据
 *
 * CRITICAL FIX: 保持 bigint 类型，不进行 Number() 转换
 * 防止精度丢失（JS Number 安全整数范围: ±2^53-1）
 */
function toDbBlock(block) {
    return {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp, // ✅ 保持 bigint，不转换
        parent_hash: block.parentHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
        chain_id: 1n, // ✅ 默认 chain_id（Phase 1 已添加到 schema）
    };
}
