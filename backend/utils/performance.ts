// backend/utils/performance.ts
import { performance } from 'perf_hooks';
import { getCacheStats } from './embedding';

export interface PerformanceMetrics {
  operationName: string;
  duration: number;
  timestamp: number;
  success: boolean;
  metadata?: any;
}

export class PerformanceMonitor {
  private static metrics: PerformanceMetrics[] = [];
  private static readonly MAX_METRICS = 1000; // 保留最近1000条记录

  // 记录操作性能
  static async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    metadata?: any
  ): Promise<T> {
    const startTime = performance.now();
    let success = true;
    let result: T;

    try {
      result = await operation();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.recordMetric({
        operationName,
        duration,
        timestamp: Date.now(),
        success,
        metadata
      });

      // 输出性能日志
      const status = success ? '✅' : '❌';
      console.log(`${status} ${operationName}: ${duration.toFixed(2)}ms`);
    }
  }

  // 记录性能指标
  private static recordMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);
    
    // 保持数组大小在限制内
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  // 获取性能统计
  static getPerformanceStats(operationName?: string): {
    totalOperations: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    successRate: number;
    recentOperations: PerformanceMetrics[];
  } {
    let filteredMetrics = this.metrics;
    
    if (operationName) {
      filteredMetrics = this.metrics.filter(m => m.operationName === operationName);
    }

    if (filteredMetrics.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        successRate: 0,
        recentOperations: []
      };
    }

    const durations = filteredMetrics.map(m => m.duration);
    const successCount = filteredMetrics.filter(m => m.success).length;

    return {
      totalOperations: filteredMetrics.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      successRate: (successCount / filteredMetrics.length) * 100,
      recentOperations: filteredMetrics.slice(-10) // 最近10次操作
    };
  }

  // 获取系统整体性能报告
  static getSystemPerformanceReport(): {
    cache: any;
    operations: { [key: string]: any };
    systemHealth: {
      memoryUsage: NodeJS.MemoryUsage;
      uptime: number;
    };
  } {
    const cacheStats = getCacheStats();
    
    // 按操作类型分组统计
    const operationTypes = [...new Set(this.metrics.map(m => m.operationName))];
    const operations: { [key: string]: any } = {};
    
    operationTypes.forEach(opName => {
      operations[opName] = this.getPerformanceStats(opName);
    });

    return {
      cache: cacheStats,
      operations,
      systemHealth: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }

  // 清理性能记录
  static clearMetrics(): void {
    this.metrics = [];
    console.log('🧹 性能监控记录已清理');
  }
}

// 便捷的装饰器函数
export function measurePerformance(operationName: string, metadata?: any) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return PerformanceMonitor.measureOperation(
        `${target.constructor.name}.${propertyName}`,
        () => method.apply(this, args),
        metadata
      );
    };
  };
}

// 数据库查询性能监控
export async function measureDatabaseQuery<T>(
  queryName: string,
  query: () => Promise<T>,
  expectedResultCount?: number
): Promise<T> {
  return PerformanceMonitor.measureOperation(
    `DB_${queryName}`,
    query,
    { expectedResultCount }
  );
}

// 向量计算性能监控
export async function measureEmbeddingOperation<T>(
  operationType: string,
  operation: () => Promise<T>,
  textLength?: number
): Promise<T> {
  return PerformanceMonitor.measureOperation(
    `EMBEDDING_${operationType}`,
    operation,
    { textLength }
  );
}