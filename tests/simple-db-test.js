const { Pool } = require('pg');

async function testDatabase() {
  console.log('🧪 Simple Database Test\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer',
  });

  try {
    console.log('1. Connecting to database...');
    const client = await pool.connect();
    console.log('   ✅ Connected');

    console.log('\n2. Checking blocks table...');
    const result = await client.query('SELECT COUNT(*) as count FROM blocks');
    console.log(`   ✅ Found ${result.rows[0].count} blocks`);

    console.log('\n3. Checking table structure...');
    const schema = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'blocks'
      ORDER BY ordinal_position
    `);
    console.log('   Columns:');
    schema.rows.forEach(row => {
      console.log(`      - ${row.column_name}: ${row.data_type}`);
    });

    console.log('\n4. Checking indexes...');
    const indexes = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'blocks'
    `);
    console.log(`   ✅ Found ${indexes.rows.length} indexes`);
    indexes.rows.forEach(row => {
      console.log(`      - ${row.indexname}`);
    });

    client.release();

    console.log('\n✅ Database test passed!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    if (error.code === '3D000') {
      console.log('\n💡 Run: npm run db:init');
    }

    await pool.end();
    process.exit(1);
  }
}

testDatabase();
