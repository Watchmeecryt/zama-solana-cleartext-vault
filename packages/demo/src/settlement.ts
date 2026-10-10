import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { Bytes32Hex } from '@fhevm/sdk/types';
import type { Address, Signature, TransactionSigner } from '@solana/kit';
import {
  createFhevmCleartextPublicDecryptClient,
  createSolanaLeafRecord,
} from '@fhevm/sdk/solana/cleartext';
import {
  defineFhevmSolanaChain,
  prepareTransientStore,
  setFhevmRuntimeConfig,
  solanaHostProgram,
} from '@fhevm/sdk/solana';
import {
  buildCancelDispatchInstruction,
  buildDispatchBatchInstruction,
  buildQuitInstruction,
  dispatchableAt,
  getBatchJoinRecords,
  getReclaimBatchAuthorityInstructionAsync,
  findJoinRecordPda,
  getBatchByIndex,
  getBatcher,
  getJoinRecord,
  getCloseJoinRecordInstructionAsync,
  readHostPolicy,
  settleBatch,
  settleDeadline,
  type VaultDemoRoots,
} from './vault.js';

import { BatchStatus, type BatchLifecycle, type BatchTarget, type VaultDirection } from './batchTypes.js';
import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import { fetchSysvarClock } from '@solana/sysvars';
import type { DemoConfig } from './config.js';
import { createDemoClient } from '../../../vendor/fhevm/solana/demo-dapp/src/demoClient.js';
import { vaultRoots } from './vaultRoots.js';

export type DemoOperatorSession = {
  readonly config: DemoConfig;
  readonly keeper: TransactionSigner;
};

type DemoUserSession = {
  readonly config: DemoConfig;
  readonly signer: TransactionSigner;
};

const currentPinnedBatch = async (
  session: { readonly config: DemoConfig },
  position: BatchTarget,
  direction: VaultDirection,
) => {
  const rpc = createFinalizedRpc(session.config.rpcUrl);
  const batch = await getBatchByIndex(rpc, vaultRoots(session.config, direction), position.batchIndex);
  if (batch.index !== position.batchIndex || batch.addresses.batch !== position.batch) {
    throw new Error(`Batch reference ${position.batch} does not match index ${position.batchIndex}`);
  }
  return { rpc, batch };
};

const userJoinRecord = async (rpc: ReturnType<typeof createFinalizedRpc>, batch: Address, user: Address) => {
  const address = (await findJoinRecordPda({ batch, user }))[0];
  const exists = (await rpc.getAccountInfo(address, { encoding: 'base64' }).send()).value !== null;
  return { address, state: exists ? await getJoinRecord(rpc, address) : null };
};

export const readVaultLifecycle = async (
  session: DemoUserSession,
  position: BatchTarget,
  direction: VaultDirection,
): Promise<BatchLifecycle> => {
  const { rpc, batch } = await currentPinnedBatch(session, position, direction);
  if (batch.state.status === BatchStatus.Pending) {
    const batcher = await getBatcher(rpc, vaultRoots(session.config, direction).batcher);
    const { unixTimestamp } = await fetchSysvarClock(rpc);
    const from = dispatchableAt(batch.state, batcher);
    return {
      kind: 'awaiting-dispatch',
      remainingSecs: unixTimestamp >= from ? 0n : from - unixTimestamp,
    };
  }
  if (batch.state.status === BatchStatus.Dispatched) return { kind: 'dispatched' };
  if (batch.state.status === BatchStatus.Settled) {
    const joinRecord = (await userJoinRecord(rpc, position.batch, session.signer.address)).state;
    return {
      kind: 'settled',
      totalJoined: batch.state.totalJoined,
      payoutReceived: batch.state.payoutReceived,
      claimed: joinRecord === null || joinRecord.claimed,
    };
  }
  if (batch.state.status === BatchStatus.Canceled) return { kind: 'canceled' };
  if (batch.state.status === BatchStatus.Refunding) {
    const joinRecord = (await userJoinRecord(rpc, position.batch, session.signer.address)).state;
    return { kind: 'refunding', refunded: joinRecord === null };
  }
  throw new Error(`Unsupported batch status ${batch.state.status}`);
};

export const dispatchVaultBatch = async (
  session: DemoOperatorSession,
  position: BatchTarget,
  direction: VaultDirection,
): Promise<Signature | null> => {
  const roots = vaultRoots(session.config, direction);
  const { rpc, batch } = await currentPinnedBatch(session, position, direction);
  if (batch.state.status >= BatchStatus.Dispatched) return null;
  const batcher = await getBatcher(rpc, roots.batcher);
  if ((await fetchSysvarClock(rpc)).unixTimestamp < dispatchableAt(batch.state, batcher)) {
    throw new Error('The batch is not old enough to dispatch yet');
  }
  const transientStore = await prepareTransientStore({ payer: session.keeper, host: session.config.programs.host });
  const dispatch = await buildDispatchBatchInstruction({
    transientStore,
    payer: session.keeper,
    batcher: roots.batcher,
    batch: position.batch,
    joinConfidentialMint: roots.joinConfidentialMint,
    joinUnderlyingMint: roots.joinUnderlyingMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    host: await readHostPolicy(rpc),
  });
  return (await createDemoClient(session.config, session.keeper).sendFheTransaction(transientStore, [dispatch])).context
    .signature;
};

const refundParticipants = async (
  session: DemoOperatorSession,
  roots: VaultDemoRoots,
  batch: Address,
): Promise<Signature | null> => {
  const keeperClient = createDemoClient(session.config, session.keeper);
  const host = await readHostPolicy(keeperClient.rpc);
  let signature: Signature | null = null;
  const failed: Address[] = [];
  for (const { user } of await getBatchJoinRecords(keeperClient.rpc, batch)) {
    try {
      const transientStore = await prepareTransientStore({ payer: session.keeper, host: session.config.programs.host });
      const quit = await buildQuitInstruction({
        transientStore,
        user,
        payer: session.keeper,
        batcher: roots.batcher,
        batch,
        joinConfidentialMint: roots.joinConfidentialMint,
        joinUnderlyingMint: roots.joinUnderlyingMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        host,
      });
      signature = (await keeperClient.sendFheTransaction(transientStore, [quit])).context.signature;
    } catch (error) {
      console.warn(`refunding ${user} failed: ${error instanceof Error ? error.message : String(error)}`);
      failed.push(user);
    }
  }
  if (failed.length > 0) throw new Error(`Refunds failed for ${failed.join(', ')}; a rerun retries them`);
  return signature;
};

export const settleOrCancelVaultBatch = async (
  session: DemoOperatorSession,
  position: BatchTarget,
  direction: VaultDirection,
): Promise<Signature | null> => {
  const roots = vaultRoots(session.config, direction);
  const { rpc, batch } = await currentPinnedBatch(session, position, direction);
  let status = batch.state.status;
  if (status === BatchStatus.Settled || status === BatchStatus.Canceled) return null;
  if (status !== BatchStatus.Dispatched && status !== BatchStatus.Refunding) {
    throw new Error('Dispatch the batch before settlement');
  }

  let signature: Signature | null = null;
  if (status === BatchStatus.Dispatched) {
    const keeperClient = createDemoClient(session.config, session.keeper);
    const batcher = await getBatcher(rpc, roots.batcher);
    if ((await fetchSysvarClock(rpc)).unixTimestamp >= settleDeadline(batch.state, batcher)) {
      const transientStore = await prepareTransientStore({ payer: session.keeper, host: session.config.programs.host });
      const cancel = await buildCancelDispatchInstruction({
        transientStore,
        payer: session.keeper,
        batcher: roots.batcher,
        batch: position.batch,
        joinConfidentialMint: roots.joinConfidentialMint,
        authorityFundingLamports: BigInt(session.config.authorityFundingLamports),
        host: await readHostPolicy(rpc),
      });
      signature = (await keeperClient.sendFheTransaction(transientStore, [cancel])).context.signature;
    } else {
      setFhevmRuntimeConfig({
        auth: { type: 'ApiKeyHeader', value: 'local' },
        singleThread: true,
      });
      const chain = defineFhevmSolanaChain({
        id: BigInt(session.config.chainId),
        fhevm: {
          relayerUrl: session.config.relayerUrl,
          programs: { host: { address: session.config.aclProgram as Bytes32Hex } },
        },
      });
      const readMerkleProofs = createSolanaLeafRecord(rpc, solanaHostProgram(chain));
      const publicDecryptClient = createFhevmCleartextPublicDecryptClient({ chain, rpc, readMerkleProofs });
      signature = await settleBatch(publicDecryptClient, keeperClient, {
        roots,
        batchIndex: position.batchIndex,
        authorityFundingLamports: BigInt(session.config.authorityFundingLamports),
        certificateOptions: { timeout: 60_000 },
        host: await readHostPolicy(rpc),
      });
      try {
        await keeperClient.sendTransaction([
          await getReclaimBatchAuthorityInstructionAsync({
            authority: session.keeper,
            batcher: roots.batcher,
            batch: batch.addresses.batch,
            batchAuthority: batch.addresses.batchAuthority,
            joinConfidentialMint: roots.joinConfidentialMint,
          }),
        ]);
      } catch (error) {
        console.warn(
          `settled, but reclaiming the batch authority failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    status = (await currentPinnedBatch(session, position, direction)).batch.state.status;
  }
  if (status === BatchStatus.Refunding) return (await refundParticipants(session, roots, position.batch)) ?? signature;
  return signature;
};

export const closeSpentJoinRecord = async (session: DemoUserSession, position: BatchTarget): Promise<void> => {
  const rpc = createFinalizedRpc(session.config.rpcUrl);
  const { address, state } = await userJoinRecord(rpc, position.batch, session.signer.address);
  if (state === null) return;
  await createDemoClient(session.config, session.signer).sendTransaction([
    await getCloseJoinRecordInstructionAsync({ user: session.signer, batch: position.batch, joinRecord: address }),
  ]);
};
