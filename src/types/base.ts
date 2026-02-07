import { z } from 'zod';

/**
 * 真相来源 (Single Source of Truth)
 *
 * 手动定义基础类型，避免 Kysely 和 Viem 类型冲突。
 * 所有数据获取后第一时间转换为这些类型。
 */

// ============ BaseBlock - 真相来源 ============
export interface BaseBlock {
  number: bigint;
  hash: string;
  timestamp: bigint;
  parentHash: string;
  chainId?: bigint;
}

// ============ BaseTransfer - 真相来源 ============
export interface BaseTransfer {
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
}

// ============ RPC响应验证Schema (入口硬校验) ============

/**
 * Viem getBlock 返回数据的验证Schema
 * 在RPC数据入口处强制执行校验
 */
export const RpcBlockSchema = z.object({
  number: z.bigint().min(0n),
  hash: z.string().regex(/^0x[a-f0-9]{64}$/),
  timestamp: z.bigint().min(0n),
  parentHash: z.string().regex(/^0x[a-f0-9]{64}$/),
}).transform((data): BaseBlock => ({
  number: data.number,
  hash: data.hash,
  timestamp: data.timestamp,
  parentHash: data.parentHash,
}));

/**
 * 批量验证RPC返回的区块数据
 * SpaceX哲学：任何一条数据有问题 → 整个批次失败
 */
export function validateRpcBlocks(rpcData: unknown[]): BaseBlock[] {
  // 输入清理 - 过滤 null/undefined
  const sanitized = rpcData.filter((item, index) => {
    if (item === null || item === undefined) {
      console.error(`[validateRpcBlocks] Item at index ${index} is ${item}`);
      throw new Error(`RPC returned null/undefined at index ${index}`);
    }
    return true;
  });

  // 逐个验证并转换
  return sanitized.map((item, index) => {
    try {
      return RpcBlockSchema.parse(item);
    } catch (error) {
      console.error(`[validateRpcBlocks] Validation failed at index ${index}:`, error);
      throw new Error(`Block at index ${index} failed RPC validation: ${error}`);
    }
  });
}

/**
 * Transfer事件验证Schema
 */
export const RpcTransferSchema = z.object({
  args: z.object({
    from: z.string().regex(/^0x[a-f0-9]{40}$/i),
    to: z.string().regex(/^0x[a-f0-9]{40}$/i),
    value: z.bigint(),
  }),
  blockNumber: z.bigint(),
  transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  logIndex: z.number().int().min(0),
}).transform((data): BaseTransfer => ({
  from: data.args.from,
  to: data.args.to,
  value: data.args.value,
  blockNumber: data.blockNumber,
  transactionHash: data.transactionHash,
  logIndex: data.logIndex,
}));

export function validateRpcTransfers(rpcData: unknown[]): BaseTransfer[] {
  return rpcData.map((item, index) => {
    try {
      return RpcTransferSchema.parse(item);
    } catch (error) {
      console.error(`[validateRpcTransfers] Validation failed at index ${index}:`, error);
      throw new Error(`Transfer at index ${index} failed RPC validation: ${error}`);
    }
  });
}
