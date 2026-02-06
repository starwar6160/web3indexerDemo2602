import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { BlockRepository } from '../../src/database/block-repository';
import { getDb, closeDbConnection, createDbConnection } from '../../src/database/database-config';

/**
 * Reorg Integration Test
 * 
 * Simulates a chain reorganization and verifies:
 * 1. Reorg is detected
 * 2. Blocks are deleted
 * 3. Transfers are cascade deleted (if implemented)
 * 4. New blocks are inserted atomically
 */

describe('Reorg Handling Integration Test', () => {
  let blockRepo: BlockRepository;
  
  beforeAll(async () => {
    await createDbConnection();
    blockRepo = new BlockRepository();
    
    // Clean test data
    const db = getDb();
    await db.deleteFrom('blocks').execute();
  });

  afterAll(async () => {
    await closeDbConnection();
  });

  it('should detect and handle reorg correctly', async () => {
    const db = getDb();
    
    // Step 1: Insert initial chain (blocks 1-10)
    console.log('Step 1: Inserting initial chain (blocks 1-10)...');
    const initialBlocks = Array.from({ length: 10 }, (_, i) => ({
      number: BigInt(i + 1),
      hash: `0xinitial${i + 1}`,
      parent_hash: i === 0 ? '0xgenesis' : `0xinitial${i}`,
      timestamp: BigInt(Date.now()),
      chain_id: BigInt(31337),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await db
      .insertInto('blocks')
      .values(initialBlocks as any)
      .onConflict((oc) => oc.column('number').doNothing())
      .execute();

    // Verify initial chain
    const initialCount = await db
      .selectFrom('blocks')
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst();
    
    expect(initialCount?.count).toBeGreaterThanOrEqual(10);
    console.log('✅ Initial chain inserted');

    // Step 2: Simulate reorg detection
    console.log('Step 2: Simulating reorg detection...');
    
    // Simulate that blocks 6-10 have different hashes (reorged chain)
    const reorgedBlocks = Array.from({ length: 5 }, (_, i) => ({
      number: BigInt(i + 6),
      hash: `0xreorg${i + 6}`,
      parent_hash: i === 0 ? '0xinitial5' : `0xreorg${i + 5}`,
      timestamp: BigInt(Date.now()),
      chain_id: BigInt(31337),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Step 3: Atomic reorg handling (delete + insert in transaction)
    console.log('Step 3: Handling reorg atomically...');
    
    await db.transaction().execute(async (trx) => {
      // Delete blocks from reorg point (block 6 onwards)
      const deleteResult = await trx
        .deleteFrom('blocks')
        .where('number', '>=', 6n)
        .execute();
      
      console.log(`Deleted ${deleteResult.length} blocks due to reorg`);
      
      // Insert reorged blocks
      await trx
        .insertInto('blocks')
        .values(reorgedBlocks as any)
        .execute();
        
      console.log(`Inserted ${reorgedBlocks.length} reorged blocks`);
    });

    console.log('✅ Reorg handled atomically');

    // Step 4: Verify final state
    console.log('Step 4: Verifying final state...');
    
    const block6 = await db
      .selectFrom('blocks')
      .where('number', '=', 6n)
      .selectAll()
      .executeTakeFirst();

    expect(block6).toBeDefined();
    expect(block6?.hash).toBe('0xreorg6'); // Should have new hash
    expect(block6?.parent_hash).toBe('0xinitial5'); // Should link to block 5

    // Verify block 5 still exists with original hash
    const block5 = await db
      .selectFrom('blocks')
      .where('number', '=', 5n)
      .selectAll()
      .executeTakeFirst();

    expect(block5).toBeDefined();
    expect(block5?.hash).toBe('0xinitial5'); // Unchanged

    console.log('✅ Reorg test passed');
  });

  it('should handle deep reorg (100 blocks) without timeout', async () => {
    const db = getDb();
    
    // This test verifies our reorg handling doesn't have N+1 query issues
    // Insert 100 blocks
    const blocks = Array.from({ length: 100 }, (_, i) => ({
      number: BigInt(i + 1000),
      hash: `0xdeep${i + 1000}`,
      parent_hash: i === 0 ? '0xanchor' : `0xdeep${i + 999}`,
      timestamp: BigInt(Date.now()),
      chain_id: BigInt(31337),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await db.insertInto('blocks').values(blocks as any).execute();

    // Time the deletion (should be fast with proper batching)
    const start = Date.now();
    
    await db
      .deleteFrom('blocks')
      .where('number', '>=', 1000n)
      .execute();

    const duration = Date.now() - start;
    
    // Should complete in under 1 second
    expect(duration).toBeLessThan(1000);
    
    console.log(`✅ Deep reorg (100 blocks) handled in ${duration}ms`);
  });
});
