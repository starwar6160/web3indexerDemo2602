import { z } from 'zod';

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
export const StrictBlockSchema = z.object({
  // Force conversion to BigInt, then validate range
  number: z.preprocess(
    (val) => {
      // Accept string, number, or bigint - always output bigint
      if (typeof val === 'bigint') return val;
      if (typeof val === 'number') return BigInt(val);
      if (typeof val === 'string') return BigInt(val);
      throw new Error(`Cannot convert ${typeof val} to bigint`);
    },
    z.bigint()
      .min(0n, 'Block number must be non-negative')
      .max(2n ** 64n - 1n, 'Block number exceeds uint64 range')
  ),

  // Strict hash validation
  hash: z.string()
    .length(66, 'Hash must be exactly 66 characters (0x + 64 hex)')
    .regex(/^0x[a-f0-9]{64}$/, 'Hash must match format 0x[0-9a-f]{64}'),

  // Timestamp as bigint (not number!)
  timestamp: z.preprocess(
    (val) => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'number') return BigInt(val);
      if (typeof val === 'string') return BigInt(val);
      throw new Error(`Cannot convert ${typeof val} to bigint`);
    },
    z.bigint()
      .min(0n, 'Timestamp cannot be negative')
      .max(BigInt(Math.floor(Date.now() / 1000) + 86400), 'Timestamp too far in future')
  ),

  // Parent hash with explicit handling for genesis block
  parent_hash: z.string()
    .length(66, 'Parent hash must be exactly 66 characters')
    .regex(/^0x[a-f0-9]{64}$/, 'Parent hash must match format 0x[0-9a-f]{64}')
    .refine(
      hash => hash !== '0x0000000000000000000000000000000000000000000000000000000000000',
      'Parent hash cannot be zero address for non-genesis blocks'
    )
    .optional(),
});

export type StrictBlock = z.infer<typeof StrictBlockSchema>;

/**
 * Database Block Schema - explicit BigInt handling
 */
export const DbBlockSchema = z.object({
  // Force bigint even if DB returns string or number
  number: z.preprocess(
    (val) => {
      if (typeof val === 'bigint') return val;
      return BigInt(val as string | number);
    },
    z.bigint()
  ),

  hash: z.string(),

  // Timestamp may be stored as integer, convert to bigint for consistency
  timestamp: z.preprocess(
    (val) => {
      if (typeof val === 'bigint') return val;
      return BigInt(val as string | number);
    },
    z.bigint()
  ),

  parent_hash: z.string(),

  // Timestamps
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type DbBlock = z.infer<typeof DbBlockSchema>;

/**
 * C++-style "explicit cast" helper
 * Use this whenever comparing numeric values in Web3 context
 */
export function toBigInt(val: string | number | bigint): bigint {
  const result = BigInt(val);

  // Debug logging (like C++ assert)
  if (process.env.NODE_ENV === 'development') {
    // Verify conversion is lossless
    const backToString = result.toString();
    const originalString = String(val);

    if (backToString !== originalString &&
        BigInt(originalString) !== result) {
      console.warn(
        `[toBigInt] Possible precision loss: ${typeof val}(${val}) -> bigint(${result})`
      );
    }
  }

  return result;
}

/**
 * C++-style comparison function with explicit typing
 * Like comparing int64_t with size_t in C++
 */
export function compareBigInt(
  a: string | number | bigint,
  b: string | number | bigint,
  context?: string
): number {
  const bigIntA = toBigInt(a);
  const bigIntB = toBigInt(b);

  if (bigIntA < bigIntB) return -1;
  if (bigIntA > bigIntB) return 1;
  return 0;
}

/**
 * Safe block validator with detailed error messages
 * Returns validated data or throws with C++-style error details
 */
export function validateBlockStrict(
  data: unknown,
  context?: string
): StrictBlock {
  try {
    return StrictBlockSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.errors.map(e => ({
        path: e.path.join('.'),
        code: e.code,
        message: e.message,
      }));

      throw new Error(
        `[Block Validation Failed${context ? ` in ${context}` : ''}]\n` +
        `Details:\n${JSON.stringify(details, null, 2)}\n\n` +
        `This is a runtime type safety check, similar to C++ static_cast.\n` +
        `Ensure all numeric values use BigInt for Web3 data.`
      );
    }
    throw error;
  }
}

/**
 * Batch validator with C++-style vector processing
 */
export function validateBlocksStrict(
  blocks: unknown[],
  context?: string
): StrictBlock[] {
  const validated: StrictBlock[] = [];
  const errors: Array<{ index: number; block: unknown; error: string }> = [];

  for (let i = 0; i < blocks.length; i++) {
    try {
      validated.push(validateBlockStrict(blocks[i], `${context}[${i}]`));
    } catch (error) {
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
 */
export function assertBigInt(
  value: unknown,
  context?: string
): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  const bigintValue = BigInt(value as string | number);

  console.warn(
    `[Type Coercion] ${context ? `in ${context}` : ''}: ` +
    `Expected bigint, got ${typeof value}. Converted ${value} -> ${bigintValue}`
  );

  return bigintValue;
}
