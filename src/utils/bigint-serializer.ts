/**
 * BigInt 递归转换工具
 *
 * 在API输出前递归扫描对象中的所有 bigint 并转化为 string。
 * 解决 JSON.stringify 无法序列化 bigint 的问题。
 */

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

/**
 * 递归转换对象中的所有 bigint 为 string
 *
 * @param value - 任意值
 * @returns 转换后的JSON可序列化值
 *
 * 使用示例:
 * ```typescript
 * const block = { number: 123n, hash: "0x..." };
 * const response = serializeBigInt(block);
 * // 结果: { number: "123", hash: "0x..." }
 * ```
 */
export function serializeBigInt(value: unknown): JsonValue {
  // 处理 bigint
  if (typeof value === 'bigint') {
    return value.toString();
  }

  // 处理 null
  if (value === null) {
    return null;
  }

  // 处理 undefined (转换为 null，因为JSON中没有undefined)
  if (value === undefined) {
    return null;
  }

  // 处理 Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // 处理数组
  if (Array.isArray(value)) {
    return value.map(item => serializeBigInt(item));
  }

  // 处理对象
  if (typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeBigInt(val);
    }
    return result;
  }

  // 处理基本类型 (string, number, boolean)
  return value as JsonValue;
}

/**
 * 批量序列化数组
 */
export function serializeBigIntArray<T>(items: T[]): JsonArray {
  return items.map(item => serializeBigInt(item));
}

/**
 * 创建API响应包装器
 * 自动序列化所有 bigint 字段
 */
export function createApiResponse<T>(data: T, meta?: Record<string, unknown>) {
  return {
    success: true,
    data: serializeBigInt(data),
    meta: meta ? serializeBigInt(meta) : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 创建错误响应
 */
export function createErrorResponse(message: string, code?: string, details?: unknown) {
  return {
    success: false,
    error: {
      message,
      code,
      details: details ? serializeBigInt(details) : undefined,
    },
    timestamp: new Date().toISOString(),
  };
}
