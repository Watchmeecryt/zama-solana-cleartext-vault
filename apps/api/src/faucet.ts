import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS as SPL_TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token';
import { address, type Address } from '@solana/kit';
import { createDemoClient, type DemoConfig } from '@zama-demo/kit';
import { fundAddress } from './bootstrap.js';
import { recordActivity } from './activity.js';
import type { AppKeys } from './keys.js';
import { validatorRpcUrl, validatorWsUrl } from './validator.js';

const MAX_SOL = 2;
const MAX_USDC = 1000;

export const airdropSol = async (recipient: string, sol: number): Promise<void> => {
  if (!Number.isFinite(sol) || sol <= 0 || sol > MAX_SOL) {
    throw new Error(`SOL amount must be between 0 and ${MAX_SOL}`);
  }
  await fundAddress(validatorRpcUrl(), recipient, sol);
  await recordActivity(`Airdrop ${sol} SOL`, recipient);
};

export const mintTestUsdc = async (config: DemoConfig, keys: AppKeys, recipient: string, amount: number): Promise<string> => {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_USDC) {
    throw new Error(`USDC amount must be between 0 and ${MAX_USDC}`);
  }
  await fundAddress(validatorRpcUrl(), keys.mintAuthority.address, 0.2);
  const mint = address(config.mints.joinUnderlying);
  const owner = address(recipient) as Address;
  const [ata] = await findAssociatedTokenPda({
    owner,
    tokenProgram: SPL_TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const client = createDemoClient({ rpcUrl: validatorRpcUrl(), wsUrl: validatorWsUrl() }, keys.mintAuthority);
  const { context } = await client.sendTransaction([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: keys.mintAuthority,
      ata,
      owner,
      mint,
    }),
    getMintToInstruction({
      mint,
      token: ata,
      mintAuthority: keys.mintAuthority,
      amount: BigInt(Math.round(amount * 1_000_000)),
    }),
  ]);
  await recordActivity(`Mint ${amount} test USDC`, context.signature);
  return context.signature;
};
