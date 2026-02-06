"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbBlockSchema = exports.StrictBlockSchema = void 0;
exports.toBigInt = toBigInt;
exports.compareBigInt = compareBigInt;
exports.validateBlockStrict = validateBlockStrict;
exports.validateBlocksStrict = validateBlocksStrict;
exports.assertBigInt = assertBigInt;
const zod_1 = require("zod");
/**
 * Bulletproof type safety layer for Web3 data
 * Designed for developers who value C++-style strong typing
 *
 * Philosophy:
 * - Never trust implicit type conversion in JavaScript
 * - Always use BigInt for Web3 numeric values
 * - Validate at runtime, not just compile-time
 * - Fail fast rather than propagate bad data
 */
/**
 * Strict Block Schema with preprocessing
 * Like C++ template specialization with runtime validation
 */
exports.StrictBlockSchema = zod_1.z.object({
    // Force conversion to BigInt, then validate range
    number: zod_1.z.preprocess((val) => {
        // Accept string, number, or bigint - always output bigint
        if (typeof val === 'bigint')
            return val;
        if (typeof val === 'number')
            return BigInt(val);
        if (typeof val === 'string')
            return BigInt(val);
        throw new Error(`Cannot convert ${typeof val} to bigint`);
    }, zod_1.z.bigint()
        .min(0n, 'Block number must be non-negative')
        .max(2n ** 64n - 1n, 'Block number exceeds uint64 range')),
    // Strict hash validation
    hash: zod_1.z.string()
        .length(66, 'Hash must be exactly 66 characters (0x + 64 hex)')
        .regex(/^0x[a-f0-9]{64}$/, 'Hash must match format 0x[0-9a-f]{64}'),
    // Timestamp as bigint (not number!)
    timestamp: zod_1.z.preprocess((val) => {
        if (typeof val === 'bigint')
            return val;
        if (typeof val === 'number')
            return BigInt(val);
        if (typeof val === 'string')
            return BigInt(val);
        throw new Error(`Cannot convert ${typeof val} to bigint`);
    }, zod_1.z.bigint()
        .min(0n, 'Timestamp cannot be negative')
        .max(BigInt(Math.floor(Date.now() / 1000) + 86400), 'Timestamp too far in future')),
    // Parent hash with explicit handling for genesis block
    parent_hash: zod_1.z.string()
        .length(66, 'Parent hash must be exactly 66 characters')
        .regex(/^0x[a-f0-9]{64}$/, 'Parent hash must match format 0x[0-9a-f]{64}')
        .refine(hash => hash !== '0x0000000000000000000000000000000000000000000000000000000000000', 'Parent hash cannot be zero address for non-genesis blocks')
        .optional(),
});
/**
 * Database Block Schema - explicit BigInt handling
 */
exports.DbBlockSchema = zod_1.z.object({
    // Force bigint even if DB returns string or number
    number: zod_1.z.preprocess((val) => {
        if (typeof val === 'bigint')
            return val;
        return BigInt(val);
    }, zod_1.z.bigint()),
    hash: zod_1.z.string(),
    // Timestamp may be stored as integer, convert to bigint for consistency
    timestamp: zod_1.z.preprocess((val) => {
        if (typeof val === 'bigint')
            return val;
        return BigInt(val);
    }, zod_1.z.bigint()),
    parent_hash: zod_1.z.string(),
    // Timestamps
    created_at: zod_1.z.coerce.date(),
    updated_at: zod_1.z.coerce.date(),
});
/**
 * C++-style "explicit cast" helper
 * Use this whenever comparing numeric values in Web3 context
 */
function toBigInt(val) {
    const result = BigInt(val);
    // Debug logging (like C++ assert)
    if (process.env.NODE_ENV === 'development') {
        // Verify conversion is lossless
        const backToString = result.toString();
        const originalString = String(val);
        if (backToString !== originalString &&
            BigInt(originalString) !== result) {
            console.warn(`[toBigInt] Possible precision loss: ${typeof val}(${val}) -> bigint(${result})`);
        }
    }
    return result;
}
/**
 * C++-style comparison function with explicit typing
 * Like comparing int64_t with size_t in C++
 */
function compareBigInt(a, b, context) {
    const bigIntA = toBigInt(a);
    const bigIntB = toBigInt(b);
    if (bigIntA < bigIntB)
        return -1;
    if (bigIntA > bigIntB)
        return 1;
    return 0;
}
/**
 * Safe block validator with detailed error messages
 * Returns validated data or throws with C++-style error details
 */
function validateBlockStrict(data, context) {
    try {
        return exports.StrictBlockSchema.parse(data);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const details = error.errors.map(e => ({
                path: e.path.join('.'),
                code: e.code,
                message: e.message,
            }));
            throw new Error(`[Block Validation Failed${context ? ` in ${context}` : ''}]\n` +
                `Details:\n${JSON.stringify(details, null, 2)}\n\n` +
                `This is a runtime type safety check, similar to C++ static_cast.\n` +
                `Ensure all numeric values use BigInt for Web3 data.`);
        }
        throw error;
    }
}
/**
 * Batch validator with C++-style vector processing
 */
function validateBlocksStrict(blocks, context) {
    const validated = [];
    const errors = [];
    for (let i = 0; i < blocks.length; i++) {
        try {
            validated.push(validateBlockStrict(blocks[i], `${context}[${i}]`));
        }
        catch (error) {
            errors.push({
                index: i,
                block: blocks[i],
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    if (errors.length > 0) {
        console.error(`[Block Validation] ${errors.length} blocks failed validation:`);
        errors.slice(0, 3).forEach(({ index, error }) => {
            console.error(`  [${index}] ${error}`);
        });
        if (errors.length > 3) {
            console.error(`  ... and ${errors.length - 3} more errors`);
        }
    }
    return validated;
}
/**
 * Type assertion helper - like C++ static_cast with runtime check
 * Throws if type doesn't match expectation
 *
 * ✅ C++风格：严格的类型转换（Strict Type Casting）
 * - 拒绝 null/undefined
 * - 拒绝科学计数法字符串（除非在安全范围内）
 * - 给出明确的错误信息
 */
function assertBigInt(value, context) {
    // ✅ SpaceX哲学：当场炸，拒绝无效值
    if (value === null || value === undefined) {
        throw new TypeError(`${context || 'assertBigInt'}: value is ${value}, expected bigint. ` +
            `Null/undefined values are not allowed.`);
    }
    // 已经是bigint，直接返回
    if (typeof value === 'bigint') {
        return value;
    }
    // 处理number类型
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new TypeError(`${context || 'assertBigInt'}: number ${value} is not a safe integer`);
        }
        const result = BigInt(value);
        console.warn(`[Type Coercion] ${context ? `in ${context}` : ''}: ` +
            `Expected bigint, got number. Converted ${value} -> ${result}`);
        return result;
    }
    // 处理字符串类型
    if (typeof value === 'string') {
        // 检查空字符串
        if (value.trim() === '') {
            throw new TypeError(`${context || 'assertBigInt'}: string is empty, cannot convert to bigint`);
        }
        // 检查科学计数法
        if (value.includes('e') || value.includes('E')) {
            const asNumber = Number(value);
            if (!Number.isSafeInteger(asNumber)) {
                throw new TypeError(`${context || 'assertBigInt'}: string "${value}" in scientific notation ` +
                    `exceeds safe integer range when converted`);
            }
            const result = BigInt(asNumber);
            console.warn(`[Type Coercion] ${context ? `in ${context}` : ''}: ` +
                `Expected bigint, got scientific notation string. Converted "${value}" -> ${result}`);
            return result;
        }
        // 普通字符串
        try {
            const result = BigInt(value);
            console.warn(`[Type Coercion] ${context ? `in ${context}` : ''}: ` +
                `Expected bigint, got string. Converted "${value}" -> ${result}`);
            return result;
        }
        catch (error) {
            throw new TypeError(`${context || 'assertBigInt'}: cannot convert string "${value}" to bigint: ${error}`);
        }
    }
    // 不支持的类型
    throw new TypeError(`${context || 'assertBigInt'}: unsupported type ${typeof value}, value: ${value}`);
}
