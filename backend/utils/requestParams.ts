import { ErrorHandler } from './errorHandler';

export function requireSingleRouteParam(
  value: string | string[] | undefined,
  name: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw ErrorHandler.createValidationError(`路由参数 ${name} 无效`);
  }

  return value;
}
