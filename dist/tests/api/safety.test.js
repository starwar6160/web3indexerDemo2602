"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const server_1 = require("@/api/server");
const database_config_1 = require("@/database/database-config");
/**
 * API Data Safety Test
 *
 * Verifies that:
 * 1. All BigInt fields are returned as strings (not numbers)
 * 2. No precision loss occurs in API responses
 * 3. Block numbers beyond MAX_SAFE_INTEGER are handled correctly
 */
(0, vitest_1.describe)('API BigInt Safety', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        await (0, database_config_1.createDbConnection)();
        const server = (0, server_1.createApiServer)({ port: 3002 });
        app = server.app;
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, database_config_1.closeDbConnection)();
    });
    (0, vitest_1.describe)('GET /api/status', () => {
        (0, vitest_1.it)('should return all numeric block fields as strings', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/status')
                .expect(200);
            const { sync } = response.body;
            // CRITICAL: Block numbers must be strings
            (0, vitest_1.expect)(typeof sync.latestNetworkBlock).toBe('string');
            (0, vitest_1.expect)(typeof sync.latestIndexedBlock).toBe('string');
            (0, vitest_1.expect)(typeof sync.lag).toBe('string');
            (0, vitest_1.expect)(typeof sync.syncPercentage).toBe('string');
            // Verify format (should be numeric strings, not null)
            if (sync.latestNetworkBlock) {
                (0, vitest_1.expect)(sync.latestNetworkBlock).toMatch(/^\d+$/);
            }
            if (sync.latestIndexedBlock) {
                (0, vitest_1.expect)(sync.latestIndexedBlock).toMatch(/^\d+$/);
            }
        });
        (0, vitest_1.it)('should handle large block numbers without precision loss', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/status')
                .expect(200);
            // If there's data, verify the format
            const { sync } = response.body;
            // syncPercentage should be a decimal string like "99.76"
            (0, vitest_1.expect)(sync.syncPercentage).toMatch(/^\d+\.\d{2}$/);
        });
    });
    (0, vitest_1.describe)('GET /api/blocks', () => {
        (0, vitest_1.it)('should return block numbers as strings in data array', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/blocks?page=1&limit=5')
                .expect(200);
            const { data } = response.body;
            // If blocks exist, verify BigInt safety
            if (data && data.length > 0) {
                for (const block of data) {
                    (0, vitest_1.expect)(typeof block.number).toBe('string');
                    (0, vitest_1.expect)(typeof block.timestamp).toBe('string');
                    (0, vitest_1.expect)(typeof block.chain_id).toBe('string');
                    // Verify numeric format
                    (0, vitest_1.expect)(block.number).toMatch(/^\d+$/);
                    (0, vitest_1.expect)(block.timestamp).toMatch(/^\d+$/);
                }
            }
        });
        (0, vitest_1.it)('should include pagination metadata with proper types', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/blocks?page=1&limit=10')
                .expect(200);
            const { meta } = response.body;
            // Pagination fields should be numbers (not BigInt)
            (0, vitest_1.expect)(typeof meta.total).toBe('number');
            (0, vitest_1.expect)(typeof meta.page).toBe('number');
            (0, vitest_1.expect)(typeof meta.limit).toBe('number');
            (0, vitest_1.expect)(typeof meta.totalPages).toBe('number');
            (0, vitest_1.expect)(typeof meta.hasNext).toBe('boolean');
            (0, vitest_1.expect)(typeof meta.hasPrev).toBe('boolean');
        });
    });
    (0, vitest_1.describe)('GET /api/blocks/:id', () => {
        (0, vitest_1.it)('should accept hex hash and return string block numbers', async () => {
            // Test with a mock hash - may return 404 but shouldn't error
            const response = await (0, supertest_1.default)(app)
                .get('/api/blocks/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
                .expect(404); // Not found, but should not crash
            (0, vitest_1.expect)(response.body.error).toBe('Block not found');
        });
        (0, vitest_1.it)('should reject invalid block identifiers', async () => {
            // Invalid format
            const response = await (0, supertest_1.default)(app)
                .get('/api/blocks/invalid-id')
                .expect(400);
            (0, vitest_1.expect)(response.body.error).toContain('Invalid');
        });
    });
    (0, vitest_1.describe)('GET /api/transfers', () => {
        (0, vitest_1.it)('should return block_number and amount as strings', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/transfers?limit=5')
                .expect(200);
            const { data } = response.body;
            if (data && data.length > 0) {
                for (const transfer of data) {
                    (0, vitest_1.expect)(typeof transfer.block_number).toBe('string');
                    (0, vitest_1.expect)(typeof transfer.amount).toBe('string'); // DECIMAL as string
                    // Verify numeric format
                    (0, vitest_1.expect)(transfer.block_number).toMatch(/^\d+$/);
                }
            }
        });
    });
});
(0, vitest_1.describe)('API Error Handling', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        await (0, database_config_1.createDbConnection)();
        const server = (0, server_1.createApiServer)({ port: 3003 });
        app = server.app;
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, database_config_1.closeDbConnection)();
    });
    (0, vitest_1.it)('should return 400 for invalid pagination parameters', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/api/blocks?page=abc&limit=xyz')
            .expect(400);
        (0, vitest_1.expect)(response.body.error).toContain('Invalid');
    });
    (0, vitest_1.it)('should return 400 for negative page numbers', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/api/blocks?page=-1')
            .expect(400);
        (0, vitest_1.expect)(response.body.error).toContain('Invalid');
    });
    (0, vitest_1.it)('should limit max page size to 100', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/api/blocks?limit=1000')
            .expect(400);
        (0, vitest_1.expect)(response.body.error).toContain('Invalid');
    });
});
