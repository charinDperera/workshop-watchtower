/**
 * Thomas's M1/M5: a client that aborts a large static download must not leak the file
 * descriptor, and the abort is not a server error. A real read error still is.
 */
import type { ReadStream } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from './helpers';

const streams = vi.hoisted(() => ({ opened: [] as ReadStream[], failNext: false }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    createReadStream: ((path: string) => {
      if (streams.failNext) {
        streams.failNext = false;
        const broken = new Readable({ read() {} });
        setImmediate(() =>
          broken.destroy(Object.assign(new Error('disk read failed'), { code: 'EIO' })),
        );
        return broken as unknown as ReadStream;
      }
      const stream = real.createReadStream(path);
      streams.opened.push(stream);
      return stream;
    }) as typeof real.createReadStream,
  };
});

const { createRequestListener } = await import('../../scripts/http-server.mjs');
const { createStaticHandler, isClientAbort } = await import('../../scripts/static-files.mjs');
const { createLogger } = await import('../../scripts/logger.mjs');
const { DEFAULT_POLICY } = await import('../../src/server/security/request-guard');

describe('static downloads that end early', () => {
  let server: Server;
  let port = 0;
  let client: { dir: string; cleanup: () => void };
  const logged: string[] = [];
  const events = () => logged.map((l) => (JSON.parse(l) as { event: string }).event);

  beforeAll(async () => {
    client = makeTempDir('abort-');
    mkdirSync(join(client.dir, '_astro'));
    writeFileSync(join(client.dir, '_astro', 'big.js'), Buffer.alloc(9 * 1024 * 1024, 97));
    const listener = createRequestListener({
      policy: DEFAULT_POLICY,
      serveStatic: createStaticHandler(client.dir),
      app: (_req, res) => res.end('page'),
      logger: createLogger({
        service: 'bff',
        env: 'test',
        level: 'info',
        sinks: [{ write: (line: string) => logged.push(line) }],
      }),
    });
    server = createServer(listener);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    client.cleanup();
  });

  it('destroys the file stream when the client aborts, and logs no failure', async () => {
    streams.opened.length = 0;
    logged.length = 0;
    await new Promise<void>((done) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/_astro/big.js', headers: { host: '127.0.0.1:4321' } },
        (res) => {
          res.once('data', () => {
            req.destroy();
            done();
          });
        },
      );
      req.on('error', () => {});
      req.end();
    });
    await vi.waitFor(() => expect(streams.opened[0]?.destroyed).toBe(true), { timeout: 3000 });
    expect(streams.opened).toHaveLength(1);
    // The file is closed, not just paused: its descriptor is released.
    await vi.waitFor(() => expect(streams.opened[0]?.closed).toBe(true), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(events()).not.toContain('request.failed');
    expect(events()).toContain('request.completed');
  });

  it('still reports a real read error once, as request.failed', async () => {
    logged.length = 0;
    streams.failNext = true;
    await new Promise<void>((done) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/_astro/big.js', headers: { host: '127.0.0.1:4321' } },
        (res) => {
          res.resume();
          res.on('end', done);
          res.on('error', () => done());
          res.on('close', done);
        },
      );
      req.on('error', () => done());
      req.end();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(events().filter((e) => e === 'request.failed')).toHaveLength(1);
  });

  it('tells client aborts from read errors by code', () => {
    expect(isClientAbort({ code: 'ERR_STREAM_PREMATURE_CLOSE' })).toBe(true);
    expect(isClientAbort({ code: 'ECONNRESET' })).toBe(true);
    expect(isClientAbort({ code: 'EIO' })).toBe(false);
    expect(isClientAbort(undefined)).toBe(false);
  });
});
