"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const zod_1 = require("zod");
const logger_1 = __importDefault(require("./logger"));
/**
 * 环境变量验证 Schema
 * 使用 .parse() 而不是 .safeParse() - 任何配置错误都会立即崩溃
 */
const EnvSchema = zod_1.z.object({
    // 数据库配置
    DATABASE_URL: zod_1.z.string().url('DATABASE_URL must be a valid PostgreSQL connection URL'),
    // RPC 配置
    RPC_URL: zod_1.z.string().url('RPC_URL must be a valid HTTP URL').default('http://localhost:8545'),
    // 性能配置
    POLL_INTERVAL_MS: zod_1.z.string().transform(Number).pipe(zod_1.z.number().int().positive().max(60000) // 最大60秒
    ).default('2000'),
    DB_SYNC_BATCH_SIZE: zod_1.z.string().transform(Number).pipe(zod_1.z.number().int().positive().max(100) // 最大100个区块
    ).default('10'),
    MAX_RETRIES: zod_1.z.string().transform(Number).pipe(zod_1.z.number().int().positive().max(10)).default('3'),
    // 日志配置
    LOG_LEVEL: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    // 健康检查配置
    HEALTH_CHECK_PORT: zod_1.z.string().transform(Number).pipe(zod_1.z.number().int().positive().max(65535)).default('3000'),
});
/**
 * 验证并加载环境变量
 * 任何验证失败都会立即终止程序
 */
function validateEnv() {
    try {
        const env = EnvSchema.parse(process.env);
        logger_1.default.info({ env: { ...env, DATABASE_URL: '***REDACTED***' } }, '✅ Environment variables validated');
        return env;
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            logger_1.default.error({
                errors: error.errors.map(e => ({
                    path: e.path.join('.'),
                    message: e.message,
                    code: e.code,
                })),
            }, '❌ Fatal: Environment variable validation failed');
            console.error('\n❌ Invalid environment configuration:\n');
            error.errors.forEach((err) => {
                console.error(`  ${err.path.join('.')}: ${err.message}`);
            });
            console.error('\nPlease fix your .env file or docker-compose.yml\n');
            process.exit(1);
        }
        throw error;
    }
}
exports.config = validateEnv();
