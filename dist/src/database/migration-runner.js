"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationRunner = void 0;
exports.runMigrations = runMigrations;
exports.checkMigrationStatus = checkMigrationStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
/**
 * Migration runner with automatic execution and idempotency
 */
class MigrationRunner {
    constructor(migrationsDir) {
        this.db = (0, database_config_1.getDb)();
        // Default to src/database/migrations (works in both dev and dist)
        this.migrationsDir = migrationsDir || this.resolveMigrationsDir();
    }
    resolveMigrationsDir() {
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
    async initialize() {
        await (0, kysely_1.sql) `
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
    async scanMigrations() {
        if (!fs.existsSync(this.migrationsDir)) {
            console.warn(`[MigrationRunner] Migrations directory not found: ${this.migrationsDir}`);
            return [];
        }
        const files = fs.readdirSync(this.migrationsDir);
        const migrations = [];
        for (const file of files) {
            const match = file.match(/^(\d+)_(.+)\.(ts|sql)$/);
            if (match) {
                migrations.push({
                    version: match[1],
                    name: match[2],
                    extension: match[3],
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
    async getAppliedMigrations() {
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
    async executeTsMigration(file) {
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
    async executeSqlMigration(file) {
        const sqlContent = fs.readFileSync(file.fullPath, 'utf-8');
        // Split by semicolon but be careful with statements
        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));
        for (const statement of statements) {
            if (statement) {
                await (0, kysely_1.sql) `${kysely_1.sql.raw(statement)}`.execute(this.db);
            }
        }
    }
    /**
     * Record migration execution result
     */
    async recordMigration(file, success, executionTimeMs, error) {
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
            .onConflict(oc => oc.column('version').doUpdateSet({
            name: file.name,
            execution_time_ms: executionTimeMs,
            success,
        }))
            .execute();
        if (error) {
            console.error(`[MigrationRunner] ${file.version} failed: ${error}`);
        }
    }
    /**
     * Run all pending migrations
     */
    async run() {
        console.log('[MigrationRunner] Starting automatic migrations...');
        // Ensure tracking table exists
        await this.initialize();
        const migrations = await this.scanMigrations();
        const applied = await this.getAppliedMigrations();
        console.log(`[MigrationRunner] Found ${migrations.length} migrations, ${applied.size} already applied`);
        const results = [];
        for (const migration of migrations) {
            if (applied.has(migration.version)) {
                console.log(`[MigrationRunner] ⏭️  ${migration.version}_${migration.name} already applied`);
                continue;
            }
            console.log(`[MigrationRunner] 🚀 Running ${migration.version}_${migration.name}...`);
            const startTime = Date.now();
            let success = false;
            let error;
            try {
                if (migration.extension === 'ts') {
                    await this.executeTsMigration(migration);
                }
                else {
                    await this.executeSqlMigration(migration);
                }
                success = true;
                console.log(`[MigrationRunner] ✅ ${migration.version} completed`);
            }
            catch (err) {
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
    async hasPendingMigrations() {
        await this.initialize();
        const migrations = await this.scanMigrations();
        const applied = await this.getAppliedMigrations();
        return migrations.some(m => !applied.has(m.version));
    }
    /**
     * Get migration status for display
     */
    async getStatus() {
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
exports.MigrationRunner = MigrationRunner;
/**
 * Convenience function for auto-run on startup
 */
async function runMigrations() {
    const runner = new MigrationRunner();
    return runner.run();
}
/**
 * Check migration status without running
 */
async function checkMigrationStatus() {
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
