/**
 * Peter's finding (b): an Astro render error (a page throwing) reaches pino as ONE error
 * line with type, message and stack, and the client gets a plain 500 without detail.
 */
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(
  () => [] as { level: string; event: string; fields?: Record<string, unknown> }[],
);

vi.mock('../../src/server/logging/logger', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/logging/logger')>();
  const at = (level: string) => (event: string, _msg: string, fields?: Record<string, unknown>) =>
    calls.push({ level, event, fields });
  const log = {
    fatal: at('fatal'),
    error: at('error'),
    warn: at('warn'),
    info: at('info'),
    debug: at('debug'),
    trace: at('trace'),
    child: () => log,
    isLevelEnabled: () => true,
  };
  return { ...real, requestLog: () => log };
});

const { handleRequest } = await import('../../src/server/middleware/pipeline');

const context = () => ({
  request: new Request('http://127.0.0.1:4321/activity', { headers: { host: '127.0.0.1:4321' } }),
  url: new URL('http://127.0.0.1:4321/activity'),
  locals: {} as App.Locals,
  clientAddress: '127.0.0.1',
  routePattern: '/activity',
});

describe('a page that throws while rendering', () => {
  it('is logged once with its error, and answered with a plain 500', async () => {
    calls.length = 0;
    const boom = new TypeError('probe render failure');
    const response = await handleRequest(context(), () => Promise.reject(boom), {
      rethrowRenderErrors: false,
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('Something went wrong');
    expect(body).not.toContain('probe render failure');
    // The security headers and request id still apply.
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-request-id')).toBeTruthy();

    const errors = calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      event: 'request.failed',
      fields: { route: '/activity', status: 500, err: boom },
    });
    // The pino err serializer turns this into type, message and stack.
    expect((errors[0]?.fields?.err as Error).stack).toContain('probe render failure');
    expect(calls.filter((c) => c.event === 'request.completed')).toMatchObject([
      { level: 'info', fields: { status: 500 } },
    ]);
  });

  it('is rethrown under astro dev, so the error overlay still works', async () => {
    const boom = new Error('dev overlay');
    await expect(
      handleRequest(context(), () => Promise.reject(boom), { rethrowRenderErrors: true }),
    ).rejects.toBe(boom);
  });

  it('leaves a successful page alone', async () => {
    const response = await handleRequest(context(), async () => new Response('ok'), {
      rethrowRenderErrors: false,
    });
    expect(await response.text()).toBe('ok');
  });
});
