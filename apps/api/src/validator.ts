import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, paths, programIds, soFiles } from './env.js';

export type ValidatorHandle = {
  readonly rpcUrl: string;
  readonly wsUrl: string;
  stop(): Promise<void>;
};

const soPath = (name: string): string => path.join(env.programsDir, name);

const PROGRAM_FILES = [
  soFiles.zamaHostCleartext,
  soFiles.confidentialToken,
  soFiles.demoVault,
  soFiles.confidentialBatcher,
] as const;

export const validatorRpcUrl = (): string => `http://127.0.0.1:${env.validatorRpcPort}`;
export const validatorWsUrl = (): string => `ws://127.0.0.1:${env.validatorRpcPort + 1}`;

const genesisFingerprint = (): string =>
  JSON.stringify({
    programs: programIds,
    files: PROGRAM_FILES,
    alpenglow: true,
    chainId: env.chainId.toString(),
  });

const writeIfOpen = (dest: NodeJS.WritableStream, chunk: string): void => {
  const ended = 'writableEnded' in dest && Boolean((dest as WriteStream).writableEnded);
  if (!dest.writable || dest.destroyed || ended) return;
  try {
    dest.write(chunk);
  } catch {
    // Destination closed between the check and the write (container shutdown).
  }
};

const attachPrefixedTee = (
  source: NodeJS.ReadableStream | null | undefined,
  file: WriteStream,
  consoleDest: NodeJS.WritableStream,
  prefix: string,
): void => {
  if (!source) return;
  let leftover = '';
  const flush = (text: string, trailingNewline: boolean) => {
    const payload = trailingNewline ? `${prefix}${text}\n` : `${prefix}${text}`;
    writeIfOpen(file, payload);
    writeIfOpen(consoleDest, payload);
  };
  source.on('data', (buf: Buffer | string) => {
    const text = leftover + buf.toString('utf8');
    const lines = text.split('\n');
    leftover = lines.pop() ?? '';
    for (const line of lines) flush(line, true);
  });
  source.on('end', () => {
    if (leftover) {
      flush(leftover, true);
      leftover = '';
    }
  });
};

const dumpValidatorLogTail = async (reason: string): Promise<void> => {
  console.error(`[validator] process ended (${reason}); last 100 lines of ${paths.validatorLog}:`);
  try {
    const text = await readFile(paths.validatorLog, 'utf8');
    const lines = text.split('\n').filter((line) => line.length > 0);
    const tail = lines.slice(-100);
    for (const line of tail) console.error(line);
    if (tail.length === 0) console.error('[validator] log file is empty');
  } catch (error) {
    console.error(`[validator] could not read ${paths.validatorLog}: ${error}`);
  }
};

const readHostDiagnostics = async (): Promise<void> => {
  let nofile = 'unknown';
  let avx2 = 'unknown';
  try {
    const limits = await readFile('/proc/self/limits', 'utf8');
    const match = limits.match(/Max open files\s+(\S+)\s+(\S+)/);
    if (match) nofile = `soft=${match[1]} hard=${match[2]}`;
  } catch {
    // non-Linux
  }
  try {
    const cpuinfo = await readFile('/proc/cpuinfo', 'utf8');
    avx2 = /\bavx2\b/.test(cpuinfo) ? 'yes' : 'no';
  } catch {
    // non-Linux
  }
  console.log(`host diagnostics: nofile ${nofile}; avx2 ${avx2}; arch ${process.arch}`);
  if (avx2 === 'no') {
    console.error(
      'CPU has no AVX2. Official Agave linux/amd64 binaries need AVX2 and will SIGILL on this host. That is a platform limit, not a flag we can work around.',
    );
  }
};

const assertProgramsExist = async (): Promise<void> => {
  for (const name of PROGRAM_FILES) {
    const filePath = soPath(name);
    try {
      await access(filePath);
    } catch {
      throw new Error(`missing program artifact ${filePath}`);
    }
    console.log(`program ok ${filePath}`);
  }
};

const maybeWipeStaleLedger = async (): Promise<void> => {
  let previous: string | null = null;
  try {
    previous = await readFile(paths.genesisStamp, 'utf8');
  } catch {
    previous = null;
  }
  const next = genesisFingerprint();
  if (previous !== null && previous !== next) {
    console.log('genesis fingerprint changed; wiping ledger');
    await wipeLedger();
  }
};

const waitForHealth = async (rpcUrl: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const reason =
        child.signalCode !== null
          ? `signal ${child.signalCode}`
          : `code ${child.exitCode}`;
      await dumpValidatorLogTail(reason);
      throw new Error(`solana-test-validator exited with ${reason}`);
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
  await dumpValidatorLogTail('health timeout');
  throw new Error(`solana-test-validator did not become healthy; see ${paths.validatorLog}`);
};

export const startValidator = async (options: {
  readonly upgradeAuthority: string;
  readonly reset: boolean;
}): Promise<ValidatorHandle> => {
  await mkdir(env.ledgerDir, { recursive: true });
  await mkdir(path.dirname(paths.validatorLog), { recursive: true });
  await readHostDiagnostics();
  await assertProgramsExist();
  if (options.reset) await wipeLedger();
  else await maybeWipeStaleLedger();

  // Agave 4.3 test-validator flags only. --gossip-host and --no-port-check are
  // production-validator flags and would clap-exit 1 here.
  const args = [
    '--log',
    '--alpenglow',
    ...(options.reset ? ['--reset'] : []),
    '--rpc-port',
    String(env.validatorRpcPort),
    '--bind-address',
    '127.0.0.1',
    '--advertised-ip',
    '127.0.0.1',
    '--ledger',
    env.ledgerDir,
    '--limit-blockstore-size',
    '1000000',
    '--faucet-port',
    String(env.validatorFaucetPort),
    '--gossip-port',
    String(env.validatorGossipPort),
    '--dynamic-port-range',
    '8020-8050',
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

  const command = `solana-test-validator ${args.join(' ')}`;
  console.log(`validator cwd=${process.cwd()} PATH=${process.env.PATH}`);
  console.log(`validator command: ${command}`);

  const log = createWriteStream(paths.validatorLog, { flags: 'a' });
  writeIfOpen(log, `\n--- ${new Date().toISOString()} ${command}\n`);

  const child = spawn('solana-test-validator', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: process.env.HOME ?? '/root', RUST_LOG: process.env.RUST_LOG ?? 'info' },
  });

  // Never pipe both stdout and stderr onto one WriteStream with the default
  // { end: true }: the first close ends the file and the second write throws
  // ERR_STREAM_WRITE_AFTER_END.
  attachPrefixedTee(child.stdout, log, process.stdout, '[validator] ');
  attachPrefixedTee(child.stderr, log, process.stderr, '[validator] ');

  child.on('error', (error) => {
    writeIfOpen(process.stderr, `[validator] spawn error: ${error}\n`);
  });
  child.once('close', (code, signal) => {
    writeIfOpen(log, `[validator] closed code=${code} signal=${signal}\n`);
    if (!log.destroyed && !log.writableEnded) log.end();
  });

  const rpcUrl = validatorRpcUrl();
  try {
    await waitForHealth(rpcUrl, child);
    await writeFile(paths.genesisStamp, genesisFingerprint());
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    throw error;
  }

  return {
    rpcUrl,
    wsUrl: validatorWsUrl(),
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
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
