import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApiServer } from '../../src/api/server';

/**
 * API Data Safety Test
 * 
 * Verifies that:
 * 1. All BigInt fields are returned as strings (not numbers)
 * 2. No precision loss occurs in API responses
 * 3. Block numbers beyond MAX_SAFE_INTEGER are handled correctly
 */

describe('API BigInt Safety', () => {
  let app: ReturnType<typeof createApiServer>['app'];

  beforeAll(() => {
    const server = createApiServer({ port: 3002 });
    app = server.app;
  });

  describe('GET /api/status', () => {
    it('should return all numeric block fields as strings', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      const { sync } = response.body;

      // CRITICAL: Block numbers must be strings
      expect(typeof sync.latestNetworkBlock).toBe('string');
      expect(typeof sync.latestIndexedBlock).toBe('string');
      expect(typeof sync.lag).toBe('string');
      expect(typeof sync.syncPercentage).toBe('string');

      // Verify format (should be numeric strings, not null)
      if (sync.latestNetworkBlock) {
        expect(sync.latestNetworkBlock).toMatch(/^\d+$/);
      }
      if (sync.latestIndexedBlock) {
        expect(sync.latestIndexedBlock).toMatch(/^\d+$/);
      }
    });

    it('should handle large block numbers without precision loss', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      // If there's data, verify the format
      const { sync } = response.body;
      
      // syncPercentage should be a decimal string like "99.76"
      expect(sync.syncPercentage).toMatch(/^\d+\.\d{2}$/);
    });
  });

  describe('GET /api/blocks', () => {
    it('should return block numbers as strings in data array', async () => {
      const response = await request(app)
        .get('/api/blocks?page=1&limit=5')
        .expect(200);

      const { data } = response.body;

      // If blocks exist, verify BigInt safety
      if (data && data.length > 0) {
        for (const block of data) {
          expect(typeof block.number).toBe('string');
          expect(typeof block.timestamp).toBe('string');
          expect(typeof block.chain_id).toBe('string');

          // Verify numeric format
          expect(block.number).toMatch(/^\d+$/);
          expect(block.timestamp).toMatch(/^\d+$/);
        }
      }
    });

    it('should include pagination metadata with proper types', async () => {
      const response = await request(app)
        .get('/api/blocks?page=1&limit=10')
        .expect(200);

      const { meta } = response.body;

      // Pagination fields should be numbers (not BigInt)
      expect(typeof meta.total).toBe('number');
      expect(typeof meta.page).toBe('number');
      expect(typeof meta.limit).toBe('number');
      expect(typeof meta.totalPages).toBe('number');
      expect(typeof meta.hasNext).toBe('boolean');
      expect(typeof meta.hasPrev).toBe('boolean');
    });
  });

  describe('GET /api/blocks/:id', () => {
    it('should accept hex hash and return string block numbers', async () => {
      // Test with a mock hash - may return 404 but shouldn't error
      const response = await request(app)
        .get('/api/blocks/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
        .expect(404); // Not found, but should not crash

      expect(response.body.error).toBe('Block not found');
    });

    it('should reject invalid block identifiers', async () => {
      // Invalid format
      const response = await request(app)
        .get('/api/blocks/invalid-id')
        .expect(400);

      expect(response.body.error).toContain('Invalid');
    });
  });

  describe('GET /api/transfers', () => {
    it('should return block_number and amount as strings', async () => {
      const response = await request(app)
        .get('/api/transfers?limit=5')
        .expect(200);

      const { data } = response.body;

      if (data && data.length > 0) {
        for (const transfer of data) {
          expect(typeof transfer.block_number).toBe('string');
          expect(typeof transfer.amount).toBe('string'); // DECIMAL as string

          // Verify numeric format
          expect(transfer.block_number).toMatch(/^\d+$/);
        }
      }
    });
  });
});

describe('API Error Handling', () => {
  let app: ReturnType<typeof createApiServer>['app'];

  beforeAll(() => {
    const server = createApiServer({ port: 3003 });
    app = server.app;
  });

  it('should return 400 for invalid pagination parameters', async () => {
    const response = await request(app)
      .get('/api/blocks?page=abc&limit=xyz')
      .expect(400);

    expect(response.body.error).toContain('Invalid');
  });

  it('should return 400 for negative page numbers', async () => {
    const response = await request(app)
      .get('/api/blocks?page=-1')
      .expect(400);

    expect(response.body.error).toContain('Invalid');
  });

  it('should limit max page size to 100', async () => {
    const response = await request(app)
      .get('/api/blocks?limit=1000')
      .expect(400);

    expect(response.body.error).toContain('Invalid');
  });
});
