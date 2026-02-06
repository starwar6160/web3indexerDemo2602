"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Web3 Indexer API',
            version: '1.0.0',
            description: `
        Production-ready Web3 blockchain indexer API with ERC20 transfer event tracking.

        ## BigInt Safety Notice
        All numeric values representing BigInt (block numbers, amounts, timestamps) are returned as **strings** to prevent precision loss beyond 2^53.

        ## Rate Limiting
        - 100 requests per 60 seconds per IP
        - Standard \`RateLimit-*\` headers are included in responses
      `,
            contact: {
                name: 'API Support',
                email: 'support@example.com',
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT',
            },
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Development server',
            },
            {
                url: 'http://localhost:3002',
                description: 'Test server',
            },
        ],
        components: {
            schemas: {
                Block: {
                    type: 'object',
                    properties: {
                        number: {
                            type: 'string',
                            description: 'Block number (BigInt as string)',
                            example: '12345678',
                        },
                        hash: {
                            type: 'string',
                            description: 'Block hash (0x-prefixed)',
                            example: '0x1234...abcd',
                        },
                        parent_hash: {
                            type: 'string',
                            description: 'Parent block hash',
                        },
                        timestamp: {
                            type: 'string',
                            description: 'Unix timestamp (BigInt as string)',
                        },
                        chain_id: {
                            type: 'string',
                            description: 'Chain ID (BigInt as string)',
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Database insertion timestamp',
                        },
                    },
                },
                Transfer: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'Database ID',
                        },
                        block_number: {
                            type: 'string',
                            description: 'Block number (BigInt as string)',
                        },
                        transaction_hash: {
                            type: 'string',
                            description: 'Transaction hash (0x-prefixed)',
                        },
                        log_index: {
                            type: 'integer',
                            description: 'Log index within transaction',
                        },
                        from_address: {
                            type: 'string',
                            description: 'Sender address (0x-prefixed)',
                        },
                        to_address: {
                            type: 'string',
                            description: 'Recipient address (0x-prefixed)',
                        },
                        amount: {
                            type: 'string',
                            description: 'Transfer amount (BigInt as string, preserves full precision)',
                            example: '1000000000000000000',
                        },
                        token_address: {
                            type: 'string',
                            description: 'ERC20 token contract address',
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                        },
                    },
                },
                SyncStatus: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['synchronized', 'syncing', 'error'],
                            description: 'Current sync status',
                        },
                        timestamp: {
                            type: 'string',
                            format: 'date-time',
                        },
                        uptime: {
                            type: 'number',
                            description: 'Process uptime in seconds',
                        },
                        sync: {
                            type: 'object',
                            properties: {
                                latestNetworkBlock: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'Latest block on network',
                                },
                                latestIndexedBlock: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'Latest indexed block',
                                },
                                lastSyncedAt: {
                                    type: 'string',
                                    format: 'date-time',
                                    nullable: true,
                                },
                                lag: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'Block lag (BigInt as string)',
                                },
                                syncPercentage: {
                                    type: 'string',
                                    description: 'Sync completion percentage',
                                    example: '99.76',
                                },
                                synced: {
                                    type: 'boolean',
                                    description: 'True if lag <= 5 blocks',
                                },
                            },
                        },
                    },
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message',
                        },
                        message: {
                            type: 'string',
                            description: 'Detailed error message (development only)',
                        },
                    },
                },
                PaginationMeta: {
                    type: 'object',
                    properties: {
                        total: {
                            type: 'integer',
                            description: 'Total number of items',
                        },
                        page: {
                            type: 'integer',
                            description: 'Current page number',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Items per page',
                        },
                        totalPages: {
                            type: 'integer',
                            description: 'Total number of pages',
                        },
                        hasNext: {
                            type: 'boolean',
                            description: 'Whether next page exists',
                        },
                        hasPrev: {
                            type: 'boolean',
                            description: 'Whether previous page exists',
                        },
                    },
                },
            },
        },
    },
    apis: ['./src/api/*.ts'], // Paths to files containing Swagger annotations
};
exports.swaggerSpec = (0, swagger_jsdoc_1.default)(options);
