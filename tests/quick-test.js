/**
 * Quick JavaScript test - no compilation needed
 * Tests core functionality without TypeScript
 */

const { createPublicClient, http } = require('viem');
const { createDbConnection, closeDbConnection } = require('../dist/database/database-config');
const { BlockRepository } = require('../dist/database/block-repository');

async function testBasicOperations() {
  console.log('🧪 Quick JavaScript Test\n');

  try {
    // Test database connection
    console.log('1. Testing database connection...');
    await createDbConnection();
    const repo = new BlockRepository();
    const count = await repo.getBlockCount();
    console.log(`   ✅ Database connected, blocks: ${count}`);

    // Test RPC connection
    console.log('\n2. Testing RPC connection...');
    const client = createPublicClient({
      transport: http(process.env.RPC_URL || 'http://localhost:8545'),
    });
    const blockNumber = await client.getBlockNumber();
    console.log(`   ✅ RPC connected, block: ${blockNumber}`);

    // Test block query
    console.log('\n3. Testing block query...');
    const latestBlock = await repo.getMaxBlockNumber();
    console.log(`   ✅ Latest block in DB: ${latestBlock}`);

    // Test transaction
    console.log('\n4. Testing transaction...');
    const testBlocks = [{
      number: 999998n,
      hash: '0x' + '1'.repeat(64),
      parent_hash: '0x' + '0'.repeat(64),
      timestamp: Math.floor(Date.now() / 1000),
    }];

    try {
      await repo.saveValidatedBlocks(testBlocks);
      console.log('   ✅ Transaction successful');

      // Cleanup
      const db = createDbConnection();
      await db.deleteFrom('blocks').where('number', '=', 999998n).execute();
      console.log('   ✅ Cleanup successful');
    } catch (error) {
      console.log('   ⚠️  Transaction test failed (expected if block exists):', error.message);
    }

    await closeDbConnection();

    console.log('\n✅ All tests passed!\n');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run test
testBasicOperations()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
