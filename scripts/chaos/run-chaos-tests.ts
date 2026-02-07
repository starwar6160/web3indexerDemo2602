/**
 * CHAOS MONKEY ORCHESTRATOR 🐵
 *
 * Runs all chaos engineering tests in sequence or individually
 *
 * Usage:
 *   npx ts-node scripts/chaos/run-chaos-tests.ts              # Run all tests
 *   npx ts-node scripts/chaos/run-chaos-tests.ts reorg         # Run specific test
 *   npx ts-node scripts/chaos/run-chaos-tests.ts --list        # List all tests
 */

import { execSync } from 'child_process';

interface ChaosTest {
  name: string;
  description: string;
  file: string;
  category: 'consensus' | 'network' | 'data' | 'infrastructure';
  danger: 'low' | 'medium' | 'high' | 'extreme';
}

const CHAOS_TESTS: ChaosTest[] = [
  {
    name: 'reorg',
    description: 'Simulates 5-block deep chain reorganization',
    file: 'scripts/chaos/reorg-exploder.ts',
    category: 'consensus',
    danger: 'high',
  },
  {
    name: 'toxic-rpc',
    description: 'Injects delays, errors, and corruption into RPC calls',
    file: 'scripts/chaos/toxic-rpc-proxy.ts',
    category: 'network',
    danger: 'medium',
  },
  {
    name: 'bigint',
    description: 'Tests numeric boundaries (max uint256, 1 wei, 1000 dust transfers)',
    file: 'scripts/chaos/bigint-nuke.ts',
    category: 'data',
    danger: 'low',
  },
  {
    name: 'db-killer',
    description: 'Kills database mid-sync and tests recovery',
    file: 'scripts/chaos/db-killer.ts',
    category: 'infrastructure',
    danger: 'extreme',
  },
];

function printHeader(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

function printTestList() {
  printHeader('🐵 CHAOS MONKEY TEST SUITE');

  console.log('Available tests:\n');

  const categories = ['consensus', 'network', 'data', 'infrastructure'] as const;

  categories.forEach(category => {
    const tests = CHAOS_TESTS.filter(t => t.category === category);
    if (tests.length === 0) return;

    console.log(`[${category.toUpperCase()}]`);
    tests.forEach(test => {
      const dangerEmoji = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        extreme: '🔴',
      }[test.danger];

      console.log(`  ${dangerEmoji} ${test.name.padEnd(12)} - ${test.description}`);
    });
    console.log('');
  });

  console.log('Usage:');
  console.log('  npx ts-node scripts/chaos/run-chaos-tests.ts              # Run all');
  console.log('  npx ts-node scripts/chaos/run-chaos-tests.ts <test-name>   # Run specific');
  console.log('');
}

function runTest(test: ChaosTest) {
  printHeader(`🐵 RUNNING: ${test.name.toUpperCase()}`);

  console.log(`Description: ${test.description}`);
  console.log(`Category: ${test.category}`);
  console.log(`Danger Level: ${test.danger}`);
  console.log(`File: ${test.file}`);
  console.log('');

  const dangerWarning = {
    low: '',
    medium: '⚠️  This test may cause temporary indexer delays',
    high: '⚠️  This test will cause chain reorganization and data rollback',
    extreme: '🔴 EXTREME DANGER: This will kill your database!',
  }[test.danger];

  if (dangerWarning) {
    console.log(`${dangerWarning}\n`);
  }

  console.log('Press Ctrl+C to abort...\n');
  console.log('─'.repeat(60) + '\n');

  try {
    execSync(`npx ts-node ${test.file}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    console.log('\n' + '─'.repeat(60));
    console.log(`\n✅ Test "${test.name}" completed successfully!\n`);

    return true;
  } catch (error: any) {
    console.log('\n' + '─'.repeat(60));
    console.error(`\n❌ Test "${test.name}" failed!\n`);
    console.error(error.message);
    return false;
  }
}

function runAllTests() {
  printHeader('🐵 CHAOS MONKEY: ALL TESTS');

  console.log('⚠️  WARNING: This will run ALL chaos tests in sequence!');
  console.log('   Your indexer will be subjected to extreme conditions.');
  console.log('\nEstimated duration: ~5 minutes\n');

  console.log('Press Ctrl+C to abort...');
  console.log('Starting in 3 seconds...\n');

  setTimeout(() => {
    const results: { test: string; success: boolean }[] = [];

    CHAOS_TESTS.forEach((test, index) => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Test ${index + 1}/${CHAOS_TESTS.length}: ${test.name}`);
      console.log('='.repeat(60) + '\n');

      const success = runTest(test);
      results.push({ test: test.name, success });

      console.log('\n⏳ Waiting 5 seconds before next test...\n');
      // Wait 5 seconds between tests
      const start = Date.now();
      while (Date.now() - start < 5000) {
        // Busy wait to allow Ctrl+C
      }
    });

    // Print summary
    printHeader('📊 FINAL RESULTS');

    results.forEach(result => {
      const emoji = result.success ? '✅' : '❌';
      console.log(`${emoji} ${result.test.padEnd(20)} ${result.success ? 'PASSED' : 'FAILED'}`);
    });

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    console.log(`\n${passed}/${total} tests passed (${((passed / total) * 100).toFixed(0)}%)`);

    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Your indexer is PRODUCTION-READY! 🚀');
    } else {
      console.log('\n⚠️  Some tests failed. Review the logs above.');
    }

    console.log('');
  }, 3000);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === '--list' || command === '-l') {
    printTestList();
    process.exit(0);
  }

  if (!command || command === 'all') {
    runAllTests();
    return;
  }

  // Find test by name
  const test = CHAOS_TESTS.find(t => t.name === command);

  if (!test) {
    console.error(`\n❌ Unknown test: "${command}"`);
    console.error('\nRun with --list to see available tests\n');
    process.exit(1);
  }

  runTest(test);
}

main();
