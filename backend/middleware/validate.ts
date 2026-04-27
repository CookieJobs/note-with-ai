import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { ErrorHandler } from '../utils/errorHandler';

export const validate = (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((err) => ({
          path: err.path.join('.'),
          message: err.message
        }));
        next(ErrorHandler.createValidationError('数据验证失败', { errors }));
      } else {
        next(error);
      }
    }
  };
};
