# Testing Guide

## Running Tests

The tests are compiled to JavaScript and run directly.

### Quick Start

```bash
# Run all tests
npm run test:all

# Run only reorg tests
npm run test:reorg

# Run only stress tests
npm run test:stress
```

## Test Categories

### 1. Reorg Tests (`tests/reorg.test.ts`)

Tests the indexer's ability to handle chain reorganizations:

- **Test 1**: Simple reorg detection - Verifies no false positives
- **Test 2**: Reorg with existing block - Tests block hash mismatch detection
- **Test 3**: Chain continuity verification - Ensures parent-child linkage
- **Test 4**: Reorg rollback - Tests atomic rollback to common ancestor

**What it tests**:
- Parent hash verification
- Common ancestor detection
- Atomic database rollback
- Chain integrity

### 2. Stress Tests (`tests/stress.test.ts`)

Tests performance under load and failure scenarios:

- **Test 1**: Consecutive RPC failures - Tests retry logic
- **Test 2**: Rate limiter stress test - Verifies rate limiting works
- **Test 3**: Database resilience - Tests concurrent queries
- **Test 4**: Large batch writes - Tests 1000 block batch
- **Test 5**: Memory leak check - Tests for memory issues
- **Test 6**: Transaction rollback - Tests ACID guarantees

**What it tests**:
- Retry mechanisms
- Rate limiting
- Database connection pooling
- Memory management
- Transaction atomicity

## Test Requirements

### Database Tests

The reorg and stress tests require a PostgreSQL database. Set the `DATABASE_URL` environment variable:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/test_db"
```

### RPC Tests (Optional)

Some stress tests can optionally use a real RPC endpoint:

```bash
export TEST_RPC_URL="http://localhost:8545"
```

If not provided, these tests will be skipped or use mock data.

## Expected Output

### Successful Test Run

```
🧪 Running Reorganization Tests...

=== Test 1: Simple Reorg Detection ===
✅ Inserted 10 blocks
✅ Test 1 passed: No false positive reorg detection

=== Test 2: Reorg With Existing Block ===
✅ Inserted 10 original blocks
✅ Test 2 passed: No reorg when parent exists

=== Test 3: Chain Continuity Verification ===
✅ Inserted genesis block
✅ Genesis block continuity verified
✅ Block 1 continuity verified
✅ Correctly rejected block with missing parent
✅ Test 3 passed: Chain continuity verification works

=== Test 4: Reorg Rollback ===
✅ Inserted 20 blocks
Blocks before reorg: 20
Deleted 4 blocks
Blocks after reorg: 16
✅ Test 4 passed: Reorg rollback works correctly

✅ All reorg tests passed!

🧪 Running Stress Tests...

=== Test 1: Consecutive RPC Failures ===
Failures: 10, Success after retry: false
✅ Test 1 passed: Handles consecutive RPC failures

=== Test 2: Rate Limiter Stress Test ===
Made 100 requests in XXms
Throttled XX times
Tokens remaining: XX
✅ Test 2 passed: Rate limiter works under stress

=== Test 3: Database Connection Resilience ===
Executed 50 concurrent queries
✅ Test 3 passed: Database handles concurrent queries

=== Test 4: Large Batch Write Test ===
Creating 1000 blocks...
Inserting blocks in transaction...
Saved 1000 blocks in XXms
Average: XXms per block
✅ Test 4 passed: Large batch write works

=== Test 5: Memory Leak Check ===
Initial memory usage: { heapUsed: 'XXMB', heapTotal: 'XXMB' }
Final memory usage: { heapUsed: 'XXMB', heapTotal: 'XXMB' }
Heap growth: XXMB
✅ Test 5 passed: No significant memory leaks detected

=== Test 6: Transaction Rollback on Error ===
Inserted 5 initial blocks
Blocks before failed transaction: 5
✅ Transaction failed as expected
Blocks after failed transaction: 5
✅ Test 6 passed: Transaction rollback works correctly

✅ All stress tests passed!
```

## Troubleshooting

### "Database connection failed"

Ensure PostgreSQL is running and `DATABASE_URL` is set correctly:

```bash
# Check if PostgreSQL is running
psql -h localhost -U user -d test_db

# Or using Docker
docker ps | grep postgres
```

### "TypeScript compilation failed"

Make sure you've built the project:

```bash
npm run build
```

### Tests timing out

Some tests (like large batch writes) may take time. Increase timeout if needed:

```bash
# Run with longer timeout
timeout 300 npm run test:all
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - run: npm ci
      - run: npm run build
      - run: npm run test:all
        env:
          DATABASE_URL: postgresql://user:password@localhost:5432/test_db
```

## Contributing Tests

When adding new functionality:

1. Add tests to the appropriate test file
2. Ensure tests are isolated (cleanup after themselves)
3. Use descriptive test names
4. Add comments explaining what is being tested
5. Update this documentation

## Test Coverage

Currently tested:

- ✅ Reorg detection and handling
- ✅ Chain continuity verification
- ✅ Transaction atomicity
- ✅ Retry mechanisms
- ✅ Rate limiting
- ✅ Database resilience
- ✅ Memory management
- ✅ Large batch operations

Areas for future testing:

- [ ] Integration tests with real RPC endpoints
- [ ] Performance benchmarks
- [ ] Load testing with concurrent indexers
- [ ] Failover scenarios
- [ ] Network partition simulation

## Support

If tests fail:
1. Check the logs for specific error messages
2. Ensure all dependencies are installed
3. Verify database connectivity
4. Check environment variables
5. Review the test output for clues
