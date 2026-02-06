import http from 'http';
import { URL } from 'url';
import logger, { generateTraceId } from './logger';
import { createDbConnection } from '../database/database-config';
import { createPublicClient, http as viemHttp } from 'viem';
import { config } from './config';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: 'pass' | 'fail'; latency?: number; error?: string };
    rpc: { status: 'pass' | 'fail'; latency?: number; error?: string; blockNumber?: string };
    sync: { status: 'up' | 'down' | 'behind'; lag?: number; localMax?: string; chainMax?: string };
  };
}

interface Metrics {
  indexer: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    blockCount: number;
    localMax: string | null;
    chainMax: string;
    syncLag: number;
    syncStatus: 'up_to_date' | 'behind' | 'critical';
  };
  rpc: {
    latency: number;
    errorRate: number;
    totalRequests: number;
    failedRequests: number;
  };
  system: {
    platform: string;
    nodeVersion: string;
    arch: string;
    cpus: number;
  };
  config: {
    pollInterval: number;
    batchSize: string;
  };
}

// Global metrics tracking
let rpcMetrics = {
  totalRequests: 0,
  failedRequests: 0,
  totalLatency: 0,
};

export function recordRpcCall(success: boolean, latency: number): void {
  rpcMetrics.totalRequests++;
  if (!success) {
    rpcMetrics.failedRequests++;
  }
  rpcMetrics.totalLatency += latency;
}

/**
 * 创建健康检查服务器
 */
export function createHealthServer() {
  const client = createPublicClient({
    transport: viemHttp(config.RPC_URL),
  });

  const server = http.createServer(async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const { pathname } = new URL(req.url || '', `http://${req.headers.host}`);

    if (pathname === '/healthz') {
      try {
        const health = await getHealthStatus(client);
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.writeHead(statusCode);
        res.end(JSON.stringify(health, null, 2));
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.writeHead(503);
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    } else if (pathname === '/metrics') {
      try {
        const metrics = await getMetrics(client);
        res.writeHead(200);
        res.end(JSON.stringify(metrics, null, 2));
      } catch (error) {
        logger.error({ error }, 'Metrics collection failed');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to collect metrics' }));
      }
    } else if (pathname === '/ready') {
      // Kubernetes readiness probe - check if database is ready
      try {
        await checkReadiness();
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ready' }));
      } catch (error) {
        res.writeHead(503);
        res.end(JSON.stringify({
          status: 'not ready',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return server;
}

/**
 * 获取健康状态
 */
async function getHealthStatus(rpcClient: ReturnType<typeof createPublicClient>): Promise<HealthStatus> {
  const startTime = Date.now();
  const checks: HealthStatus['checks'] = {
    database: { status: 'pass' },
    rpc: { status: 'pass' },
    sync: { status: 'up' },
  };

  let isHealthy = true;

  // 检查数据库连接
  try {
    const dbStart = Date.now();
    const { BlockRepository } = await import('../database/block-repository');
    const repo = new BlockRepository();
    await repo.getBlockCount(); // 简单的查询测试
    checks.database = {
      status: 'pass',
      latency: Date.now() - dbStart,
    };
  } catch (error) {
    isHealthy = false;
    checks.database = {
      status: 'fail',
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }

  // 检查 RPC 连接
  try {
    const rpcStart = Date.now();
    const blockNumber = await rpcClient.getBlockNumber();
    checks.rpc = {
      status: 'pass',
      latency: Date.now() - rpcStart,
      blockNumber: blockNumber.toString(),
    };
  } catch (error) {
    isHealthy = false;
    checks.rpc = {
      status: 'fail',
      error: error instanceof Error ? error.message : 'Unknown RPC error',
    };
  }

  // 检查同步状态
  try {
    const { BlockRepository } = await import('../database/block-repository');
    const repo = new BlockRepository();
    const localMax = await repo.getMaxBlockNumber();
    const chainMax = await rpcClient.getBlockNumber();

    if (localMax === null) {
      checks.sync = { status: 'down' };
      isHealthy = false;
    } else {
      const lag = Number(chainMax - localMax);
      checks.sync = {
        status: lag <= 10 ? 'up' : lag <= 100 ? 'behind' : 'down',
        lag,
        localMax: localMax.toString(),
        chainMax: chainMax.toString(),
      };

      // 如果落后太多，标记为不健康
      if (lag > 100) {
        isHealthy = false;
      }
    }
  } catch (error) {
    logger.error({ error }, 'Sync status check failed');
  }

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  };
}

/**
 * Check readiness - database connection only
 */
async function checkReadiness(): Promise<void> {
  const { BlockRepository } = await import('../database/block-repository');
  const repo = new BlockRepository();

  // Simple query to verify database is ready
  await repo.getBlockCount();
}

/**
 * 获取详细指标
 */
async function getMetrics(rpcClient: ReturnType<typeof createPublicClient>): Promise<Metrics> {
  const { BlockRepository } = await import('../database/block-repository');
  const repo = new BlockRepository();

  const [blockCount, localMax, chainMax] = await Promise.all([
    repo.getBlockCount(),
    repo.getMaxBlockNumber(),
    rpcClient.getBlockNumber(),
  ]);

  const lag = localMax !== null ? Number(chainMax - localMax) : 0;

  // Calculate RPC metrics
  const avgLatency = rpcMetrics.totalRequests > 0
    ? rpcMetrics.totalLatency / rpcMetrics.totalRequests
    : 0;
  const errorRate = rpcMetrics.totalRequests > 0
    ? (rpcMetrics.failedRequests / rpcMetrics.totalRequests) * 100
    : 0;

  return {
    indexer: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      blockCount,
      localMax: localMax?.toString() ?? null,
      chainMax: chainMax.toString(),
      syncLag: lag,
      syncStatus: lag <= 10 ? 'up_to_date' : lag <= 100 ? 'behind' : 'critical',
    },
    rpc: {
      latency: Math.round(avgLatency),
      errorRate: Math.round(errorRate * 100) / 100,
      totalRequests: rpcMetrics.totalRequests,
      failedRequests: rpcMetrics.failedRequests,
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      arch: process.arch,
      cpus: require('os').cpus().length,
    },
    config: {
      pollInterval: config.POLL_INTERVAL_MS,
      batchSize: process.env.DB_SYNC_BATCH_SIZE || '10',
    },
  };
}

/**
 * 启动健康检查服务器
 */
export async function startHealthServer(port: number = Number(config.HEALTH_CHECK_PORT)): Promise<http.Server> {
  const server = createHealthServer();

  return new Promise((resolve, reject) => {
    server.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ error: err, port }, 'Failed to start health server');
        reject(err);
      } else {
        logger.info({
          port,
          endpoints: {
            healthz: `http://localhost:${port}/healthz`,
            metrics: `http://localhost:${port}/metrics`,
            ready: `http://localhost:${port}/ready`,
          },
        }, '✅ Health check server started');
        resolve(server);
      }
    });
  });
}
