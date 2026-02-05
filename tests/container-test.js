/**
 * 简化的容器测试 - 不依赖编译
 * 使用 ts-node 直接运行
 */

const { createPublicClient, http } = require('viem');
const pg = require('pg');

const { Pool } = pg;

async function testBasicOperations() {
  console.log('🧪 Container-Friendly Test\n');

  // 数据库配置
  const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer',
  };

  const pool = new Pool(dbConfig);

  try {
    // Test 1: 数据库连接
    console.log('1. Testing database connection...');
    const client = await pool.connect();

    const result = await client.query('SELECT COUNT(*) FROM blocks');
    const blockCount = result.rows[0].count;

    console.log(`   ✅ Database connected, blocks: ${blockCount}`);

    client.release();

    // Test 2: RPC 连接
    console.log('\n2. Testing RPC connection...');
    const rpcUrl = process.env.RPC_URL || 'http://localhost:58545'; // Anvil 映射到 58545 端口

    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });

    const blockNumber = await publicClient.getBlockNumber();
    console.log(`   ✅ RPC connected, block: ${blockNumber}`);

    // Test 3: 查询最新区块
    console.log('\n3. Testing block query...');
    const latestResult = await pool.query(
      'SELECT number FROM blocks ORDER BY number DESC LIMIT 1'
    );

    if (latestResult.rows.length > 0) {
      console.log(`   ✅ Latest block in DB: ${latestResult.rows[0].number}`);
    } else {
      console.log('   ⚠️  No blocks in database');
    }

    // Test 4: 查询区块范围
    console.log('\n4. Testing block range...');
    const rangeResult = await pool.query(
      'SELECT MIN(number) as min_block, MAX(number) as max_block FROM blocks'
    );

    if (rangeResult.rows.length > 0 && rangeResult.rows[0].min_block) {
      console.log(`   ✅ Block range: ${rangeResult.rows[0].min_block} to ${rangeResult.rows[0].max_block}`);
    }

    // Test 5: 检查索引
    console.log('\n5. Checking indexes...');
    const indexResult = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'blocks'
      ORDER BY indexname
    `);

    console.log(`   ✅ Found ${indexResult.rows.length} indexes:`);
    indexResult.rows.forEach(row => {
      console.log(`      - ${row.indexname}`);
    });

    // Test 6: 检查表结构
    console.log('\n6. Checking table structure...');
    const schemaResult = await pool.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'blocks'
      ORDER BY ordinal_position
    `);

    console.log('   ✅ Blocks table structure:');
    schemaResult.rows.forEach(row => {
      const maxLength = row.character_maximum_length
        ? `(${row.character_maximum_length})`
        : '';
      console.log(`      - ${row.column_name}: ${row.data_type}${maxLength}`);
    });

    console.log('\n✅ All container tests passed!\n');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    if (error.code === '3D000') {
      console.error('\n💡 Hint: Database does not exist. Run: npm run db:init');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Hint: Cannot connect to database. Check DATABASE_URL');
    }

    return false;
  } finally {
    await pool.end();
  }
}

// 运行测试
testBasicOperations()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
