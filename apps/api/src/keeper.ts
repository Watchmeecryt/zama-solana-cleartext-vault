import { address } from '@solana/kit';
import {
  BatchStatus,
  claimBatchPayout,
  dispatchVaultBatch,
  getBatchJoinRecords,
  getCurrentBatch,
  harvestDemoVault,
  parseDemoConfig,
  prepareNextBatch,
  readDemoVaultMetrics,
  settleOrCancelVaultBatch,
  vaultRoots,
  type DemoConfig,
  type DemoOperatorSession,
  type VaultDirection,
} from '@zama-demo/kit';
import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import { fetchSysvarClock } from '@solana/sysvars';
import { dispatchableAt, getBatcher } from '@zama-demo/kit';
import { recordActivity } from './activity.js';
import { mintTestUsdc } from './faucet.js';
import type { AppKeys } from './keys.js';
import { env } from './env.js';
import { validatorRpcUrl, validatorWsUrl } from './validator.js';

const DIRECTIONS: readonly VaultDirection[] = ['deposit', 'redeem'];

const withInternalRpc = (config: DemoConfig): DemoConfig =>
  parseDemoConfig({
    ...config,
    rpcUrl: validatorRpcUrl(),
    wsUrl: validatorWsUrl(),
  });

export const runKeeperPass = async (config: DemoConfig, keys: AppKeys): Promise<void> => {
  const session: DemoOperatorSession = { config: withInternalRpc(config), keeper: keys.keeper };
  const rpc = createFinalizedRpc(session.config.rpcUrl);

  for (const direction of DIRECTIONS) {
    const roots = vaultRoots(session.config, direction);
    const current = await getCurrentBatch(rpc, roots);
    const position = { batchIndex: current.index, batch: current.addresses.batch };

    if (current.state.status === BatchStatus.Pending) {
      const batcher = await getBatcher(rpc, roots.batcher);
      const { unixTimestamp } = await fetchSysvarClock(rpc);
      const ready = unixTimestamp >= dispatchableAt(current.state, batcher);
      const joins = await getBatchJoinRecords(rpc, current.addresses.batch);
      if (ready && joins.length > 0) {
        const signature = await dispatchVaultBatch(session, position, direction);
        if (signature) await recordActivity(`Dispatch ${direction} batch ${current.index}`, signature);
      }
      continue;
    }

    if (current.state.status === BatchStatus.Dispatched || current.state.status === BatchStatus.Refunding) {
      const signature = await settleOrCancelVaultBatch(session, position, direction);
      if (signature) await recordActivity(`Settle or refund ${direction} batch ${current.index}`, signature);
    }

    const after = await getCurrentBatch(rpc, roots);
    if (after.state.status === BatchStatus.Settled) {
      for (const { user } of await getBatchJoinRecords(rpc, after.addresses.batch)) {
        try {
          const signature = await claimBatchPayout(session, position, direction, address(user));
          if (signature) await recordActivity(`Claim ${direction} payout for ${user}`, signature);
        } catch (error) {
          console.warn(`claim ${user} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (
      after.state.status === BatchStatus.Settled ||
      after.state.status === BatchStatus.Canceled ||
      after.state.status === BatchStatus.Refunding
    ) {
      const remaining = await getBatchJoinRecords(rpc, after.addresses.batch);
      const stillOpen =
        after.state.status === BatchStatus.Refunding && remaining.length > 0;
      if (!stillOpen) {
        const next = await prepareNextBatch(session.config, keys.keeper, direction);
        await recordActivity(`Open ${direction} batch ${next.batchIndex}`, next.batch);
      }
    }
  }
};

export const maybeHarvest = async (config: DemoConfig, keys: AppKeys): Promise<void> => {
  const live = withInternalRpc(config);
  const metrics = await readDemoVaultMetrics(live);
  if (metrics.totalShares === 0n) return;
  await harvestDemoVault(live, keys.keeper, async (recipient, baseUnits) =>
    mintTestUsdc(live, keys, recipient, Number(baseUnits) / 1_000_000),
  );
  await recordActivity('Harvest vault yield', 'harvest');
};

export const startKeeper = (readConfig: () => DemoConfig | null, keys: AppKeys): (() => void) => {
  let stopped = false;
  let lastHarvest = 0;
  const tick = async () => {
    if (stopped) return;
    const config = readConfig();
    if (!config) return;
    try {
      await runKeeperPass(config, keys);
      if (Date.now() - lastHarvest >= env.harvestIntervalMs) {
        await maybeHarvest(config, keys);
        lastHarvest = Date.now();
      }
    } catch (error) {
      console.warn(`keeper pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const timer = setInterval(() => void tick(), env.keeperIntervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
