import { prepareTransientStore } from '@fhevm/sdk/solana';
import type { Address, TransactionSigner } from '@solana/kit';
import {
  getReclaimBatchAuthorityInstructionAsync,
  getBatchByIndex,
  getBatcher,
  getCurrentBatch,
  openBatchForBatcher,
  readHostPolicy,
} from './vault.js';
import { BatchStatus, isBatchFinished, type VaultDirection } from './batchTypes.js';
import { createDemoClient } from '../../../vendor/fhevm/solana/demo-dapp/src/demoClient.js';
import type { DemoConfig } from './config.js';
import { vaultRoots } from './vaultRoots.js';

export const RECLAIM_SCAN_WINDOW = 8n;

export const reclaimFinishedBatchAuthorities = async (
  config: DemoConfig,
  keeper: TransactionSigner,
  direction: VaultDirection,
): Promise<number> => {
  const client = createDemoClient(config, keeper);
  const { rpc } = client;
  const roots = vaultRoots(config, direction);
  const batcher = await getBatcher(rpc, roots.batcher);
  let reclaimed = 0;
  const first = batcher.nextBatchIndex > RECLAIM_SCAN_WINDOW ? batcher.nextBatchIndex - RECLAIM_SCAN_WINDOW : 0n;
  for (let index = first; index < batcher.nextBatchIndex; index += 1n) {
    try {
      const batch = await getBatchByIndex(rpc, roots, index);
      if (!isBatchFinished(batch.state.status)) continue;
      const { value: lamports } = await rpc.getBalance(batch.addresses.batchAuthority).send();
      if (lamports === 0n) continue;
      await client.sendTransaction([
        await getReclaimBatchAuthorityInstructionAsync({
          authority: keeper,
          batcher: roots.batcher,
          batch: batch.addresses.batch,
          batchAuthority: batch.addresses.batchAuthority,
          joinConfidentialMint: roots.joinConfidentialMint,
        }),
      ]);
      reclaimed += 1;
    } catch (error) {
      console.warn(
        `reclaiming ${direction} batch ${index} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return reclaimed;
};

export type PreparedBatch = {
  readonly batchIndex: bigint;
  readonly batch: Address;
};

export const prepareNextBatch = async (
  config: DemoConfig,
  keeper: TransactionSigner,
  direction: VaultDirection,
): Promise<PreparedBatch> => {
  const client = createDemoClient(config, keeper);
  const { rpc } = client;
  const roots = vaultRoots(config, direction);
  const current = await getCurrentBatch(rpc, roots);
  const batchIndex = current.state.status === BatchStatus.Pending ? current.index : current.index + 1n;
  if (current.state.status !== BatchStatus.Pending) {
    const transientStore = await prepareTransientStore({ payer: keeper, host: config.programs.host });
    const openBatchInstruction = await openBatchForBatcher({
      transientStore,
      roots,
      batchIndex,
      payer: keeper,
      authorityFundingLamports: BigInt(config.authorityFundingLamports),
      host: await readHostPolicy(rpc),
    });
    await client.sendFheTransaction(transientStore, [openBatchInstruction]);
  }
  await reclaimFinishedBatchAuthorities(config, keeper, direction);
  const prepared = await getCurrentBatch(rpc, roots);
  return { batchIndex: prepared.index, batch: prepared.addresses.batch };
};
