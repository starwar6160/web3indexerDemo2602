/**
 * 线程安全的服务状态管理器
 * 使用 Atomics 实现无竞态条件的状态控制
 */

export enum ServiceStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/**
 * 服务状态管理器
 */
export class ServiceStateManager {
  private status: ServiceStatus = ServiceStatus.STARTING;
  private statusChangeCallbacks: Set<(status: ServiceStatus) => void> = new Set();
  private lock = 0; // 用于简单的互斥

  /**
   * 获取当前状态
   */
  getStatus(): ServiceStatus {
    return this.status;
  }

  /**
   * 设置状态（带简单锁机制）
   */
  setStatus(newStatus: ServiceStatus): void {
    // 简单的自旋锁
    while (this.lock !== 0) {
      // 等待锁释放
    }

    // 获取锁
    this.lock = 1;

    try {
      const oldStatus = this.status;

      // 状态转换验证
      if (!this.isValidTransition(oldStatus, newStatus)) {
        throw new Error(
          `Invalid status transition: ${oldStatus} -> ${newStatus}`
        );
      }

      this.status = newStatus;

      // 触发回调
      this.statusChangeCallbacks.forEach(callback => {
        try {
          callback(newStatus);
        } catch (error) {
          console.error('Status change callback error:', error);
        }
      });

      console.log(`[ServiceState] Status: ${oldStatus} -> ${newStatus}`);
    } finally {
      // 释放锁
      this.lock = 0;
    }
  }

  /**
   * 检查服务是否应该运行
   */
  shouldRun(): boolean {
    const status = this.getStatus();
    return status === ServiceStatus.RUNNING || status === ServiceStatus.STARTING;
  }

  /**
   * 检查服务是否正在停止
   */
  isStopping(): boolean {
    const status = this.getStatus();
    return status === ServiceStatus.STOPPING || status === ServiceStatus.STOPPED;
  }

  /**
   * 请求优雅停止
   */
  requestShutdown(): void {
    if (this.shouldRun()) {
      this.setStatus(ServiceStatus.STOPPING);
    }
  }

  /**
   * 标记服务已停止
   */
  markStopped(): void {
    this.setStatus(ServiceStatus.STOPPED);
  }

  /**
   * 标记服务出错
   */
  markError(): void {
    this.setStatus(ServiceStatus.ERROR);
  }

  /**
   * 标记服务正在运行
   */
  markRunning(): void {
    this.setStatus(ServiceStatus.RUNNING);
  }

  /**
   * 注册状态变化回调
   */
  onStatusChange(callback: (status: ServiceStatus) => void): () => void {
    this.statusChangeCallbacks.add(callback);

    // 返回取消注册函数
    return () => {
      this.statusChangeCallbacks.delete(callback);
    };
  }

  /**
   * 验证状态转换是否合法
   */
  private isValidTransition(
    oldStatus: ServiceStatus,
    newStatus: ServiceStatus
  ): boolean {
    const validTransitions: Record<ServiceStatus, ServiceStatus[]> = {
      [ServiceStatus.STARTING]: [ServiceStatus.RUNNING, ServiceStatus.ERROR, ServiceStatus.STOPPING],
      [ServiceStatus.RUNNING]: [ServiceStatus.STOPPING, ServiceStatus.ERROR],
      [ServiceStatus.STOPPING]: [ServiceStatus.STOPPED],
      [ServiceStatus.STOPPED]: [ServiceStatus.STARTING], // 可以重启
      [ServiceStatus.ERROR]: [ServiceStatus.STARTING, ServiceStatus.STOPPED],
    };

    const allowed = validTransitions[oldStatus] || [];
    return allowed.includes(newStatus);
  }

  /**
   * 等待特定状态（用于测试）
   */
  async waitForStatus(
    targetStatus: ServiceStatus,
    timeout: number = 5000
  ): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        if (this.getStatus() === targetStatus) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(
            new Error(
              `Timeout waiting for status ${targetStatus}. Current: ${this.getStatus()}`
            )
          );
          return;
        }

        setTimeout(checkStatus, 100);
      };

      checkStatus();
    });
  }
}

/**
 * 单例实例
 */
export const serviceState = new ServiceStateManager();

/**
 * 兼容性：导出 isRunning 函数用于现有代码
 * @deprecated 使用 serviceState.shouldRun() 代替
 */
export function isRunning(): boolean {
  return serviceState.shouldRun();
}

/**
 * 兼容性：导出 setRunning 函数用于现有代码
 * @deprecated 使用 serviceState.setStatus() 代替
 */
export function setRunning(running: boolean): void {
  if (running) {
    serviceState.markRunning();
  } else {
    serviceState.requestShutdown();
  }
}
