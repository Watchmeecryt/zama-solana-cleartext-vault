import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createKeyPairSignerFromBytes, type TransactionSigner } from '@solana/kit';
import { paths } from './env.js';

const generateExtractableKeypair = async (): Promise<Uint8Array> => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const bytes = new Uint8Array(64);
  bytes.set(pkcs8.subarray(pkcs8.length - 32), 0);
  bytes.set(publicKey, 32);
  return bytes;
};

const loadOrCreate = async (filePath: string): Promise<TransactionSigner> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const bytes = Uint8Array.from(JSON.parse(await readFile(filePath, 'utf8')) as number[]);
    return createKeyPairSignerFromBytes(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const bytes = await generateExtractableKeypair();
    await writeFile(filePath, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
    return createKeyPairSignerFromBytes(bytes);
  }
};

export type AppKeys = {
  readonly deployer: TransactionSigner;
  readonly keeper: TransactionSigner;
  readonly mintAuthority: TransactionSigner;
};

export const loadAppKeys = async (): Promise<AppKeys> => ({
  deployer: await loadOrCreate(paths.deployer),
  keeper: await loadOrCreate(paths.keeper),
  mintAuthority: await loadOrCreate(paths.mintAuthority),
});
