import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseDemoConfig, type DemoConfig } from '@zama-demo/kit';
import { setFhevmRuntimeConfig } from '@fhevm/sdk/solana';
import { env, paths } from './env.js';
import { loadAppKeys, type AppKeys } from './keys.js';
import { startValidator, wipeLedger, type ValidatorHandle } from './validator.js';
import { bootstrapHost, fundAddress } from './bootstrap.js';
import { seedDemo } from './seed.js';
import { airdropSol, mintTestUsdc } from './faucet.js';
import { startKeeper } from './keeper.js';
import { clearActivity, listActivity } from './activity.js';

setFhevmRuntimeConfig({ auth: { type: 'ApiKeyHeader', value: 'local' }, singleThread: true });

type AppState = {
  keys: AppKeys;
  validator: ValidatorHandle;
  config: DemoConfig | null;
  ready: boolean;
  resetting: boolean;
  lastError: string | null;
  stopKeeper: () => void;
};

const publicOrigin = (request?: Request): string => {
  if (env.publicUrl) return env.publicUrl.replace(/\/$/, '');
  if (request) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') ?? 'http';
    if (host) return `${proto}://${host}`;
  }
  return `http://127.0.0.1:${env.port}`;
};

const publicRpc = (request?: Request) => `${publicOrigin(request)}/rpc`;
const publicWs = (request?: Request) => {
  const origin = publicOrigin(request);
  return `${origin.startsWith('https') ? 'wss' : 'ws'}://${origin.replace(/^https?:\/\//, '')}/rpc-ws`;
};

const rewriteConfigUrls = (config: DemoConfig, request?: Request): DemoConfig =>
  parseDemoConfig({
    ...config,
    rpcUrl: publicRpc(request),
    wsUrl: publicWs(request),
    relayerUrl: `${publicOrigin(request)}/api/relayer`,
  });

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const value = await request.json();
    if (typeof value !== 'object' || value === null) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
};

const authorizeReset = (request: Request): boolean => {
  if (!env.resetToken) return true;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.resetToken}`;
};

const serveStatic = async (url: URL): Promise<Response> => {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(env.publicDir, pathname);
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  const index = Bun.file(path.join(env.publicDir, 'index.html'));
  if (await index.exists()) return new Response(index);
  return new Response('Not found', { status: 404 });
};

const proxyRpc = async (request: Request, rpcUrl: string): Promise<Response> => {
  const body = await request.text();
  const upstream = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': request.headers.get('content-type') ?? 'application/json' },
    body,
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
};

const bringUp = async (keys: AppKeys, reset: boolean): Promise<{ validator: ValidatorHandle; config: DemoConfig }> => {
  if (reset) {
    await wipeLedger();
    await rm(paths.config, { force: true });
    await rm(paths.seededFlag, { force: true });
    await clearActivity();
  }
  const validator = await startValidator({ upgradeAuthority: keys.deployer.address, reset: true });
  await fundAddress(validator.rpcUrl, keys.deployer.address, 1_000);
  await bootstrapHost(validator.rpcUrl, keys.deployer);
  const config = await seedDemo(
    validator.rpcUrl,
    validator.wsUrl,
    keys,
    `http://127.0.0.1:${env.port}/rpc`,
    `ws://127.0.0.1:${env.port}/rpc-ws`,
  );
  return { validator, config };
};

const main = async (): Promise<void> => {
  await mkdir(env.dataDir, { recursive: true });
  await mkdir(env.ledgerDir, { recursive: true });
  const keys = await loadAppKeys();
  console.log(`starting cleartext vault demo as ${process.getuid?.() === 0 ? 'root' : 'user'}`);
  console.log(`data dir ${env.dataDir}; ledger ${env.ledgerDir}`);

  const { validator, config } = await bringUp(keys, true);
  const state: AppState = {
    keys,
    validator,
    config,
    ready: true,
    resetting: false,
    lastError: null,
    stopKeeper: () => undefined,
  };
  state.stopKeeper = startKeeper(() => state.config, keys);

  const handleApi = async (request: Request, url: URL): Promise<Response> => {
    if (url.pathname === '/health') {
      let validatorHealth = 'down';
      try {
        const response = await fetch(state.validator.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        });
        const body = (await response.json()) as { result?: string };
        validatorHealth = body.result === 'ok' ? 'ok' : 'down';
      } catch {
        validatorHealth = 'down';
      }
      return json({
        ok: state.ready && validatorHealth === 'ok' && !state.resetting,
        validator: validatorHealth,
        seeded: state.config !== null,
        resetting: state.resetting,
        error: state.lastError,
      });
    }

    if (url.pathname === '/rpc' && request.method === 'POST') {
      return proxyRpc(request, state.validator.rpcUrl);
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      if (!state.config) return json({ error: 'Demo is still seeding' }, 503);
      return json({ config: rewriteConfigUrls(state.config, request) });
    }

    if (url.pathname === '/api/activity' && request.method === 'GET') {
      return json({ events: await listActivity() });
    }

    if (url.pathname === '/api/faucet/sol' && request.method === 'POST') {
      const body = await readJson(request);
      await airdropSol(String(body.address ?? ''), Number(body.sol ?? 1));
      return json({ ok: true });
    }

    if (url.pathname === '/api/faucet/usdc' && request.method === 'POST') {
      if (!state.config) return json({ error: 'Demo is still seeding' }, 503);
      const body = await readJson(request);
      const signature = await mintTestUsdc(state.config, keys, String(body.address ?? ''), Number(body.amount ?? 1000));
      return json({ ok: true, signature });
    }

    if (url.pathname === '/api/faucet' && request.method === 'POST') {
      if (!state.config) return json({ error: 'Demo is still seeding' }, 503);
      const body = await readJson(request);
      const recipient = String(body.address ?? '');
      await airdropSol(recipient, Number(body.sol ?? 1));
      const signature = await mintTestUsdc(state.config, keys, recipient, Number(body.amount ?? 1000));
      return json({ ok: true, signature });
    }

    if (url.pathname === '/api/reset' && request.method === 'POST') {
      if (!authorizeReset(request)) return json({ error: 'Unauthorized' }, 401);
      if (state.resetting) return json({ error: 'A reset is already running' }, 409);
      state.resetting = true;
      state.ready = false;
      state.stopKeeper();
      try {
        await state.validator.stop();
        const next = await bringUp(keys, true);
        state.validator = next.validator;
        state.config = next.config;
        state.stopKeeper = startKeeper(() => state.config, keys);
        state.lastError = null;
        state.ready = true;
        return json({ ok: true, bootId: next.config.demoBootId });
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        return json({ error: state.lastError }, 500);
      } finally {
        state.resetting = false;
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    return serveStatic(url);
  };

  Bun.serve({
    port: env.port,
    hostname: '0.0.0.0',
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/rpc-ws') {
        if (server.upgrade(request, { data: { queue: [] as (string | Buffer)[] } })) return undefined as never;
        return new Response('Expected WebSocket', { status: 426 });
      }
      try {
        return await handleApi(request, url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return json({ error: message }, 500);
      }
    },
    websocket: {
      open(ws) {
        const upstream = new WebSocket(state.validator.wsUrl);
        (ws.data as { upstream?: WebSocket; queue: (string | Buffer)[] }).upstream = upstream;
        upstream.addEventListener('open', () => {
          const data = ws.data as { queue: (string | Buffer)[] };
          for (const message of data.queue) upstream.send(message);
          data.queue.length = 0;
        });
        upstream.addEventListener('message', (event) => {
          ws.send(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer));
        });
        upstream.addEventListener('close', () => ws.close());
        upstream.addEventListener('error', () => ws.close());
      },
      message(ws, message) {
        const data = ws.data as { upstream?: WebSocket; queue: (string | Buffer)[] };
        const payload = typeof message === 'string' ? message : Buffer.from(message);
        if (data.upstream && data.upstream.readyState === WebSocket.OPEN) data.upstream.send(payload);
        else data.queue.push(payload);
      },
      close(ws) {
        (ws.data as { upstream?: WebSocket }).upstream?.close();
      },
    },
  });

  console.log(`demo API listening on :${env.port}`);
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
