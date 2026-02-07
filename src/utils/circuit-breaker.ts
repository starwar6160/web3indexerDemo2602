import logger from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;      // 连续失败多少次后熔断
  resetTimeoutMs: number;        // 熔断后等待多久进入半开状态
  halfOpenMaxCalls: number;      // 半开状态最多允许多少次试探
}

/**
 * Circuit Breaker - 熔断器
 * 防止RPC服务雪崩时持续请求放大故障
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(
    private readonly options: CircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      halfOpenMaxCalls: 3,
    }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查状态
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
        this.successCount = 0;
        logger.info('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN, rejecting request');
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
      throw new Error('Circuit breaker HALF_OPEN call limit reached');
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();

      // 成功处理
      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        // 连续成功则关闭熔断器
        if (this.successCount >= this.options.halfOpenMaxCalls) {
          this.state = 'CLOSED';
          this.failureCount = 0;
          this.halfOpenCalls = 0;
          logger.info('Circuit breaker recovered, entering CLOSED state');
        }
      } else {
        // CLOSED 状态下重置失败计数
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.state === 'HALF_OPEN') {
        // 半开状态失败立即重新熔断
        this.state = 'OPEN';
        logger.error(
          { failureCount: this.failureCount },
          'Circuit breaker re-opened due to failure in HALF_OPEN state'
        );
      } else if (this.failureCount >= this.options.failureThreshold) {
        this.state = 'OPEN';
        logger.error(
          { failureCount: this.failureCount },
          'Circuit breaker opened due to consecutive failures'
        );
      }

      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// 全局熔断器实例
let globalCircuitBreaker: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreaker();
  }
  return globalCircuitBreaker;
}

export function resetCircuitBreaker(): void {
  globalCircuitBreaker = null;
}
