import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { env, paths, programIds, soFiles } from './env.js';

export type ValidatorHandle = {
  readonly rpcUrl: string;
  readonly wsUrl: string;
  stop(): Promise<void>;
};

const soPath = (name: string): string => path.join(env.programsDir, name);

export const validatorRpcUrl = (): string => `http://127.0.0.1:${env.validatorRpcPort}`;
export const validatorWsUrl = (): string => `ws://127.0.0.1:${env.validatorRpcPort + 1}`;

const waitForHealth = async (rpcUrl: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`solana-test-validator exited with code ${child.exitCode}; see ${paths.validatorLog}`);
    }
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = (await response.json()) as { result?: string };
      if (body.result === 'ok') return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`solana-test-validator did not become healthy; see ${paths.validatorLog}`);
};

export const startValidator = async (options: {
  readonly upgradeAuthority: string;
  readonly reset: boolean;
}): Promise<ValidatorHandle> => {
  await mkdir(env.ledgerDir, { recursive: true });
  const args = [
    '--alpenglow',
    ...(options.reset ? ['--reset'] : []),
    '--rpc-port',
    String(env.validatorRpcPort),
    '--bind-address',
    '127.0.0.1',
    '--ledger',
    env.ledgerDir,
    '--limit-ledger-size',
    '1000000',
    '--faucet-port',
    String(env.validatorFaucetPort),
    '--gossip-port',
    String(env.validatorGossipPort),
    '--upgradeable-program',
    programIds.zamaHost,
    soPath(soFiles.zamaHostCleartext),
    options.upgradeAuthority,
    '--upgradeable-program',
    programIds.confidentialToken,
    soPath(soFiles.confidentialToken),
    options.upgradeAuthority,
    '--upgradeable-program',
    programIds.demoVault,
    soPath(soFiles.demoVault),
    options.upgradeAuthority,
    '--upgradeable-program',
    programIds.confidentialBatcher,
    soPath(soFiles.confidentialBatcher),
    options.upgradeAuthority,
  ];

  const child = spawn('solana-test-validator', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: process.env.HOME ?? '/root' },
  });
  const { createWriteStream } = await import('node:fs');
  const log = createWriteStream(paths.validatorLog, { flags: 'a' });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  const rpcUrl = validatorRpcUrl();
  try {
    await waitForHealth(rpcUrl, child);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }

  return {
    rpcUrl,
    wsUrl: validatorWsUrl(),
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 8000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
};

export const wipeLedger = async (): Promise<void> => {
  await rm(env.ledgerDir, { recursive: true, force: true });
  await mkdir(env.ledgerDir, { recursive: true });
};
