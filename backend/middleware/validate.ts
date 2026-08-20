import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { ErrorHandler } from '../utils/errorHandler';

function findStableNoteBodyCode(issues: ZodError['issues']): 'NOTE_BODY_EMPTY' | 'NOTE_BODY_INVALID' | undefined {
  for (const issue of issues) {
    if (issue.message === 'NOTE_BODY_EMPTY' || issue.message === 'NOTE_BODY_INVALID') {
      return issue.message;
    }
    if (issue.code === 'invalid_union') {
      for (const unionIssues of issue.errors) {
        const stableCode = findStableNoteBodyCode(unionIssues);
        if (stableCode) return stableCode;
      }
    }
  }
  return undefined;
}

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
        const stableCode = findStableNoteBodyCode(error.issues);
        next(ErrorHandler.createValidationError('数据验证失败', {
          errors,
          ...(stableCode ? { code: stableCode } : {}),
        }));
      } else {
        next(error);
      }
    }
  };
};
