import type { Address } from '@solana/kit';
import { BatchStatus } from './vault.js';

export { BatchStatus };

export type VaultDirection = 'deposit' | 'redeem';

export const isBatchFinished = (status: BatchStatus): boolean =>
  status === BatchStatus.Settled || status === BatchStatus.Canceled || status === BatchStatus.Refunding;

export type BatchTarget = {
  readonly batchIndex: bigint;
  readonly batch: Address;
};

export type BatchPosition = BatchTarget & {
  readonly amountBaseUnits: bigint;
};

export type BatchLifecycle =
  | { readonly kind: 'awaiting-dispatch'; readonly remainingSecs: bigint }
  | { readonly kind: 'dispatched' }
  | {
      readonly kind: 'settled';
      readonly totalJoined: bigint;
      readonly payoutReceived: bigint;
      readonly claimed: boolean;
    }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'refunding'; readonly refunded: boolean };

export type VaultMetrics = {
  readonly totalAssets: bigint;
  readonly totalShares: bigint;
};
