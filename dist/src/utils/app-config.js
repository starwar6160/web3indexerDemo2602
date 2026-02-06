"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appConfig = void 0;
exports.loadConfigWithFallback = loadConfigWithFallback;
exports.validateRpcWithFallback = validateRpcWithFallback;
const zod_1 = require("zod");
const viem_1 = require("viem");
const logger_1 = __importDefault(require("./logger"));
/**
 * 应用配置 Schema - 支持 fallback 机制
 */
const AppConfigSchema = zod_1.z.object({
    // 数据库配置
    database: zod_1.z.object({
        url: zod_1.z.string().url(),
        poolMax: zod_1.z.number().int().positive().default(20),
        poolTimeout: zod_1.z.number().int().positive().default(30000),
        statementTimeout: zod_1.z.number().int().positive().default(10000), // 防止死锁
    }),
    // RPC 配置（支持多节点 fallback）
    rpc: zod_1.z.object({
        primaryUrl: zod_1.z.string().url(),
        fallbackUrls: zod_1.z.array(zod_1.z.string().url()).default([]),
        timeout: zod_1.z.number().int().positive().default(10000),
        maxRetries: zod_1.z.number().int().positive().default(3),
    }),
    // 索引器配置
    indexer: zod_1.z.object({
        pollIntervalMs: zod_1.z.number().int().positive().max(60000).default(2000),
        batchSize: zod_1.z.number().int().positive().max(100).default(10),
        startBlock: zod_1.z.bigint().default(0n),
    }),
    // 限流配置
    rateLimit: zod_1.z.object({
        tokensPerInterval: zod_1.z.number().int().positive().default(10),
        intervalMs: zod_1.z.number().int().positive().default(1000),
        maxBurstTokens: zod_1.z.number().int().positive().default(20),
    }),
    // 日志配置
    logging: zod_1.z.object({
        level: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
        samplingRate: zod_1.z.number().min(0).max(1).default(1.0), // 日志采样率
    }),
    // 健康检查配置
    healthCheck: zod_1.z.object({
        port: zod_1.z.number().int().positive().max(65535).default(3000),
        readinessPath: zod_1.z.string().default('/ready'),
        livenessPath: zod_1.z.string().default('/healthz'),
        metricsPath: zod_1.z.string().default('/metrics'),
    }),
    // 监控配置
    monitoring: zod_1.z.object({
        enabled: zod_1.z.boolean().default(true),
        reportIntervalMs: zod_1.z.number().int().positive().default(60000), // 每分钟报告一次
        alertThresholds: zod_1.z.object({
            rpcErrorRate: zod_1.z.number().min(0).max(1).default(0.05), // 5% 错误率阈值
            syncLagBlocks: zod_1.z.number().int().positive().default(100), // 100 区块延迟
            dbLatencyMs: zod_1.z.number().int().positive().default(1000), // 1秒 DB 延迟
        }),
    }),
});
/**
 * 从环境变量加载配置，支持智能 fallback
 */
function loadConfigWithFallback() {
    // 辅助函数：解析环境变量或使用默认值
    const env = (key, defaultValue = '') => {
        return process.env[key]?.trim() || defaultValue;
    };
    const envInt = (key, defaultValue) => {
        const value = process.env[key];
        return value ? parseInt(value, 10) : defaultValue;
    };
    const envBool = (key, defaultValue) => {
        const value = process.env[key]?.toLowerCase();
        if (value === 'true' || value === '1')
            return true;
        if (value === 'false' || value === '0')
            return false;
        return defaultValue;
    };
    // 配置对象
    const rawConfig = {
        database: {
            url: env('DATABASE_URL', 'postgresql://postgres:password@localhost:15432/web3_indexer'),
            poolMax: envInt('DB_POOL_MAX', 20),
            poolTimeout: envInt('DB_POOL_TIMEOUT', 30000),
            statementTimeout: envInt('DB_STATEMENT_TIMEOUT', 10000),
        },
        rpc: {
            primaryUrl: env('RPC_URL', 'http://localhost:58545'),
            fallbackUrls: env('RPC_FALLBACK_URLS', '')
                .split(',')
                .filter(url => url.length > 0),
            timeout: envInt('RPC_TIMEOUT', 10000),
            maxRetries: envInt('RPC_MAX_RETRIES', 3),
        },
        indexer: {
            pollIntervalMs: envInt('POLL_INTERVAL_MS', 2000),
            batchSize: envInt('DB_SYNC_BATCH_SIZE', 10),
            startBlock: BigInt(envInt('START_BLOCK', 0)),
        },
        rateLimit: {
            tokensPerInterval: envInt('RATE_LIMIT_TOKENS', 10),
            intervalMs: envInt('RATE_LIMIT_INTERVAL', 1000),
            maxBurstTokens: envInt('RATE_LIMIT_BURST', 20),
        },
        logging: {
            level: env('LOG_LEVEL', 'info'),
            samplingRate: parseFloat(env('LOG_SAMPLING_RATE', '1.0')),
        },
        healthCheck: {
            port: envInt('HEALTH_CHECK_PORT', 3000),
            readinessPath: env('HEALTH_READINESS_PATH', '/ready'),
            livenessPath: env('HEALTH_LIVENESS_PATH', '/healthz'),
            metricsPath: env('HEALTH_METRICS_PATH', '/metrics'),
        },
        monitoring: {
            enabled: envBool('MONITORING_ENABLED', true),
            reportIntervalMs: envInt('MONITORING_REPORT_INTERVAL', 60000),
            alertThresholds: {
                rpcErrorRate: parseFloat(env('ALERT_RPC_ERROR_RATE', '0.05')),
                syncLagBlocks: envInt('ALERT_SYNC_LAG_BLOCKS', 100),
                dbLatencyMs: envInt('ALERT_DB_LATENCY_MS', 1000),
            },
        },
    };
    // 验证配置
    try {
        const config = AppConfigSchema.parse(rawConfig);
        logger_1.default.info({
            databaseUrl: '***REDACTED***',
            rpcUrls: [config.rpc.primaryUrl, ...config.rpc.fallbackUrls].map(url => url.replace(/\/\/[^@]+@/, '//***@/')),
            indexer: config.indexer,
        }, '✅ Application config loaded with fallbacks');
        return config;
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            logger_1.default.error({
                errors: error.errors.map(e => ({
                    path: e.path.join('.'),
                    message: e.message,
                })),
            }, '❌ Configuration validation failed');
            throw new Error(`Invalid configuration: ${error.errors.map(e => e.message).join(', ')}`);
        }
        throw error;
    }
}
/**
 * 验证 RPC 连通性（带 fallback 尝试）
 */
async function validateRpcWithFallback(config) {
    const urlsToTry = [config.rpc.primaryUrl, ...config.rpc.fallbackUrls];
    for (const url of urlsToTry) {
        try {
            const startTime = Date.now();
            const client = (0, viem_1.createPublicClient)({
                transport: (0, viem_1.http)(url, { timeout: config.rpc.timeout }),
            });
            await client.getBlockNumber();
            const latency = Date.now() - startTime;
            logger_1.default.info({ rpcUrl: url.replace(/\/\/[^@]+@/, '//***@/'), latency: `${latency}ms` }, '✅ RPC connectivity validated');
            return { workingUrl: url, latency };
        }
        catch (error) {
            logger_1.default.warn({ rpcUrl: url.replace(/\/\/[^@]+@/, '//***@/'), error: error instanceof Error ? error.message : String(error) }, '⚠️  RPC endpoint not reachable, trying next fallback');
        }
    }
    throw new Error('All RPC endpoints are unreachable. Please check your network and RPC nodes.');
}
/**
 * 导出配置实例
 */
exports.appConfig = loadConfigWithFallback();
