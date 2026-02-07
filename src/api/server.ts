import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createPublicClient, http } from 'viem';
import { z } from 'zod';
import { sql } from 'kysely';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { readFileSync } from 'fs';
import { createDbConnection } from '../database/database-config';
import { BlockRepository } from '../database/block-repository';
import { TransfersRepository } from '../database/transfers-repository';
import { SyncStatusRepository } from '../database/sync-status-repository';
import { getDb } from '../database/database-config';
import logger from '../utils/logger';
import { metrics } from '../utils/metrics-collector';
import { swaggerSpec } from './swagger';

/**
 * BigInt-safe JSON serializer
 * CRITICAL: Prevents 2^53 precision loss by converting BigInt to string
 */
function safeJSONStringify(obj: unknown): string {
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
  return (req: Request, res: Response, next: NextFunction) => {
    // Override res.json to use safe serialization
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
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
function isValidNumberString(str: unknown): str is string {
  return typeof str === 'string' && /^\d+$/.test(str);
}

/**
 * Validate and parse limit parameter
 */
function parseLimitParam(value: unknown): number {
  if (value === undefined || value === '') return 20;
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
function parseOffsetParam(value: unknown): number {
  if (value === undefined || value === '') return 0;
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
const PaginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1)).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).default('20'),
});

const BlockLookupSchema = z.object({
  id: z.string().regex(/^(0x[a-fA-F0-9]{64}|\d+)$/, 'Must be hex hash or block number'),
});

/**
 * API Server Configuration
 */
export interface ApiServerConfig {
  port: number;
  rpcUrl: string;
  enableCors: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

const DEFAULT_CONFIG: ApiServerConfig = {
  port: 3001,
  rpcUrl: process.env.RPC_URL || 'http://localhost:58545',
  enableCors: true,
  rateLimitWindowMs: 60000, // 1 minute
  rateLimitMaxRequests: 100,
};

/**
 * Create and configure Express API server
 */
export function createApiServer(config: Partial<ApiServerConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const app = express();

  // Middleware
  if (finalConfig.enableCors) {
    app.use(cors());
  }
  app.use(bigIntSafeJsonMiddleware());
  app.use(express.json());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: finalConfig.rateLimitWindowMs,
    max: finalConfig.rateLimitMaxRequests,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // Repositories
  const blockRepo = new BlockRepository();
  const transfersRepo = new TransfersRepository();
  const syncStatusRepo = new SyncStatusRepository();

  // RPC client for chain head
  const rpcClient = createPublicClient({
    transport: http(finalConfig.rpcUrl, {
      timeout: 10_000, // 10秒超时
      retryCount: 0,
    }),
  });

  // Swagger API Documentation
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
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
  app.get('/docs', (req: Request, res: Response) => {
    res.redirect('/docs/');
  });

  /**
   * GET /api/status
   * Returns detailed sync status with percentage and metrics
   */
  app.get('/api/status', async (req: Request, res: Response) => {
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

      // Defensive calculation: prevent negative lag and overflow
      const rawLag = chainHead && localMaxBlock !== null
        ? Number(chainHead - localMaxBlock)
        : null;

      // Enforce physical constraint: lag cannot be negative
      const lag = rawLag !== null ? Math.max(0, rawLag) : null;

      // Defensive calculation: cap sync percentage at 100%
      let syncPercentage = '0.00';
      if (chainHead && localMaxBlock !== null && chainHead > 0n) {
        const rawPercentage = (Number(localMaxBlock) / Number(chainHead)) * 100;
        syncPercentage = Math.min(100, Math.max(0, rawPercentage)).toFixed(2);
      }

      // Detect environment mismatch (indexed height exceeds chain head)
      const isEnvironmentMismatch = rawLag !== null && rawLag < 0;

      const status = {
        status: dbHealth
          ? (isEnvironmentMismatch
            ? 'environment_mismatch'
            : (lag !== null && lag <= 5 ? 'synchronized' : 'syncing'))
          : 'error',
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
          reorgsDetected: metrics.getMetrics().reorgs.detected,
          rpcErrorRate: metrics.getMetrics().rpc.errorRate,
          dbWrites: metrics.getMetrics().database.writes,
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
    } catch (error) {
      logger.error({ error }, 'API /api/status failed');
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
  app.get('/api/blocks', async (req: Request, res: Response) => {
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
        .select(sql<number>`count(*)`.as('count'))
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
    } catch (error) {
      logger.error({ error }, 'API /api/blocks failed');
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
  app.get('/api/transfers', async (req: Request, res: Response) => {
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
      const contractAddress = req.query.contract as string | undefined;

      let transfers;
      if (contractAddress) {
        transfers = await transfersRepo.getByContract(contractAddress, limit);
      } else {
        // Use getDb directly instead of accessing private property
        transfers = await getDb()
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
        token_address: 'token_address' in t ? t.token_address : (t as any).contract_address,
        created_at: t.created_at,
      }));

      res.json({
        data: formatted,
        meta: {
          count: formatted.length,
          tokenFilter: contractAddress || null,
        },
      });
    } catch (error) {
      logger.error({ error }, 'API /api/transfers failed');
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
  app.get('/api/blocks/:id', async (req: Request, res: Response) => {
    try {
      const parsed = BlockLookupSchema.safeParse({ id: req.params.id });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid block identifier: must be hex hash or block number' });
        return;
      }

      const { id } = parsed.data;
      let blockNumber: bigint | null = null;

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
      } else {
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
    } catch (error) {
      logger.error({ error }, 'API /api/blocks/:id failed');
      res.status(500).json({
        error: 'Failed to fetch block',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Health check endpoint
   */
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * GET /
   * Redirect to dashboard
   */
  app.get('/', (req: Request, res: Response) => {
    res.redirect('/dashboard');
  });

  /**
   * GET /metrics
   * Prometheus-style metrics endpoint for observability
   */
  app.get('/metrics', (req: Request, res: Response) => {
    try {
      const prometheusMetrics = metrics.getPrometheusMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(prometheusMetrics);
    } catch (error) {
      logger.error({ error }, 'Failed to generate metrics');
      res.status(500).json({ error: 'Failed to generate metrics' });
    }
  });

  /**
   * GET /dashboard
   * Production Monitor Dashboard
   */
  app.get('/dashboard', (req: Request, res: Response) => {
    try {
      const dashboardPath = path.join(__dirname, '../../frontend/dashboard.html');
      const html = readFileSync(dashboardPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      logger.error({ error }, 'Failed to load dashboard');
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  });

  /**
   * Error handling middleware
   */
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err, path: req.path }, 'API unhandled error');
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return { app, config: finalConfig };
}

/**
 * Detect WSL2 environment
 */
function isWSL2(): boolean {
  try {
    const os = require('os');
    return os.release().toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Get WSL2 IP address
 */
function getWSL2IP(): string {
  try {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    for (const name of Object.keys(networkInterfaces)) {
      if (name.includes('eth') || name.includes('wsl')) {
        const iface = networkInterfaces[name];
        if (iface) {
          for (const config of iface) {
            if (config.family === 'IPv4' && !config.internal) {
              return config.address;
            }
          }
        }
      }
    }
    return 'localhost';
  } catch {
    return 'localhost';
  }
}

/**
 * Check database health
 */
async function checkDbHealth(): Promise<boolean> {
  try {
    const db = getDb();
    await db.selectFrom('blocks').select('number').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start API server
 */
export async function startApiServer(config: Partial<ApiServerConfig> = {}): Promise<void> {
  const { app, config: finalConfig } = createApiServer(config);

  return new Promise((resolve, reject) => {
    const server = app.listen(finalConfig.port, () => {
      const isWSL = isWSL2();
      const dashboardURL = isWSL
        ? `http://localhost:${finalConfig.port}/dashboard`
        : `http://localhost:${finalConfig.port}/dashboard`;

      // Define flexible access info interface to allow dynamic WSL fields
      interface AccessInfo {
        port: number;
        dashboard: string;
        endpoints: string[];
        [key: string]: any; // Allow dynamic string keys
      }

      const accessInfo: AccessInfo = {
        port: finalConfig.port,
        dashboard: dashboardURL,
        endpoints: [
          '/api/status',
          '/api/blocks',
          '/api/blocks/:number',
          '/api/transfers',
          '/health',
          '/dashboard',
          '/docs',
        ],
      };

      // Add WSL-specific access instructions
      if (isWSL) {
        const wslIP = getWSL2IP();
        accessInfo['WSL Access'] = {
          'From WSL': dashboardURL,
          'From Windows': `http://localhost:${finalConfig.port}/dashboard`,
          'From Network': `http://${wslIP}:${finalConfig.port}/dashboard`,
          'Windows Port Forward (run in PowerShell as admin)': `netsh interface portproxy add v4tov4 listenport=${finalConfig.port} listenaddress=0.0.0.0 connectport=${finalConfig.port} connectaddress=${wslIP}`,
        };
      }

      logger.info(accessInfo, '🚀 API server started');

      // Console-friendly output for development
      console.log('\n' + '='.repeat(70));
      console.log('  🚀 API Server Started');
      console.log('='.repeat(70));
      console.log(`  Dashboard: ${dashboardURL}`);
      console.log(`  API Docs:  http://localhost:${finalConfig.port}/docs`);
      console.log(`  Health:    http://localhost:${finalConfig.port}/health`);

      if (isWSL) {
        const wslIP = getWSL2IP();
        console.log('\n  📍 WSL2 Access Information:');
        console.log(`     WSL IP: ${wslIP}`);
        console.log(`     From Windows: http://localhost:${finalConfig.port}/dashboard`);
        console.log(`     From Network:  http://${wslIP}:${finalConfig.port}/dashboard`);
        console.log('\n  💡 Windows Port Forward (PowerShell as admin):');
        console.log(`     netsh interface portproxy add v4tov4 listenport=${finalConfig.port} listenaddress=0.0.0.0 connectport=${finalConfig.port} connectaddress=${wslIP}`);
      }

      console.log('='.repeat(70) + '\n');

      resolve();
    });

    server.on('error', (err) => {
      logger.error({ error: err }, 'API server failed to start');
      reject(err);
    });
  });
}

// Direct execution
if (require.main === module) {
  const port = parseInt(process.env.API_PORT || '3001', 10);
  const rpcUrl = process.env.RPC_URL || 'http://localhost:58545';

  // Initialize database first
  createDbConnection()
    .then(() => {
      return startApiServer({ port, rpcUrl });
    })
    .catch((err) => {
      console.error('Failed to start API:', err);
      process.exit(1);
    });
}
