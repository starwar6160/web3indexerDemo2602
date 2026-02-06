"use strict";
/**
 * Health Check 端点（符合K8s/Docker标准）
 *
 * SpaceX哲学:
 * - 不健康 = 立即炸
 * - 健康检查失败 = 容器重启
 * - 不要"勉强运行"
 *
 * 标准:
 * - /healthz (K8s livenessProbe)
 * - /ready (K8s readinessProbe)
 * - /metrics (Prometheus scraping)
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
exports.HealthCheckServer = void 0;
const http_1 = require("http");
/**
 * 健康检查器
 */
class HealthCheckServer {
    constructor(config, healthChecks) {
        this.config = config;
        this.healthChecks = healthChecks;
        this.server = null;
    }
    /**
     * 启动健康检查服务器
     */
    start() {
        this.server = (0, http_1.createServer)(async (req, res) => {
            // CORS headers
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            try {
                if (req.url === '/healthz') {
                    await this.handleLiveness(res);
                }
                else if (req.url === '/ready') {
                    await this.handleReadiness(res);
                }
                else if (req.url === '/metrics') {
                    await this.handleMetrics(res);
                }
                else {
                    this.sendError(res, 404, 'Not found');
                }
            }
            catch (error) {
                this.sendError(res, 500, 'Health check failed', error);
            }
        });
        this.server.listen(this.config.port, () => {
            console.log(JSON.stringify({
                level: 'INFO',
                message: 'Health check server started',
                port: this.config.port,
                endpoints: ['/healthz', '/ready', '/metrics'],
            }));
        });
    }
    /**
     * 停止健康检查服务器
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log(JSON.stringify({
                        level: 'INFO',
                        message: 'Health check server stopped',
                    }));
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
    /**
     * Liveness Probe（存活检查）
     *
     * 规则: 进程还活着？
     * - 返回200 = 活着
     * - 返回503 = 已死（容器会重启）
     */
    async handleLiveness(res) {
        // Liveness只检查进程本身，不检查依赖
        res.writeHead(200);
        res.end(JSON.stringify({
            status: 'alive',
            instance_id: this.config.instanceId,
            timestamp: new Date().toISOString(),
        }));
    }
    /**
     * Readiness Probe（就绪检查）
     *
     * 规则: 能否接收流量？
     * - 返回200 = 就绪
     * - 返回503 = 未就绪（K8s会停止转发流量）
     *
     * 检查项:
     * 1. 同步延迟是否在阈值内
     * 2. 数据库是否可连接
     * 3. RPC是否可连接
     */
    async handleReadiness(res) {
        const checks = {
            sync_lag: await this.checkSyncLag(),
            database: await this.healthChecks.checkDb(),
            rpc: await this.healthChecks.checkRpc(),
        };
        const isHealthy = Object.values(checks).every((v) => v === true);
        if (isHealthy) {
            res.writeHead(200);
            res.end(JSON.stringify({
                status: 'ready',
                instance_id: this.config.instanceId,
                checks,
                timestamp: new Date().toISOString(),
            }));
        }
        else {
            res.writeHead(503); // Service Unavailable
            res.end(JSON.stringify({
                status: 'not_ready',
                instance_id: this.config.instanceId,
                checks,
                timestamp: new Date().toISOString(),
            }));
        }
    }
    /**
     * Prometheus Metrics 指标导出
     */
    async handleMetrics(res) {
        // 动态导入metrics（避免循环依赖）
        const { metrics } = await Promise.resolve().then(() => __importStar(require('./metrics')));
        res.setHeader('Content-Type', 'text/plain');
        res.writeHead(200);
        res.end(metrics.exportPrometheusFormat());
    }
    /**
     * 检查同步延迟
     *
     * @returns true=健康, false=不健康
     */
    async checkSyncLag() {
        const lag = await this.healthChecks.getSyncLag();
        // 无法获取延迟 = 认为健康（刚启动时）
        if (lag === null)
            return true;
        // 延迟超过阈值 = 不健康
        return lag <= this.config.syncLagThreshold;
    }
    sendError(res, code, message, error) {
        res.writeHead(code);
        res.end(JSON.stringify({
            status: 'error',
            code,
            message,
            error: error?.message,
            instance_id: this.config.instanceId,
            timestamp: new Date().toISOString(),
        }));
    }
}
exports.HealthCheckServer = HealthCheckServer;
