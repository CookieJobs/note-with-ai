import { AppError, ErrorType } from '../utils/errorHandler';

const WINDOW_MS = 60_000;
const requests = new Map<string, number>();

export function resetInspirationRateLimits(): void { requests.clear(); }

export function assertInspirationRequestAllowed(userId: string, ip: string, now = Date.now()): void {
  const keys = [`user:${userId}`, `ip:${ip}`];
  const retryAt = Math.max(...keys.map((key) => (requests.get(key) ?? now) + WINDOW_MS));
  if (keys.some((key) => {
    const previous = requests.get(key);
    return previous !== undefined && now < previous + WINDOW_MS;
  })) {
    throw new AppError('请求过于频繁，请稍后再试', ErrorType.VALIDATION, 429, true, { code: 'INSPIRATION_RATE_LIMITED', retryAfterSeconds: Math.ceil((retryAt - now) / 1000) });
  }
  keys.forEach((key) => requests.set(key, now));
}
