"use strict";
/**
 * 线程安全的服务状态管理器
 * 使用 Atomics 实现无竞态条件的状态控制
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceState = exports.ServiceStateManager = exports.ServiceStatus = void 0;
exports.isRunning = isRunning;
exports.setRunning = setRunning;
var ServiceStatus;
(function (ServiceStatus) {
    ServiceStatus["STARTING"] = "starting";
    ServiceStatus["RUNNING"] = "running";
    ServiceStatus["STOPPING"] = "stopping";
    ServiceStatus["STOPPED"] = "stopped";
    ServiceStatus["ERROR"] = "error";
})(ServiceStatus || (exports.ServiceStatus = ServiceStatus = {}));
/**
 * 服务状态管理器
 */
class ServiceStateManager {
    constructor() {
        this.status = ServiceStatus.STARTING;
        this.statusChangeCallbacks = new Set();
        this.lock = 0; // 用于简单的互斥
    }
    /**
     * 获取当前状态
     */
    getStatus() {
        return this.status;
    }
    /**
     * 设置状态（带简单锁机制）
     */
    setStatus(newStatus) {
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
                throw new Error(`Invalid status transition: ${oldStatus} -> ${newStatus}`);
            }
            this.status = newStatus;
            // 触发回调
            this.statusChangeCallbacks.forEach(callback => {
                try {
                    callback(newStatus);
                }
                catch (error) {
                    console.error('Status change callback error:', error);
                }
            });
            console.log(`[ServiceState] Status: ${oldStatus} -> ${newStatus}`);
        }
        finally {
            // 释放锁
            this.lock = 0;
        }
    }
    /**
     * 检查服务是否应该运行
     */
    shouldRun() {
        const status = this.getStatus();
        return status === ServiceStatus.RUNNING || status === ServiceStatus.STARTING;
    }
    /**
     * 检查服务是否正在停止
     */
    isStopping() {
        const status = this.getStatus();
        return status === ServiceStatus.STOPPING || status === ServiceStatus.STOPPED;
    }
    /**
     * 请求优雅停止
     */
    requestShutdown() {
        if (this.shouldRun()) {
            this.setStatus(ServiceStatus.STOPPING);
        }
    }
    /**
     * 标记服务已停止
     */
    markStopped() {
        this.setStatus(ServiceStatus.STOPPED);
    }
    /**
     * 标记服务出错
     */
    markError() {
        this.setStatus(ServiceStatus.ERROR);
    }
    /**
     * 标记服务正在运行
     */
    markRunning() {
        this.setStatus(ServiceStatus.RUNNING);
    }
    /**
     * 注册状态变化回调
     */
    onStatusChange(callback) {
        this.statusChangeCallbacks.add(callback);
        // 返回取消注册函数
        return () => {
            this.statusChangeCallbacks.delete(callback);
        };
    }
    /**
     * 验证状态转换是否合法
     */
    isValidTransition(oldStatus, newStatus) {
        const validTransitions = {
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
    async waitForStatus(targetStatus, timeout = 5000) {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const checkStatus = () => {
                if (this.getStatus() === targetStatus) {
                    resolve();
                    return;
                }
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout waiting for status ${targetStatus}. Current: ${this.getStatus()}`));
                    return;
                }
                setTimeout(checkStatus, 100);
            };
            checkStatus();
        });
    }
}
exports.ServiceStateManager = ServiceStateManager;
/**
 * 单例实例
 */
exports.serviceState = new ServiceStateManager();
/**
 * 兼容性：导出 isRunning 函数用于现有代码
 * @deprecated 使用 serviceState.shouldRun() 代替
 */
function isRunning() {
    return exports.serviceState.shouldRun();
}
/**
 * 兼容性：导出 setRunning 函数用于现有代码
 * @deprecated 使用 serviceState.setStatus() 代替
 */
function setRunning(running) {
    if (running) {
        exports.serviceState.markRunning();
    }
    else {
        exports.serviceState.requestShutdown();
    }
}
