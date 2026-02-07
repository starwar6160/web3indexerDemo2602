"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiServer = createApiServer;
exports.startApiServer = startApiServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const viem_1 = require("viem");
const zod_1 = require("zod");
const kysely_1 = require("kysely");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const database_config_1 = require("../database/database-config");
const block_repository_1 = require("../database/block-repository");
const transfers_repository_1 = require("../database/transfers-repository");
const sync_status_repository_1 = require("../database/sync-status-repository");
const database_config_2 = require("../database/database-config");
const logger_1 = __importDefault(require("../utils/logger"));
const metrics_collector_1 = require("../utils/metrics-collector");
const swagger_1 = require("./swagger");
/**
 * BigInt-safe JSON serializer
 * CRITICAL: Prevents 2^53 precision loss by converting BigInt to string
 */
function safeJSONStringify(obj) {
    return JSON.stringify(obj, (_, value) => {
        if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
        }
        return value;
    });
}
/**
 * Express JSON middleware with BigInt handling
 */
function bigIntSafeJsonMiddleware() {
    return (req, res, next) => {
        // Override res.json to use safe serialization
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            res.setHeader('Content-Type', 'application/json');
            return res.send(safeJSONStringify(body));
        };
        next();
    };
}
/**
 * Validate numeric string (digits only)
 * Prevents BigInt conversion errors and injection attacks
 */
function isValidNumberString(str) {
    return typeof str === 'string' && /^\d+$/.test(str);
}
/**
 * Validate and parse limit parameter
 */
function parseLimitParam(value) {
    if (value === undefined || value === '')
        return 20;
    if (!isValidNumberString(value)) {
        throw new Error('Invalid limit parameter: must be positive integer');
    }
    const num = parseInt(value, 10);
    if (!Number.isFinite(num) || num < 1) {
        throw new Error('Invalid limit parameter: must be positive integer');
    }
    return Math.min(num, 100);
}
/**
 * Validate and parse offset parameter
 */
function parseOffsetParam(value) {
    if (value === undefined || value === '')
        return 0;
    if (!isValidNumberString(value)) {
        throw new Error('Invalid offset parameter: must be non-negative integer');
    }
    const num = parseInt(value, 10);
    if (!Number.isFinite(num) || num < 0) {
        throw new Error('Invalid offset parameter: must be non-negative integer');
    }
    return num;
}
/**
 * Zod Schemas for Input Validation (Fail-Fast)
 */
const PaginationSchema = zod_1.z.object({
    page: zod_1.z.string().regex(/^\d+$/).transform(Number).pipe(zod_1.z.number().min(1)).default('1'),
    limit: zod_1.z.string().regex(/^\d+$/).transform(Number).pipe(zod_1.z.number().min(1).max(100)).default('20'),
});
const BlockLookupSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^(0x[a-fA-F0-9]{64}|\d+)$/, 'Must be hex hash or block number'),
});
const DEFAULT_CONFIG = {
    port: 3001,
    rpcUrl: process.env.RPC_URL || 'http://localhost:58545',
    enableCors: true,
    rateLimitWindowMs: 60000, // 1 minute
    rateLimitMaxRequests: 100,
};
/**
 * Create and configure Express API server
 */
function createApiServer(config = {}) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const app = (0, express_1.default)();
    // Middleware
    if (finalConfig.enableCors) {
        app.use((0, cors_1.default)());
    }
    app.use(bigIntSafeJsonMiddleware());
    app.use(express_1.default.json());
    // Rate limiting
    const limiter = (0, express_rate_limit_1.default)({
        windowMs: finalConfig.rateLimitWindowMs,
        max: finalConfig.rateLimitMaxRequests,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/', limiter);
    // Repositories
    const blockRepo = new block_repository_1.BlockRepository();
    const transfersRepo = new transfers_repository_1.TransfersRepository();
    const syncStatusRepo = new sync_status_repository_1.SyncStatusRepository();
    // RPC client for chain head
    const rpcClient = (0, viem_1.createPublicClient)({
        transport: (0, viem_1.http)(finalConfig.rpcUrl),
    });
    // Swagger API Documentation
    app.use('/docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec, {
        customSiteTitle: 'Web3 Indexer API Documentation',
        customCss: '.swagger-ui .topbar { display: none }',
        swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            docExpansion: 'none',
            filter: true,
            showRequestHeaders: true,
        },
    }));
    /**
     * GET /docs
     * Redirect to API documentation
     */
    app.get('/docs', (req, res) => {
        res.redirect('/docs/');
    });
    /**
     * GET /api/status
     * Returns detailed sync status with percentage and metrics
     */
    app.get('/api/status', async (req, res) => {
        try {
            const [localMaxBlock, chainHead, dbHealth, latestBlock] = await Promise.all([
                blockRepo.getMaxBlockNumber(),
                rpcClient.getBlockNumber().catch(() => null),
                checkDbHealth(),
                blockRepo.db
                    .selectFrom('blocks')
                    .select('created_at')
                    .orderBy('number', 'desc')
                    .limit(1)
                    .executeTakeFirst(),
            ]);
            const lag = chainHead && localMaxBlock !== null
                ? Number(chainHead - localMaxBlock)
                : null;
            const syncPercentage = chainHead && localMaxBlock !== null && chainHead > 0n
                ? ((Number(localMaxBlock) / Number(chainHead)) * 100).toFixed(2)
                : '0.00';
            const status = {
                status: dbHealth ? (lag !== null && lag <= 5 ? 'synchronized' : 'syncing') : 'error',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                sync: {
                    latestNetworkBlock: chainHead?.toString() ?? null,
                    latestIndexedBlock: localMaxBlock?.toString() ?? null,
                    lastSyncedAt: latestBlock?.created_at ?? null,
                    lag: lag?.toString() ?? null,
                    syncPercentage: syncPercentage?.toString() ?? '0',
                    synced: lag !== null && lag <= 5,
                },
                metrics: {
                    reorgsDetected: metrics_collector_1.metrics.getMetrics().reorgs.detected,
                    rpcErrorRate: metrics_collector_1.metrics.getMetrics().rpc.errorRate,
                    dbWrites: metrics_collector_1.metrics.getMetrics().database.writes,
                },
                database: {
                    connected: dbHealth,
                },
                rpc: {
                    connected: chainHead !== null,
                    url: finalConfig.rpcUrl,
                },
            };
            res.json(status);
        }
        catch (error) {
            logger_1.default.error({ error }, 'API /api/status failed');
            res.status(503).json({
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            });
        }
    });
    /**
     * GET /api/blocks?page=1&limit=20
     * Returns paginated blocks with metadata
     */
    app.get('/api/blocks', async (req, res) => {
        try {
            // Zod validation (fail-fast)
            const parsed = PaginationSchema.safeParse(req.query);
            if (!parsed.success) {
                res.status(400).json({
                    error: 'Invalid pagination parameters',
                    details: parsed.error.issues.map(i => i.message),
                });
                return;
            }
            const { page, limit } = parsed.data;
            const offset = (page - 1) * limit;
            // Get total count for pagination metadata
            const totalCount = await blockRepo.db
                .selectFrom('blocks')
                .select((0, kysely_1.sql) `count(*)`.as('count'))
                .executeTakeFirstOrThrow();
            const blocks = await blockRepo.db
                .selectFrom('blocks')
                .selectAll()
                .orderBy('number', 'desc')
                .limit(limit)
                .offset(offset)
                .execute();
            const formatted = blocks.map((b) => ({
                number: b.number.toString(),
                hash: b.hash,
                parent_hash: b.parent_hash,
                timestamp: b.timestamp.toString(),
                chain_id: b.chain_id.toString(),
                created_at: b.created_at,
            }));
            const totalPages = Math.ceil((totalCount?.count || 0) / limit);
            res.json({
                data: formatted,
                meta: {
                    total: Number(totalCount?.count || 0),
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Number(totalPages),
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                },
            });
        }
        catch (error) {
            logger_1.default.error({ error }, 'API /api/blocks failed');
            res.status(500).json({
                error: 'Failed to fetch blocks',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    /**
     * GET /api/transfers?limit=20&contract=0x...
     * Returns recent ERC20 transfers
     */
    app.get('/api/transfers', async (req, res) => {
        try {
            const parsed = PaginationSchema.safeParse(req.query);
            if (!parsed.success) {
                res.status(400).json({
                    error: 'Invalid pagination parameters',
                    details: parsed.error.issues.map(i => i.message),
                });
                return;
            }
            const { limit } = parsed.data;
            const contractAddress = req.query.contract;
            let transfers;
            if (contractAddress) {
                transfers = await transfersRepo.getByContract(contractAddress, limit);
            }
            else {
                // Use getDb directly instead of accessing private property
                transfers = await (0, database_config_2.getDb)()
                    .selectFrom('transfers')
                    .selectAll()
                    .orderBy('block_number', 'desc')
                    .limit(limit)
                    .execute();
            }
            const formatted = transfers.map((t) => ({
                id: t.id,
                block_number: t.block_number.toString(),
                transaction_hash: t.transaction_hash,
                log_index: t.log_index,
                from_address: t.from_address,
                to_address: t.to_address,
                amount: t.amount,
                token_address: 'token_address' in t ? t.token_address : t.contract_address,
                created_at: t.created_at,
            }));
            res.json({
                data: formatted,
                meta: {
                    count: formatted.length,
                    tokenFilter: contractAddress || null,
                },
            });
        }
        catch (error) {
            logger_1.default.error({ error }, 'API /api/transfers failed');
            res.status(500).json({
                error: 'Failed to fetch transfers',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    /**
     * GET /api/blocks/:id
     * Supports both hex hash (0x...) and block number
     */
    app.get('/api/blocks/:id', async (req, res) => {
        try {
            const parsed = BlockLookupSchema.safeParse({ id: req.params.id });
            if (!parsed.success) {
                res.status(400).json({ error: 'Invalid block identifier: must be hex hash or block number' });
                return;
            }
            const { id } = parsed.data;
            let blockNumber = null;
            // Determine if it's a hash or number
            if (id.startsWith('0x')) {
                // Look up by hash
                const block = await blockRepo.db
                    .selectFrom('blocks')
                    .selectAll()
                    .where('hash', '=', id)
                    .executeTakeFirst();
                if (block) {
                    blockNumber = block.number;
                }
            }
            else {
                // Direct block number
                blockNumber = BigInt(id);
            }
            if (blockNumber === null) {
                res.status(404).json({ error: 'Block not found' });
                return;
            }
            const [block, transfers] = await Promise.all([
                blockRepo.findById(blockNumber),
                transfersRepo.getByBlockNumber(blockNumber),
            ]);
            if (!block) {
                res.status(404).json({ error: 'Block not found' });
                return;
            }
            res.json({
                data: {
                    number: block.number.toString(),
                    hash: block.hash,
                    parent_hash: block.parent_hash,
                    timestamp: block.timestamp.toString(),
                    chain_id: block.chain_id.toString(),
                    created_at: block.created_at,
                    transfers: transfers.map((t) => ({
                        id: t.id,
                        transaction_hash: t.transaction_hash,
                        log_index: t.log_index,
                        from_address: t.from_address,
                        to_address: t.to_address,
                        amount: t.amount,
                        token_address: t.token_address,
                    })),
                    transferCount: transfers.length,
                },
            });
        }
        catch (error) {
            logger_1.default.error({ error }, 'API /api/blocks/:id failed');
            res.status(500).json({
                error: 'Failed to fetch block',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    /**
     * Health check endpoint
     */
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    /**
     * GET /
     * Redirect to dashboard
     */
    app.get('/', (req, res) => {
        res.redirect('/dashboard');
    });
    /**
     * GET /metrics
     * Prometheus-style metrics endpoint for observability
     */
    app.get('/metrics', (req, res) => {
        try {
            const prometheusMetrics = metrics_collector_1.metrics.getPrometheusMetrics();
            res.setHeader('Content-Type', 'text/plain; version=0.0.4');
            res.send(prometheusMetrics);
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to generate metrics');
            res.status(500).json({ error: 'Failed to generate metrics' });
        }
    });
    /**
     * GET /dashboard
     * Production Monitor Dashboard
     */
    app.get('/dashboard', (req, res) => {
        try {
            const dashboardPath = path_1.default.join(__dirname, '../../frontend/dashboard.html');
            const html = (0, fs_1.readFileSync)(dashboardPath, 'utf-8');
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to load dashboard');
            res.status(500).json({ error: 'Failed to load dashboard' });
        }
    });
    /**
     * Error handling middleware
     */
    app.use((err, req, res, _next) => {
        logger_1.default.error({ error: err, path: req.path }, 'API unhandled error');
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        });
    });
    return { app, config: finalConfig };
}
/**
 * Check database health
 */
async function checkDbHealth() {
    try {
        const db = (0, database_config_2.getDb)();
        await db.selectFrom('blocks').select('number').limit(1).execute();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Start API server
 */
async function startApiServer(config = {}) {
    const { app, config: finalConfig } = createApiServer(config);
    return new Promise((resolve, reject) => {
        const server = app.listen(finalConfig.port, () => {
            logger_1.default.info({
                port: finalConfig.port,
                endpoints: [
                    '/api/status',
                    '/api/blocks',
                    '/api/blocks/:number',
                    '/api/transfers',
                    '/health',
                ],
            }, '🚀 API server started');
            resolve();
        });
        server.on('error', (err) => {
            logger_1.default.error({ error: err }, 'API server failed to start');
            reject(err);
        });
    });
}
// Direct execution
if (require.main === module) {
    const port = parseInt(process.env.API_PORT || '3001', 10);
    const rpcUrl = process.env.RPC_URL || 'http://localhost:58545';
    // Initialize database first
    (0, database_config_1.createDbConnection)()
        .then(() => {
        return startApiServer({ port, rpcUrl });
    })
        .catch((err) => {
        console.error('Failed to start API:', err);
        process.exit(1);
    });
}
