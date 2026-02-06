/**
 * Phase 4: Automatic Migration Runner
 * 
 * Features:
 * - Auto-scan migrations directory
 * - Execute in version order (001 -> 002 -> 003)
 * - Idempotent: tracks applied migrations in DB
 * - Supports .ts and .sql migrations
 * - Runs automatically on program startup
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './database-config';
import { sql } from 'kysely';

export interface MigrationFile {
  version: string;
  name: string;
  extension: 'ts' | 'sql';
  fullPath: string;
}

export interface MigrationResult {
  version: string;
  name: string;
  success: boolean;
  executionTimeMs: number;
  error?: string;
}

/**
 * Migration runner with automatic execution and idempotency
 */
export class MigrationRunner {
  private db = getDb();
  private migrationsDir: string;

  constructor(migrationsDir?: string) {
    // Default to src/database/migrations (works in both dev and dist)
    this.migrationsDir = migrationsDir || this.resolveMigrationsDir();
  }

  private resolveMigrationsDir(): string {
    // Try to find migrations directory
    const possiblePaths = [
      path.join(process.cwd(), 'src', 'database', 'migrations'),
      path.join(process.cwd(), 'dist', 'database', 'migrations'),
      path.join(__dirname, 'migrations'), // Same directory as this file
    ];

    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }

    // Fallback to src path (will fail later if not exists)
    return path.join(process.cwd(), 'src', 'database', 'migrations');
  }

  /**
   * Initialize migrations tracking table
   */
  async initialize(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        checksum VARCHAR(64),
        execution_time_ms INTEGER,
        success BOOLEAN NOT NULL DEFAULT true
      );

      CREATE INDEX IF NOT EXISTS idx_migrations_version ON migrations(version);
      CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON migrations(applied_at DESC);
    `.execute(this.db);
  }

  /**
   * Scan migrations directory and return sorted list
   */
  async scanMigrations(): Promise<MigrationFile[]> {
    if (!fs.existsSync(this.migrationsDir)) {
      console.warn(`[MigrationRunner] Migrations directory not found: ${this.migrationsDir}`);
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir);
    const migrations: MigrationFile[] = [];

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.(ts|sql)$/);
      if (match) {
        migrations.push({
          version: match[1],
          name: match[2],
          extension: match[3] as 'ts' | 'sql',
          fullPath: path.join(this.migrationsDir, file),
        });
      }
    }

    // Sort by version number
    migrations.sort((a, b) => {
      const aNum = parseInt(a.version, 10);
      const bNum = parseInt(b.version, 10);
      return aNum - bNum;
    });

    return migrations;
  }

  /**
   * Get list of already applied migrations
   */
  async getAppliedMigrations(): Promise<Set<string>> {
    const result = await this.db
      .selectFrom('migrations')
      .select('version')
      .where('success', '=', true)
      .execute();

    return new Set(result.map(r => r.version));
  }

  /**
   * Execute a single TypeScript migration
   */
  private async executeTsMigration(file: MigrationFile): Promise<void> {
    // Clear require cache to allow re-running in development
    delete require.cache[require.resolve(file.fullPath)];
    
    const migration = require(file.fullPath);
    
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${file.version} does not export 'up' function`);
    }

    await migration.up();
  }

  /**
   * Execute a single SQL migration
   */
  private async executeSqlMigration(file: MigrationFile): Promise<void> {
    const sqlContent = fs.readFileSync(file.fullPath, 'utf-8');
    
    // Split by semicolon but be careful with statements
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    for (const statement of statements) {
      if (statement) {
        await sql`${sql.raw(statement)}`.execute(this.db);
      }
    }
  }

  /**
   * Record migration execution result
   */
  private async recordMigration(
    file: MigrationFile,
    success: boolean,
    executionTimeMs: number,
    error?: string
  ): Promise<void> {
    const now = new Date();
    
    await this.db
      .insertInto('migrations')
      .values({
        version: file.version,
        name: file.name,
        applied_at: new Date(),
        checksum: null,
        execution_time_ms: executionTimeMs,
        success,
      })
      .onConflict(oc => 
        oc.column('version').doUpdateSet({
          name: file.name,
          execution_time_ms: executionTimeMs,
          success,
        })
      )
      .execute();

    if (error) {
      console.error(`[MigrationRunner] ${file.version} failed: ${error}`);
    }
  }

  /**
   * Run all pending migrations
   */
  async run(): Promise<MigrationResult[]> {
    console.log('[MigrationRunner] Starting automatic migrations...');
    
    // Ensure tracking table exists
    await this.initialize();

    const migrations = await this.scanMigrations();
    const applied = await this.getAppliedMigrations();

    console.log(`[MigrationRunner] Found ${migrations.length} migrations, ${applied.size} already applied`);

    const results: MigrationResult[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        console.log(`[MigrationRunner] ⏭️  ${migration.version}_${migration.name} already applied`);
        continue;
      }

      console.log(`[MigrationRunner] 🚀 Running ${migration.version}_${migration.name}...`);
      
      const startTime = Date.now();
      let success = false;
      let error: string | undefined;

      try {
        if (migration.extension === 'ts') {
          await this.executeTsMigration(migration);
        } else {
          await this.executeSqlMigration(migration);
        }
        success = true;
        console.log(`[MigrationRunner] ✅ ${migration.version} completed`);
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        console.error(`[MigrationRunner] ❌ ${migration.version} failed: ${error}`);
        // Don't throw - record failure and continue
      }

      const executionTimeMs = Date.now() - startTime;
      await this.recordMigration(migration, success, executionTimeMs, error);

      results.push({
        version: migration.version,
        name: migration.name,
        success,
        executionTimeMs,
        error,
      });
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`[MigrationRunner] Complete: ${successful} applied, ${failed} failed, ${migrations.length - results.length} skipped`);

    return results;
  }

  /**
   * Check if there are pending migrations
   */
  async hasPendingMigrations(): Promise<boolean> {
    await this.initialize();
    const migrations = await this.scanMigrations();
    const applied = await this.getAppliedMigrations();
    
    return migrations.some(m => !applied.has(m.version));
  }

  /**
   * Get migration status for display
   */
  async getStatus(): Promise<{
    total: number;
    applied: number;
    pending: number;
    migrations: Array<{ version: string; name: string; applied: boolean; appliedAt?: Date }>;
  }> {
    await this.initialize();
    
    const allMigrations = await this.scanMigrations();
    const appliedSet = await this.getAppliedMigrations();
    
    const appliedRecords = await this.db
      .selectFrom('migrations')
      .select(['version', 'applied_at'])
      .where('success', '=', true)
      .execute();
    
    const appliedMap = new Map(appliedRecords.map(r => [r.version, r.applied_at]));

    return {
      total: allMigrations.length,
      applied: appliedSet.size,
      pending: allMigrations.length - appliedSet.size,
      migrations: allMigrations.map(m => ({
        version: m.version,
        name: m.name,
        applied: appliedSet.has(m.version),
        appliedAt: appliedMap.get(m.version),
      })),
    };
  }
}

/**
 * Convenience function for auto-run on startup
 */
export async function runMigrations(): Promise<MigrationResult[]> {
  const runner = new MigrationRunner();
  return runner.run();
}

/**
 * Check migration status without running
 */
export async function checkMigrationStatus(): Promise<ReturnType<MigrationRunner['getStatus']>> {
  const runner = new MigrationRunner();
  return runner.getStatus();
}

// If run directly
if (require.main === module) {
  runMigrations()
    .then(results => {
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.error(`[MigrationRunner] ${failed.length} migrations failed`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('[MigrationRunner] Fatal error:', error);
      process.exit(1);
    });
}
