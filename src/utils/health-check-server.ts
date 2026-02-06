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

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

export interface HealthCheckConfig {
  port: number;
  syncLagThreshold: number; // 如果滞后超过这个值，认为不健康
  instanceId: string;
}

/**
 * 健康检查器
 */
export class HealthCheckServer {
  private server: Server | null = null;

  constructor(
    private config: HealthCheckConfig,
    private healthChecks: {
      /**
       * 检查同步延迟
       * @returns 当前滞后区块数，null表示无法判断
       */
      getSyncLag: () => Promise<number | null>;

      /**
       * 检查数据库连接
       */
      checkDb: () => Promise<boolean>;

      /**
       * 检查RPC连接
       */
      checkRpc: () => Promise<boolean>;
    }
  ) {}

  /**
   * 启动健康检查服务器
   */
  start(): void {
    this.server = createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      try {
        if (req.url === '/healthz') {
          await this.handleLiveness(res);
        } else if (req.url === '/ready') {
          await this.handleReadiness(res);
        } else if (req.url === '/metrics') {
          await this.handleMetrics(res);
        } else {
          this.sendError(res, 404, 'Not found');
        }
      } catch (error) {
        this.sendError(res, 500, 'Health check failed', error as Error);
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
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(JSON.stringify({
            level: 'INFO',
            message: 'Health check server stopped',
          }));
          resolve();
        });
      } else {
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
  private async handleLiveness(res: ServerResponse): Promise<void> {
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
  private async handleReadiness(res: ServerResponse): Promise<void> {
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
    } else {
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
  private async handleMetrics(res: ServerResponse): Promise<void> {
    // 动态导入metrics（避免循环依赖）
    const { metrics } = await import('./metrics');

    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(200);
    res.end(metrics.exportPrometheusFormat());
  }

  /**
   * 检查同步延迟
   *
   * @returns true=健康, false=不健康
   */
  private async checkSyncLag(): Promise<boolean> {
    const lag = await this.healthChecks.getSyncLag();

    // 无法获取延迟 = 认为健康（刚启动时）
    if (lag === null) return true;

    // 延迟超过阈值 = 不健康
    return lag <= this.config.syncLagThreshold;
  }

  private sendError(res: ServerResponse, code: number, message: string, error?: Error): void {
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
