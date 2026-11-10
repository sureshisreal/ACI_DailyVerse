import type { Request, Response, NextFunction } from 'express';

// Keeps slow JSON requests alive through proxies that drop idle connections - notably GitHub
// Codespaces port forwarding, which cuts a request off after roughly 60-90s with no bytes sent.
// Tamil Indic-Parler narration on a CPU-only codespace, video encoding and Claude + image generation
// can all take longer than that.
//
// If the handler hasn't responded within INTERVAL_MS, this commits a 200 JSON response and writes a
// single space every INTERVAL_MS until res.json() is called. Leading whitespace is valid JSON, so
// clients parse the body as usual. Since the status line is then already sent, a later
// res.status(4xx/5xx).json(...) can't change it - the intended status is added to the body as
// __httpStatus instead, which services/verseApi.ts's postJson treats as an error.
//
// Only for routes that always answer with res.json (all POST /api routes); never for file responses.
const INTERVAL_MS = 15_000;

export function keepAliveJson(_req: Request, res: Response, next: NextFunction): void {
  let intendedStatus = 200;
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return clearInterval(timer);
    if (!res.headersSent) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
    }
    res.write(' ');
  }, INTERVAL_MS);
  const stop = () => clearInterval(timer);
  res.on('close', stop);
  res.on('finish', stop);

  const originalStatus = res.status.bind(res);
  res.status = ((code: number) => {
    intendedStatus = code;
    if (!res.headersSent) originalStatus(code);
    return res;
  }) as Response['status'];

  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    stop();
    if (!res.headersSent) return originalJson(body);
    const payload =
      intendedStatus >= 400 && body && typeof body === 'object' && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>), __httpStatus: intendedStatus }
        : body;
    res.end(JSON.stringify(payload));
    return res;
  }) as Response['json'];

  next();
}
