import type { Request, RequestHandler, Response } from 'express';

export type NoteTitleRequestDeadline = {
  deadlineAt: number;
  signal: AbortSignal;
  timedOut: boolean;
  disconnected: boolean;
};

const requests = new WeakMap<Request, NoteTitleRequestDeadline>();

export function getNoteTitleRequestDeadline(req: Request): NoteTitleRequestDeadline | undefined {
  return requests.get(req);
}

/** Mount before body parsing so the title API has one clock for upload, auth, quota, and provider. */
export function beginNoteTitleRequestDeadline(deadlineMs = 30_000): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'POST' || (req.path || req.url?.split('?')[0]) !== '/api/notes/title-suggestions') return next();
    if (requests.has(req)) return next();
    const controller = new AbortController();
    const state: NoteTitleRequestDeadline = { deadlineAt: Date.now() + deadlineMs, signal: controller.signal, timedOut: false, disconnected: false };
    requests.set(req, state);
    const cleanup = () => {
      clearTimeout(timer);
      req.off('aborted', onAborted);
      res.off('close', onClose);
      res.off('finish', cleanup);
    };
    const onAborted = () => { state.disconnected = true; controller.abort(); cleanup(); };
    const onClose = () => {
      if (!res.writableFinished) { state.disconnected = true; controller.abort(); }
      cleanup();
    };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
      if (!res.headersSent && !res.destroyed && !res.writableEnded) {
        const payload = { success: false, error: 'NOTE_TITLE_GENERATION_TIMEOUT', message: 'NOTE_TITLE_GENERATION_TIMEOUT', type: 'EXTERNAL_API_ERROR', code: 'NOTE_TITLE_GENERATION_TIMEOUT' };
        if (typeof res.status === 'function' && typeof res.json === 'function') res.status(504).json(payload);
        else {
          res.statusCode = 504;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        }
      }
    }, deadlineMs);
    req.on('aborted', onAborted);
    res.on('close', onClose);
    res.on('finish', cleanup);
    next();
  };
}

/** Stop a parser that finishes after the title deadline from entering authentication. */
export function stopExpiredNoteTitleRequest(req: Request, res: Response, next: () => void): void {
  const state = requests.get(req);
  if (state && (state.timedOut || state.disconnected || res.writableEnded || res.destroyed)) return;
  next();
}
