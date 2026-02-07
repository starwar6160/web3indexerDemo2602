/**
 * CHAOS MONKEY TEST #2: Toxic RPC Proxy ☠️
 *
 * Scenario: Simulates unreliable RPC connections (Infura/Alchemy outages)
 *
 * What it tests:
 * - Indexer's retry logic and exponential backoff
 * - Graceful degradation during network issues
 * - Recovery after transient failures
 *
 * Chaos injection:
 * - 30% random delay (0-10 seconds)
 * - 20% random 429/500 errors
 * - Intermittent connection drops
 * - Corrupted JSON responses
 *
 * Expected behavior:
 * - Indexer should NOT crash
 * - Requests should be retried with backoff
 * - System should recover when proxy is disabled
 */

import http from 'http';
import { createPublicClient, http as viemHttp } from 'viem';
import { foundry as anvil } from 'viem/chains';

const PROXY_PORT = 8546;
const TARGET_RPC = process.env.RPC_URL || 'http://localhost:58545';

// Chaos configuration
const CHAOS_CONFIG = {
  delayProbability: 0.3,      // 30% of requests get delayed
  delayRange: [0, 10000],      // 0-10 seconds delay
  errorProbability: 0.2,       // 20% of requests get errors
  dropProbability: 0.1,        // 10% of connections get dropped
  corruptProbability: 0.05,    // 5% of responses get corrupted
};

let chaosEnabled = true;
let requestCount = 0;
let chaosStats = {
  delayed: 0,
  errored: 0,
  dropped: 0,
  corrupted: 0,
  passed: 0,
};

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldTrigger(probability: number) {
  return Math.random() < probability;
}

function createCorruptedJson(originalData: any): string {
  // Randomly corrupt the JSON by:
  // 1. Truncating it
  // 2. Adding invalid characters
  // 3. Breaking the structure
  const corruptionType = getRandomInt(1, 3);

  const jsonStr = JSON.stringify(originalData);

  switch (corruptionType) {
    case 1:
      // Truncate
      return jsonStr.slice(0, Math.floor(jsonStr.length * 0.5));
    case 2:
      // Insert invalid characters
      return jsonStr.slice(0, Math.floor(jsonStr.length / 2)) +
             '<<<CORRUPTED>>>' +
             jsonStr.slice(Math.floor(jsonStr.length / 2));
    case 3:
      // Break JSON syntax
      return jsonStr.replace(/}/g, '').replace(/\]/g, '');
    default:
      return jsonStr;
  }
}

const proxyServer = http.createServer((req, res) => {
  requestCount++;

  // Check if chaos is enabled
  if (!chaosEnabled) {
    // Pass through directly when chaos disabled
    proxyRequest(req, res);
    return;
  }

  console.log(`[${requestCount}] ${req.method} ${req.url}`);

  // Chaos: Drop connection
  if (shouldTrigger(CHAOS_CONFIG.dropProbability)) {
    console.log(`  💥 Connection dropped`);
    chaosStats.dropped++;
    req.socket.destroy();
    return;
  }

  // Chaos: Return error
  if (shouldTrigger(CHAOS_CONFIG.errorProbability)) {
    const errorCode = getRandomInt(1, 3) === 1 ? 429 : 500;
    console.log(`  ⚠️  Returning ${errorCode} error`);
    chaosStats.errored++;
    res.writeHead(errorCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: errorCode,
        message: errorCode === 429 ? 'Too Many Requests' : 'Internal Server Error',
      },
      id: null,
    }));
    return;
  }

  // Chaos: Delay response
  if (shouldTrigger(CHAOS_CONFIG.delayProbability)) {
    const delay = getRandomInt(CHAOS_CONFIG.delayRange[0], CHAOS_CONFIG.delayRange[1]);
    console.log(`  ⏳ Delaying response by ${delay}ms`);
    chaosStats.delayed++;

    setTimeout(() => {
      proxyRequestWithCorruption(req, res);
    }, delay);
    return;
  }

  // Normal pass-through (with potential corruption)
  proxyRequestWithCorruption(req, res);
});

function proxyRequestWithCorruption(req: http.IncomingMessage, res: http.ServerResponse) {
  const options = {
    hostname: 'localhost',
    port: 58545,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = '';

    proxyRes.on('data', (chunk) => {
      data += chunk;
    });

    proxyRes.on('end', () => {
      // Chaos: Corrupt JSON
      if (shouldTrigger(CHAOS_CONFIG.corruptProbability)) {
        console.log(`  🔨 Corrupting JSON response`);
        chaosStats.corrupted++;

        try {
          const jsonData = JSON.parse(data);
          const corrupted = createCorruptedJson(jsonData);
          res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json' });
          res.end(corrupted);
        } catch (e) {
          // If parsing fails, just return truncated data
          res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json' });
          res.end(data.slice(0, Math.floor(data.length * 0.5)));
        }
      } else {
        // Normal pass-through
        chaosStats.passed++;
        res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json' });
        res.end(data);
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`  ❌ Proxy request error:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway' }));
  });

  req.pipe(proxyReq);
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const options = {
    hostname: 'localhost',
    port: 58545,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`  ❌ Proxy request error:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway' }));
  });

  req.pipe(proxyReq);
}

async function main() {
  console.log('\n☠️  CHAOS MONKEY: Toxic RPC Proxy Test\n');
  console.log('======================================\n');

  proxyServer.listen(PROXY_PORT, () => {
    console.log(`🚀 Toxic RPC Proxy started on port ${PROXY_PORT}`);
    console.log(`   Forwarding to: ${TARGET_RPC}`);
    console.log(`\n⚙️  Chaos Configuration:`);
    console.log(`   • Delay probability: ${CHAOS_CONFIG.delayProbability * 100}%`);
    console.log(`   • Error probability: ${CHAOS_CONFIG.errorProbability * 100}%`);
    console.log(`   • Drop probability: ${CHAOS_CONFIG.dropProbability * 100}%`);
    console.log(`   • Corrupt probability: ${CHAOS_CONFIG.corruptProbability * 100}%`);

    console.log(`\n📝 Test Instructions:`);
    console.log(`   1. Update your indexer's RPC_URL to use http://localhost:${PROXY_PORT}`);
    console.log(`   2. Start your indexer`);
    console.log(`   3. Watch the chaos unfold!`);
    console.log(`   4. Press 's' to stop chaos, 'q' to quit, 'i' for stats\n`);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      const input = key.toString().trim().toLowerCase();
      if (input === 'q') {
        console.log('\n🛑 Shutting down proxy...');
        proxyServer.close();
        process.exit(0);
      } else if (input === 's') {
        chaosEnabled = !chaosEnabled;
        console.log(`\n${chaosEnabled ? '☠️  Chaos ENABLED' : '✅ Chaos DISABLED'}\n`);
      } else if (input === 'i') {
        console.log('\n📊 Chaos Statistics:');
        console.log(`   Total requests: ${requestCount}`);
        console.log(`   Delayed: ${chaosStats.delayed} (${((chaosStats.delayed / requestCount) * 100).toFixed(1)}%)`);
        console.log(`   Errored: ${chaosStats.errored} (${((chaosStats.errored / requestCount) * 100).toFixed(1)}%)`);
        console.log(`   Dropped: ${chaosStats.dropped} (${((chaosStats.dropped / requestCount) * 100).toFixed(1)}%)`);
        console.log(`   Corrupted: ${chaosStats.corrupted} (${((chaosStats.corrupted / requestCount) * 100).toFixed(1)}%)`);
        console.log(`   Passed: ${chaosStats.passed} (${((chaosStats.passed / requestCount) * 100).toFixed(1)}%)`);
        console.log('');
      }
    });

    // Print stats every 10 seconds
    setInterval(() => {
      if (requestCount > 0) {
        console.log(`\n📊 Live Stats (Total: ${requestCount}):`);
        console.log(`   ⏳ Delayed: ${chaosStats.delayed} | ⚠️  Errored: ${chaosStats.errored} | 💥 Dropped: ${chaosStats.dropped} | 🔨 Corrupted: ${chaosStats.corrupted} | ✅ Passed: ${chaosStats.passed}`);
      }
    }, 10000);
  });
}

main();
