/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/utils/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { PerformanceMonitor } from './performance';

// 错误类型枚举
export enum ErrorType {
  VALIDATION = 'VALIDATION_ERROR',
  AUTHENTICATION = 'AUTHENTICATION_ERROR',
  AUTHORIZATION = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND_ERROR',
  DATABASE = 'DATABASE_ERROR',
  EXTERNAL_API = 'EXTERNAL_API_ERROR',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  INTERNAL = 'INTERNAL_SERVER_ERROR'
}

// 自定义错误类
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: any
  ) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

// 错误处理工具类
export class ErrorHandler {
  // 创建验证错误
  static createValidationError(message: string, details?: any): AppError {
    return new AppError(message, ErrorType.VALIDATION, 400, true, details);
  }

  // 创建认证错误
  static createAuthenticationError(message: string = '用户未认证'): AppError {
    return new AppError(message, ErrorType.AUTHENTICATION, 401);
  }

  // 创建授权错误
  static createAuthorizationError(message: string = '无权限访问'): AppError {
    return new AppError(message, ErrorType.AUTHORIZATION, 403);
  }

  // 创建资源未找到错误
  static createNotFoundError(message: string = '资源未找到'): AppError {
    return new AppError(message, ErrorType.NOT_FOUND, 404);
  }

  // 创建数据库错误
  static createDatabaseError(message: string, originalError?: any): AppError {
    return new AppError(
      message,
      ErrorType.DATABASE,
      500,
      true,
      { originalError: originalError?.message }
    );
  }

  // 创建外部API错误
  static createExternalApiError(message: string, service: string, originalError?: any): AppError {
    return new AppError(
      message,
      ErrorType.EXTERNAL_API,
      502,
      true,
      { service, originalError: originalError?.message }
    );
  }

  // 请求体过大（常见于富文本 base64 图片）
  static createPayloadTooLargeError(message: string = '请求体过大，请压缩图片或减少内容后重试', originalError?: any): AppError {
    return new AppError(
      message,
      ErrorType.PAYLOAD_TOO_LARGE,
      413,
      true,
      { originalError: originalError?.message || originalError?.type }
    );
  }

  // 创建内部服务器错误
  static createInternalError(message: string = '内部服务器错误', originalError?: any): AppError {
    return new AppError(
      message,
      ErrorType.INTERNAL,
      500,
      false,
      { originalError: originalError?.message }
    );
  }

  // 包装异步操作，自动处理错误
  static async wrapAsync<T>(
    operation: () => Promise<T>,
    operationName: string,
    errorMessage?: string
  ): Promise<T> {
    try {
      return await PerformanceMonitor.measureOperation(
        operationName,
        operation
      );
    } catch (error: any) {
      console.error(`❌ ${operationName} 失败:`, error.message || error);
      
      // 如果已经是AppError，直接抛出
      if (error instanceof AppError) {
        throw error;
      }
      
      // 根据错误类型创建相应的AppError
      if (error.name === 'ValidationError') {
        throw ErrorHandler.createValidationError(
          errorMessage || '数据验证失败',
          error.errors
        );
      }
      
      if (error.name === 'MongoError' || error.name === 'MongooseError') {
        throw ErrorHandler.createDatabaseError(
          errorMessage || '数据库操作失败',
          error
        );
      }
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw ErrorHandler.createExternalApiError(
          errorMessage || '外部服务连接失败',
          'unknown',
          error
        );
      }
      
      // 默认为内部错误
      throw ErrorHandler.createInternalError(
        errorMessage || '操作失败',
        error
      );
    }
  }
}

// 全局错误处理中间件
export const globalErrorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let appError: AppError;

  // 如果不是AppError，转换为AppError
  if (!(error instanceof AppError)) {
    // body-parser / express.json 的 payload-too-large
    const anyErr = error as any;
    const isTooLarge =
      anyErr?.type === 'entity.too.large' ||
      anyErr?.status === 413 ||
      anyErr?.statusCode === 413 ||
      String(anyErr?.message || '').toLowerCase().includes('request entity too large');
    if (isTooLarge) {
      appError = ErrorHandler.createPayloadTooLargeError('请求体过大：图片/内容太大，请压缩图片或改为外链图片', anyErr);
    } else {
    appError = ErrorHandler.createInternalError(
      '服务器内部错误',
      error
    );
    }
  } else {
    appError = error;
  }

  // 记录错误日志
  const logLevel = appError.statusCode >= 500 ? '❌' : '⚠️';
  console.error(
    `${logLevel} [${appError.type}] ${req.method} ${req.path}:`,
    {
      message: appError.message,
      statusCode: appError.statusCode,
      userId: (req as any).user?.userId,
      details: appError.details,
      stack: appError.isOperational ? undefined : appError.stack
    }
  );

  // 构建响应
  const response: any = {
    success: false,
    error: appError.message,
    type: appError.type
  };

  // 在开发环境中包含更多错误信息
  if (process.env.NODE_ENV === 'development') {
    response.details = appError.details;
    if (!appError.isOperational) {
      response.stack = appError.stack;
    }
  }

  res.status(appError.statusCode).json(response);
};

// 异步路由包装器
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 响应工具类
export class ResponseHandler {
  // 成功响应
  static success(
    res: Response,
    data?: any,
    message: string = '操作成功',
    statusCode: number = 200
  ): void {
    res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  // 分页响应
  static paginated(
    res: Response,
    data: any[],
    total: number,
    page: number,
    limit: number,
    message: string = '获取成功'
  ): void {
    res.json({
      success: true,
      message,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  }
}