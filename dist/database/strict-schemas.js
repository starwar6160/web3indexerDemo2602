"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbOutputSchema = exports.TransactionSchema = exports.StrictBlockSchema = void 0;
exports.strictValidateBlock = strictValidateBlock;
exports.strictValidateBlocks = strictValidateBlocks;
exports.validateDbOutput = validateDbOutput;
const zod_1 = require("zod");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 严格的区块数据验证 Schema - Fail Fast 版本
 * 任何不符合条件的数据都会立即抛出异常
 */
exports.StrictBlockSchema = zod_1.z.object({
    number: zod_1.z.bigint().nonnegative(), // 区块号必须 >= 0
    hash: zod_1.z.string()
        .length(66) // 0x + 64 hex characters
        .startsWith('0x')
        .regex(/^0x[a-f0-9]+$/, 'Hash must contain only hexadecimal characters'),
    timestamp: zod_1.z.coerce.number().int().positive(), // 时间戳必须是正整数
    parentHash: zod_1.z.string().length(66).startsWith('0x'),
}).refine((data) => data.hash !== data.parentHash, 'Block hash cannot be same as parent hash (possible loop)');
/**
 * 交易数据验证 Schema（预备 - 用于后续 Phase 1）
 */
exports.TransactionSchema = zod_1.z.object({
    hash: zod_1.z.string().length(66).startsWith('0x'),
    blockNumber: zod_1.z.bigint().nonnegative(),
    from: zod_1.z.string().length(42).startsWith('0x'),
    to: zod_1.z.string().length(42).startsWith('0x').nullable(),
    value: zod_1.z.bigint(),
    gas: zod_1.z.bigint().nonnegative(),
});
/**
 * 严格的区块验证 - 使用 .parse() 强制验证
 * @param data - 从 RPC 获取的原始区块数据
 * @param source - 数据来源（用于日志追踪）
 * @throws ZodError 如果数据无效
 */
function strictValidateBlock(data, source = 'unknown') {
    try {
        return exports.StrictBlockSchema.parse(data);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            logger_1.default.error({
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
function strictValidateBlocks(blocks, source = 'batch') {
    logger_1.default.debug({ count: blocks.length, source }, 'Validating block batch');
    const validatedBlocks = [];
    const errors = [];
    blocks.forEach((block, index) => {
        try {
            validatedBlocks.push(strictValidateBlock(block, `${source}[${index}]`));
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                errors.push({ index, error });
            }
            else {
                throw error;
            }
        }
    });
    // Fail fast: 如果有任何错误，立即抛出
    if (errors.length > 0) {
        logger_1.default.error({
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
    logger_1.default.info({
        inputCount: blocks.length,
        validatedCount: validatedBlocks.length,
    }, '✅ All blocks validated successfully');
    return validatedBlocks;
}
/**
 * 数据库输出验证
 * 确保写入数据库前的数据完全符合要求
 */
exports.DbOutputSchema = zod_1.z.object({
    number: zod_1.z.bigint().nonnegative(),
    hash: zod_1.z.string().length(66).startsWith('0x'),
    timestamp: zod_1.z.number().int().positive(),
    parent_hash: zod_1.z.string().length(66).startsWith('0x'),
});
/**
 * 验证即将写入数据库的数据
 * @param data - 待写入的数据
 * @throws 如果数据无效
 */
function validateDbOutput(data) {
    try {
        return exports.DbOutputSchema.parse(data);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            logger_1.default.error({
                errors: error.errors,
                data,
            }, '❌ Database output validation failed - data corruption detected');
        }
        throw error;
    }
}
