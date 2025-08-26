// backend/utils/userValidation.ts
import { Request } from 'express';
import User from '../models/User';
import { ErrorHandler } from './errorHandler';

/**
 * 用户验证工具类
 */
export class UserValidator {
  /**
   * 验证用户是否已认证
   */
  static validateAuthentication(req: Request): string {
    if (!req.user?.userId) {
      throw ErrorHandler.createAuthenticationError('用户未认证');
    }
    return req.user.userId;
  }

  /**
   * 验证并获取用户信息
   */
  static async validateAndGetUser(req: Request): Promise<any> {
    const userId = this.validateAuthentication(req);
    
    const user = await User.findById(userId);
    if (!user) {
      throw ErrorHandler.createNotFoundError('用户不存在');
    }
    
    if (!user.isActive) {
      throw ErrorHandler.createAuthorizationError('账号已被禁用');
    }
    
    return user;
  }

  /**
   * 验证用户输入字段
   */
  static validateUserInput(data: any, requiredFields: string[]): void {
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length > 0) {
      throw ErrorHandler.createValidationError(
        `缺少必填字段: ${missingFields.join(', ')}`
      );
    }
  }

  /**
   * 验证用户名和邮箱唯一性
   */
  static async validateUniqueness(
    username?: string, 
    email?: string, 
    excludeUserId?: string
  ): Promise<void> {
    if (!username && !email) return;

    const query: any = {
      $or: [
        ...(username ? [{ username }] : []),
        ...(email ? [{ email }] : [])
      ]
    };

    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }

    const existingUser = await User.findOne(query);
    
    if (existingUser) {
      const conflictField = existingUser.username === username ? '用户名' : '邮箱';
      throw ErrorHandler.createValidationError(`${conflictField}已存在`);
    }
  }

  /**
   * 认证用户并返回用户信息
   */
  static async authenticateUser(req: any) {
    const userId = req.user?.userId;
    
    if (!userId) {
      throw ErrorHandler.createAuthenticationError('未授权访问');
    }

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      throw ErrorHandler.createNotFoundError('用户不存在');
    }

    return user;
  }

  /**
   * 格式化用户响应数据
   */
  static formatUserResponse(user: any) {
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      createdAt: user.createdAt
    };
  }

  /**
   * 验证密码强度
   */
  static validatePasswordStrength(password: string): void {
    if (password.length < 6) {
      throw ErrorHandler.createValidationError('密码长度至少6位');
    }
    
    // 可以添加更多密码强度验证规则
    // if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    //   throw ErrorHandler.createValidationError('密码必须包含大小写字母和数字');
    // }
  }

  /**
   * 验证邮箱格式
   */
  static validateEmailFormat(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw ErrorHandler.createValidationError('邮箱格式不正确');
    }
  }

  /**
   * 验证用户名格式
   */
  static validateUsernameFormat(username: string): void {
    if (username.length < 3 || username.length > 20) {
      throw ErrorHandler.createValidationError('用户名长度必须在3-20字符之间');
    }
    
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
      throw ErrorHandler.createValidationError('用户名只能包含字母、数字、下划线和中文');
    }
  }
}

/**
 * 资源验证器 - 验证资源所有权
 */
export class ResourceValidator {
  /**
   * 验证资源所有权
   */
  static async validateOwnership(Model: any, resourceId: string, userId: string, resourceName: string = '资源') {
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      throw ErrorHandler.createNotFoundError(`${resourceName}不存在`);
    }
    
    if (resource.userId && resource.userId.toString() !== userId) {
      throw ErrorHandler.createAuthorizationError(`无权访问此${resourceName}`);
    }
    
    return resource;
  }

  /**
   * 验证批量资源所有权
   */
  static async validateBatchOwnership(
    resourceModel: any,
    resourceIds: string[],
    userId: string,
    resourceName: string = '资源'
  ): Promise<any[]> {
    const resources = await resourceModel.find({ 
      _id: { $in: resourceIds }, 
      userId 
    });
    
    if (resources.length !== resourceIds.length) {
      throw ErrorHandler.createNotFoundError(`部分${resourceName}不存在或无权限访问`);
    }
    
    return resources;
  }
}