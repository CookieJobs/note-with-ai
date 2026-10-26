import type { Request, Response } from 'express';
import { AppError, ErrorType, ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { noteTitleSuggestionService, TitleSuggestionError } from '../services/noteTitleSuggestionService';
import { getNoteTitleRequestDeadline } from '../middleware/noteTitleRequestDeadline';

export async function suggestNoteTitle(req: Request, res: Response): Promise<void> {
  const requestDeadline = getNoteTitleRequestDeadline(req);
  if (requestDeadline?.signal.aborted || res.writableEnded) return;
  const user = await UserValidator.authenticateUser(req);
  if (requestDeadline?.signal.aborted || (requestDeadline && Date.now() >= requestDeadline.deadlineAt) || res.writableEnded) return;
  const aborter = new AbortController();
  const abort = () => aborter.abort();
  requestDeadline?.signal.addEventListener('abort', abort, { once: true });
  req.on('aborted', abort);
  res.on('close', () => { if (!res.writableFinished) abort(); });
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['body', 'clientRequestId'].includes(key))) {
      throw new TitleSuggestionError('NOTE_TITLE_INPUT_INVALID', 400);
    }
    const data = await noteTitleSuggestionService.suggest({ userId: user._id.toString(), body: payload.body, clientRequestId: payload.clientRequestId, signal: aborter.signal, deadlineAt: requestDeadline?.deadlineAt });
    if (aborter.signal.aborted || (requestDeadline && Date.now() >= requestDeadline.deadlineAt) || res.writableEnded) return;
    ResponseHandler.success(res, data);
  } catch (caught) {
    if (requestDeadline?.signal.aborted || res.writableEnded || res.destroyed) return;
    if (caught instanceof TitleSuggestionError) {
      const type = caught.statusCode < 500 ? ErrorType.VALIDATION : ErrorType.EXTERNAL_API;
      throw new AppError(caught.code, type, caught.statusCode, true, { code: caught.code, ...(caught.retryAfterSeconds ? { retryAfterSeconds: caught.retryAfterSeconds } : {}) });
    }
    throw caught;
  } finally {
    req.off('aborted', abort);
    requestDeadline?.signal.removeEventListener('abort', abort);
  }
}
