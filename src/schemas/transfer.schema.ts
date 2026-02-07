import { z } from 'zod';

/**
 * Ethereum address validator
 * Ensures 0x prefix + 40 hex characters, normalizes to lowercase
 */
export const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format')
  .transform((val) => val.toLowerCase());

/**
 * Ethereum transaction hash validator
 * Ensures 0x prefix + 64 hex characters
 */
export const txHash = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format')
  .transform((val) => val.toLowerCase());

/**
 * Transfer event schema (ERC20 Transfer)
 * Source of truth for all transfer data in the system
 *
 * CRITICAL: This schema is used for runtime validation in sync-engine.
 * Any field mismatch (e.g., token_address vs contract_address) will fail fast.
 */
export const TransferSchema = z.object({
  block_number: z.bigint(),
  transaction_hash: txHash,
  log_index: z.number().int().nonnegative(),
  from_address: ethAddress,
  to_address: ethAddress,
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'), // DECIMAL(78,18) as string
  token_address: ethAddress,
});

export type TransferDTO = z.infer<typeof TransferSchema>;

/**
 * Array validator for batch transfers
 */
export const TransferArraySchema = z.array(TransferSchema);
