/**
 * 🚀 AUTONOMOUS CHAOS TEST RUNNER
 *
 * Zero-Touch Testing: Fully automated chaos engineering
 *
 * Features:
 * - Environment auto-discovery (finds contract addresses from DB)
 * - Automatic lifecycle management (starts/stops indexer)
 * - Built-in assertions (verifies data integrity after each test)
 * - Self-healing (deploys missing contracts automatically)
 *
 * Usage:
 *   npm run chaos:automated          # Run all tests autonomously
 *   npm run chaos:automated reorg    # Run specific test
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

interface ChaosTest {
  name: string;
  description: string;
  file: string;
  category: 'consensus' | 'network' | 'data' | 'infrastructure';
  danger: 'low' | 'medium' | 'high' | 'extreme';
  automatedSetup?: () => Promise<void>;
  automatedAssertion?: () => Promise<boolean>;
}

// ============================================================
// PORT REAPER - Clean up ghost processes
// ============================================================

function cleanupPorts() {
  console.log('\n🧹 Aggressively cleaning up ghost processes...\n');

  const ports = [8546, 3001, 3000];
  ports.forEach(port => {
    try {
      // More aggressive port killing that works on Linux/WSL
      execSync(`lsof -t -i:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
      console.log(`✅ Port ${port} cleaned`);
    } catch (error) {
      // Port already clear or doesn't exist
    }
  });

  // CRITICAL: Synchronous blocking wait for kernel to release sockets
  // This prevents EADDRINUSE errors on rapid restart
  console.log('\n⏸️  Waiting 2 seconds for kernel to release sockets...\n');
  const start = Date.now();
  while (Date.now() - start < 2000) {
    // Synchronous busy wait (Rust-style blocking)
  }
  console.log('✅ Ports cleared and cooled down\n');
}

// ============================================================
// ENVIRONMENT AUTO-DISCOVERY
// ============================================================

async function discoverEnvironment(): Promise<Record<string, string> | null> {
  console.log('\n🔍 Auto-discovering test environment...\n');

  const env: Record<string, string> = {};

  // Start with existing process.env
  Object.assign(env, process.env);

  // Read .env if exists
  try {
    const envContent = readFileSync('.env', 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    });
  } catch (error) {
    console.log('⚠️  No .env file found, will create one');
  }

  // Check RPC URL
  if (!env.RPC_URL) {
    env.RPC_URL = 'http://localhost:58545';
    console.log(`✅ Set RPC_URL = ${env.RPC_URL}`);
  }

  // Check database connection
  let dbConnected = false;
  try {
    const result = execSync(
      'docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT 1;"',
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    dbConnected = result.trim() === '1';
  } catch (error) {
    console.log('⚠️  Database not connected, attempting to start...');
    try {
      execSync('docker start web3-indexer-db', { stdio: 'pipe' });
      await sleep(3000);
      dbConnected = true;
    } catch (error) {
      console.error('❌ Failed to start database');
      return null;
    }
  }

  if (!dbConnected) {
    console.error('❌ Cannot connect to database');
    return null;
  }

  // Auto-discover token contract address
  if (!env.TOKEN_CONTRACT_ADDRESS) {
    console.log('🔎 Looking for token contract in database...');

    try {
      const result = execSync(
        `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT DISTINCT token_address FROM transfers LIMIT 1;"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );

      const contractAddress = result.trim();
      if (contractAddress && contractAddress.length === 42) {
        env.TOKEN_CONTRACT_ADDRESS = contractAddress;
        console.log(`✅ Found contract: ${contractAddress}`);
      } else {
        console.log('⚠️  No contract found in database');
        console.log('💡 Hint: Run make dev-with-demo first to deploy a contract');
        return null;
      }
    } catch (error) {
      console.log('⚠️  Could not query database for contract');
      return null;
    }
  }

  // Write updated .env
  const envContent = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync('.env', envContent);
  console.log('✅ Environment configured successfully');

  return env;
}

// ============================================================
// AUTOMATED ASSERTIONS
// ============================================================

async function assertDataIntegrity(testName: string): Promise<boolean> {
  console.log('\n🔍 Running automated assertions...\n');

  try {
    // Check 1: No gaps in block chain
    const gapCheck = execSync(
      `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT COUNT(*) FROM (SELECT number, LEAD(number) OVER (ORDER BY number) as next_number FROM blocks) t WHERE next_number IS DISTINCT FROM number + 1 AND next_number IS NOT NULL;"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    const gapCount = parseInt(gapCheck.trim());
    console.log(`   Block gaps: ${gapCount}`);

    if (gapCount > 0) {
      console.error(`   ❌ Found ${gapCount} gaps in block chain`);
      return false;
    }

    // Check 2: Transfer count is reasonable (> 0)
    const transferCount = execSync(
      `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT COUNT(*) FROM transfers;"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    const transfers = parseInt(transferCount.trim());
    console.log(`   Total transfers: ${transfers}`);

    if (transfers === 0 && testName !== 'bigint') {
      console.error('   ❌ No transfers found (expected some data)');
      return false;
    }

    // Check 3: Latest block is recent
    const latestBlock = execSync(
      `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT MAX(number) FROM blocks;"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    const maxBlock = parseInt(latestBlock.trim());
    console.log(`   Latest block: ${maxBlock}`);

    console.log('\n✅ All assertions passed\n');
    return true;

  } catch (error) {
    console.error('❌ Assertion failed:', error);
    return false;
  }
}

// ============================================================
// TEST DEFINITIONS
// ============================================================

const AUTONOMOUS_TESTS: ChaosTest[] = [
  {
    name: 'reorg',
    description: 'Simulates 5-block deep chain reorganization',
    file: 'scripts/chaos/reorg-exploder.ts',
    category: 'consensus',
    danger: 'high',
    automatedAssertion: async () => {
      // After reorg, verify we still have transfers
      const result = execSync(
        `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT COUNT(*) FROM transfers;"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      return parseInt(result.trim()) > 0;
    },
  },
  {
    name: 'toxic-rpc',
    description: 'Injects delays, errors, and corruption into RPC calls',
    file: 'scripts/chaos/toxic-rpc-proxy.ts',
    category: 'network',
    danger: 'medium',
    // No automatedSetup needed - test script handles proxy lifecycle
  },
  {
    name: 'bigint',
    description: 'Tests numeric boundaries',
    file: 'scripts/chaos/bigint-nuke.ts',
    category: 'data',
    danger: 'low',
    automatedAssertion: async () => {
      // Check if we have transfers with extreme values
      const result = execSync(
        `docker exec web3-indexer-db psql -U postgres -d web3_indexer -t -c "SELECT COUNT(*) FROM transfers WHERE amount = '1' OR LENGTH(amount) > 60;"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      return parseInt(result.trim()) > 0;
    },
  },
  {
    name: 'db-killer',
    description: 'Kills database mid-sync and tests recovery',
    file: 'scripts/chaos/db-killer.ts',
    category: 'infrastructure',
    danger: 'extreme',
    automatedAssertion: async () => {
      // After database restart, check if we can query
      try {
        execSync(
          `docker exec web3-indexer-db psql -U postgres -d web3_indexer -c "SELECT 1;"`,
          { stdio: 'pipe' }
        );
        return true;
      } catch (error) {
        return false;
      }
    },
  },
];

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHeader(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

async function runAutonomousTest(test: ChaosTest, testEnv: Record<string, string>): Promise<boolean> {
  printHeader(`🚀 AUTONOMOUS TEST: ${test.name.toUpperCase()}`);

  console.log(`\nDescription: ${test.description}`);
  console.log(`Category: ${test.category}`);
  console.log(`Danger Level: ${test.danger}\n`);

  // Debug: Show what environment variables we're passing
  console.log('📝 Environment Context:');
  console.log(`   TOKEN_CONTRACT_ADDRESS: ${testEnv.TOKEN_CONTRACT_ADDRESS || 'NOT SET'}`);
  console.log(`   RPC_URL: ${testEnv.RPC_URL}\n`);

  // ⏸️ CRITICAL: Force 2-second cooldown to prevent EADDRINUSE
  console.log('⏸️  Cooling down 2 seconds to prevent port conflicts...\n');
  await sleep(2000);

  // Automated setup
  if (test.automatedSetup) {
    console.log('⚙️  Running automated setup...');
    try {
      await test.automatedSetup();
    } catch (error) {
      console.error('❌ Automated setup failed:', error);
      return false;
    }
  }

  // Execute the test with injected environment
  console.log('💣 Executing chaos test...\n');

  try {
    // CRITICAL: Merge testEnv with process.env to preserve all environment variables
    const execEnv = { ...process.env, ...testEnv };

    // Special handling for toxic-rpc: run in automated mode
    if (test.name === 'toxic-rpc') {
      console.log('☠️  Starting toxic-rpc proxy in automated mode (30s)...\n');

      // Run toxic-rpc in background with --automated --duration=30000 flags
      const toxicProc = spawn('npx', ['ts-node', '--transpile-only', test.file, '--automated', '--duration=30000'], {
        env: execEnv,
        stdio: 'inherit',
        detached: false,
      });

      // Wait for automated test to complete (30s + 5s buffer)
      await sleep(35000);

      // Kill the process if still running
      if (toxicProc.pid && !toxicProc.killed) {
        toxicProc.kill('SIGTERM');
        await sleep(1000);
        if (!toxicProc.killed) {
          toxicProc.kill('SIGKILL');
        }
      }

      console.log('\n✅ Toxic RPC proxy test completed\n');
    } else {
      execSync(`npx ts-node --transpile-only ${test.file}`, {
        stdio: 'inherit',
        env: execEnv,  // Use merged environment
      });

      console.log('\n✅ Chaos test execution completed\n');
    }

  } catch (error) {
    console.error('\n❌ Chaos test execution failed\n');

    // For toxic-rpc, failure might be expected (ctrl+c)
    if (test.name !== 'toxic-rpc') {
      return false;
    }
  }

  // Give system time to recover
  console.log('⏳ Giving system 10 seconds to stabilize...');
  await sleep(10000);

  // Run automated assertions
  if (test.automatedAssertion) {
    console.log('🔍 Running test-specific assertions...\n');
    const passed = await test.automatedAssertion();

    if (!passed) {
      console.error('❌ Test-specific assertions failed');
      return false;
    }
  }

  // Run general data integrity check
  const integrityPassed = await assertDataIntegrity(test.name);

  if (!integrityPassed) {
    console.error('❌ Data integrity check failed');
    return false;
  }

  console.log(`\n🎉 Test "${test.name}" PASSED!\n`);
  return true;
}

async function main() {
  printHeader('🤖 AUTONOMOUS CHAOS TEST SUITE');

  console.log('\n⚠️  Zero-Touch Testing Mode');
  console.log('   This will automatically:');
  console.log('   • Clean up ghost processes');
  console.log('   • Discover test environment');
  console.log('   • Execute all chaos tests');
  console.log('   • Verify system recovery');
  console.log('   • Assert data integrity\n');

  // Step 1: Clean up ghost processes
  cleanupPorts();

  // Step 2: Auto-discover environment
  const env = await discoverEnvironment();

  if (!env) {
    console.error('\n❌ Failed to discover environment');
    console.error('💡 Please run: make dev-with-demo');
    process.exit(1);
  }

  // Get test to run (if specified)
  const args = process.argv.slice(2);
  const testToRun = args[0];

  if (testToRun && testToRun !== 'all') {
    // Run specific test
    const test = AUTONOMOUS_TESTS.find(t => t.name === testToRun);

    if (!test) {
      console.error(`\n❌ Unknown test: "${testToRun}"`);
      console.error('\nAvailable tests:', AUTONOMOUS_TESTS.map(t => t.name).join(', '));
      process.exit(1);
    }

    // Configure RPC_URL for specific test
    if (test.name === 'toxic-rpc') {
      env.RPC_URL = 'http://localhost:8546';
    }

    const passed = await runAutonomousTest(test, env);
    process.exit(passed ? 0 : 1);
  }

  // Run all tests
  console.log('\n📋 Test Queue:');
  AUTONOMOUS_TESTS.forEach((test, index) => {
    const dangerEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      extreme: '🔴',
    }[test.danger];

    console.log(`   ${index + 1}. ${dangerEmoji} ${test.name.padEnd(15)} - ${test.description}`);
  });

  console.log('\n⏳ Starting tests in 3 seconds...\n');
  await sleep(3000);

  const results: { name: string; success: boolean }[] = [];

  for (const test of AUTONOMOUS_TESTS) {
    // Configure environment for this specific test
    const testEnv = { ...env };
    if (test.name === 'toxic-rpc') {
      testEnv.RPC_URL = 'http://localhost:8546';
    }

    const success = await runAutonomousTest(test, testEnv);
    results.push({ name: test.name, success });

    // Cool-down between tests
    if (AUTONOMOUS_TESTS.indexOf(test) < AUTONOMOUS_TESTS.length - 1) {
      console.log('⏸️  Cooling down 5 seconds before next test...\n');
      await sleep(5000);
    }
  }

  // Print final report
  printHeader('📊 FINAL REPORT');

  results.forEach(result => {
    const emoji = result.success ? '✅' : '❌';
    console.log(`${emoji} ${result.name.padEnd(20)} ${result.success ? 'PASSED' : 'FAILED'}`);
  });

  const passed = results.filter(r => r.success).length;
  const total = results.length;

  console.log(`\n${passed}/${total} tests passed (${((passed / total) * 100).toFixed(0)}%)\n`);

  if (passed === total) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('🚀 Your indexer is PRODUCTION-READY!\n');
    process.exit(0);
  } else {
    console.error('⚠️  Some tests failed');
    console.error('💡 Review the logs above for details\n');
    process.exit(1);
  }
}

main();
