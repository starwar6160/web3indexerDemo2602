import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createPublicClient, http } from 'viem';
import { BlockRepository } from './database/block-repository';
import { TransfersRepository } from './database/transfers-repository';
import { SyncStatusRepository } from './database/sync-status-repository';
import { getDb } from './database/database-config';
import logger from './utils/logger';

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
    transport: http(finalConfig.rpcUrl),
  });

  /**
   * GET /api/status
   * Returns sync status: latest block, local max, lag, uptime
   */
  app.get('/api/status', async (req: Request, res: Response) => {
    try {
      const [localMaxBlock, chainHead, dbHealth] = await Promise.all([
        blockRepo.getMaxBlockNumber(),
        rpcClient.getBlockNumber().catch(() => null),
        checkDbHealth(),
      ]);

      const lag = chainHead && localMaxBlock !== null
        ? Number(chainHead - localMaxBlock)
        : null;

      const status = {
        status: dbHealth ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        sync: {
          localMaxBlock: localMaxBlock?.toString() ?? null,
          chainHeadBlock: chainHead?.toString() ?? null,
          lagBlocks: lag,
          synced: lag !== null && lag <= 5, // Within 5 blocks = synced
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
   * GET /api/blocks?limit=20
   * Returns recent blocks (descending order)
   */
  app.get('/api/blocks', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

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

      res.json({
        blocks: formatted,
        pagination: {
          limit,
          offset,
          count: formatted.length,
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
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const contractAddress = req.query.contract as string | undefined;

      let transfers;
      if (contractAddress) {
        transfers = await transfersRepo.getByContract(contractAddress, limit);
      } else {
        // Get recent transfers from all contracts
        transfers = await transfersRepo.db
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
        amount: t.amount, // Already string (DECIMAL)
        contract_address: t.contract_address,
        created_at: t.created_at,
      }));

      res.json({
        transfers: formatted,
        count: formatted.length,
        contractFilter: contractAddress || null,
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
   * GET /api/blocks/:number
   * Returns specific block with its transfers
   */
  app.get('/api/blocks/:number', async (req: Request, res: Response) => {
    try {
      const blockNumber = BigInt(req.params.number);

      const [block, transfers] = await Promise.all([
        blockRepo.findById(blockNumber),
        transfersRepo.getByBlockNumber(blockNumber),
      ]);

      if (!block) {
        res.status(404).json({ error: 'Block not found' });
        return;
      }

      res.json({
        block: {
          number: block.number.toString(),
          hash: block.hash,
          parent_hash: block.parent_hash,
          timestamp: block.timestamp.toString(),
          chain_id: block.chain_id.toString(),
          created_at: block.created_at,
        },
        transfers: transfers.map((t) => ({
          id: t.id,
          transaction_hash: t.transaction_hash,
          log_index: t.log_index,
          from_address: t.from_address,
          to_address: t.to_address,
          amount: t.amount,
          contract_address: t.contract_address,
        })),
        transferCount: transfers.length,
      });
    } catch (error) {
      logger.error({ error }, 'API /api/blocks/:number failed');
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
      logger.info(
        {
          port: finalConfig.port,
          endpoints: [
            '/api/status',
            '/api/blocks',
            '/api/blocks/:number',
            '/api/transfers',
            '/health',
          ],
        },
        '🚀 API server started'
      );
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

  startApiServer({ port, rpcUrl }).catch((err) => {
    console.error('Failed to start API:', err);
    process.exit(1);
  });
}
