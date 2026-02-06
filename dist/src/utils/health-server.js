"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRpcCall = recordRpcCall;
exports.createHealthServer = createHealthServer;
exports.startHealthServer = startHealthServer;
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
const logger_1 = __importDefault(require("./logger"));
const viem_1 = require("viem");
const config_1 = require("./config");
// Global metrics tracking
let rpcMetrics = {
    totalRequests: 0,
    failedRequests: 0,
    totalLatency: 0,
};
function recordRpcCall(success, latency) {
    rpcMetrics.totalRequests++;
    if (!success) {
        rpcMetrics.failedRequests++;
    }
    rpcMetrics.totalLatency += latency;
}
/**
 * 创建健康检查服务器
 */
function createHealthServer() {
    const client = (0, viem_1.createPublicClient)({
        transport: (0, viem_1.http)(config_1.config.RPC_URL),
    });
    const server = http_1.default.createServer(async (req, res) => {
        // 设置 CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        const { pathname } = new url_1.URL(req.url || '', `http://${req.headers.host}`);
        if (pathname === '/healthz') {
            try {
                const health = await getHealthStatus(client);
                const statusCode = health.status === 'healthy' ? 200 : 503;
                res.writeHead(statusCode);
                res.end(JSON.stringify(health, null, 2));
            }
            catch (error) {
                logger_1.default.error({ error }, 'Health check failed');
                res.writeHead(503);
                res.end(JSON.stringify({
                    status: 'unhealthy',
                    error: error instanceof Error ? error.message : 'Unknown error',
                }));
            }
        }
        else if (pathname === '/metrics') {
            try {
                const metrics = await getMetrics(client);
                res.writeHead(200);
                res.end(JSON.stringify(metrics, null, 2));
            }
            catch (error) {
                logger_1.default.error({ error }, 'Metrics collection failed');
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to collect metrics' }));
            }
        }
        else if (pathname === '/ready') {
            // Kubernetes readiness probe - check if database is ready
            try {
                await checkReadiness();
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ready' }));
            }
            catch (error) {
                res.writeHead(503);
                res.end(JSON.stringify({
                    status: 'not ready',
                    error: error instanceof Error ? error.message : 'Unknown error',
                }));
            }
        }
        else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });
    return server;
}
/**
 * 获取健康状态
 */
async function getHealthStatus(rpcClient) {
    const startTime = Date.now();
    const checks = {
        database: { status: 'pass' },
        rpc: { status: 'pass' },
        sync: { status: 'up' },
    };
    let isHealthy = true;
    // 检查数据库连接
    try {
        const dbStart = Date.now();
        const { BlockRepository } = await Promise.resolve().then(() => __importStar(require('../database/block-repository')));
        const repo = new BlockRepository();
        await repo.getBlockCount(); // 简单的查询测试
        checks.database = {
            status: 'pass',
            latency: Date.now() - dbStart,
        };
    }
    catch (error) {
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
    }
    catch (error) {
        isHealthy = false;
        checks.rpc = {
            status: 'fail',
            error: error instanceof Error ? error.message : 'Unknown RPC error',
        };
    }
    // 检查同步状态
    try {
        const { BlockRepository } = await Promise.resolve().then(() => __importStar(require('../database/block-repository')));
        const repo = new BlockRepository();
        const localMax = await repo.getMaxBlockNumber();
        const chainMax = await rpcClient.getBlockNumber();
        if (localMax === null) {
            checks.sync = { status: 'down' };
            isHealthy = false;
        }
        else {
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
    }
    catch (error) {
        logger_1.default.error({ error }, 'Sync status check failed');
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
async function checkReadiness() {
    const { BlockRepository } = await Promise.resolve().then(() => __importStar(require('../database/block-repository')));
    const repo = new BlockRepository();
    // Simple query to verify database is ready
    await repo.getBlockCount();
}
/**
 * 获取详细指标
 */
async function getMetrics(rpcClient) {
    const { BlockRepository } = await Promise.resolve().then(() => __importStar(require('../database/block-repository')));
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
            pollInterval: config_1.config.POLL_INTERVAL_MS,
            batchSize: process.env.DB_SYNC_BATCH_SIZE || '10',
        },
    };
}
/**
 * 启动健康检查服务器
 */
async function startHealthServer(port = Number(config_1.config.HEALTH_CHECK_PORT)) {
    const server = createHealthServer();
    return new Promise((resolve, reject) => {
        server.listen(port, (err) => {
            if (err) {
                logger_1.default.error({ error: err, port }, 'Failed to start health server');
                reject(err);
            }
            else {
                logger_1.default.info({
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
