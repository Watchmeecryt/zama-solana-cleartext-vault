import { createKeyPairSignerFromBytes, type TransactionSigner } from '@solana/kit';
import { solanaPermitWalletFromSecretKey, type SolanaPermitWallet } from '@fhevm/sdk/solana';
import { createTransactionSignerFromWalletAccount } from '@solana/wallet-account-signer';
import {
  SolanaSignOffchainMessage,
  SolanaSignTransaction,
  type SolanaSignOffchainMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { getWalletAccountFeature, getWalletFeature } from '@wallet-standard/ui';
import { getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED } from '@wallet-standard/ui-registry';
import { type DemoConfig } from '@zama-demo/kit';
import { loadDemoConfig, requestFaucet } from '../lib/api.js';
import { loadOrCreateBurnerSecretKey } from './burner.js';

export type AppSession = {
  readonly config: DemoConfig;
  readonly signer: TransactionSigner;
  readonly permitWallet: SolanaPermitWallet | undefined;
  readonly wallet:
    | { readonly kind: 'burner'; readonly name: 'Built-in wallet' }
    | { readonly kind: 'wallet-standard'; readonly name: string };
};

const permitWalletFromWalletAccount = (account: UiWalletAccount): SolanaPermitWallet | undefined => {
  if (!account.features.includes(SolanaSignOffchainMessage)) return undefined;
  const feature = getWalletAccountFeature(
    account,
    SolanaSignOffchainMessage,
  ) as SolanaSignOffchainMessageFeature[typeof SolanaSignOffchainMessage];
  const walletAccount = getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED(account);
  return { account: walletAccount, features: { [SolanaSignOffchainMessage]: feature } };
};

type SignTransactionFeature = SolanaSignTransactionFeature[typeof SolanaSignTransaction];

export const signsVersion1Transactions = (wallet: UiWallet): boolean => {
  if (!wallet.features.includes(SolanaSignTransaction)) return false;
  const feature = getWalletFeature(wallet, SolanaSignTransaction) as SignTransactionFeature;
  return feature.supportedTransactionVersions.includes(1);
};

export const connectBurnerSession = async (): Promise<AppSession> => {
  const [config, secretKey] = await Promise.all([loadDemoConfig(), loadOrCreateBurnerSecretKey(window.localStorage)]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  await requestFaucet(signer.address, 1, 1000).catch(() => undefined);
  return {
    config,
    signer,
    permitWallet: solanaPermitWalletFromSecretKey(secretKey),
    wallet: { kind: 'burner', name: 'Built-in wallet' },
  };
};

export const connectExternalSession = async (account: UiWalletAccount, walletName: string): Promise<AppSession> => {
  const config = await loadDemoConfig();
  const signer = createTransactionSignerFromWalletAccount(account, 'solana:localnet');
  return {
    config,
    signer,
    permitWallet: permitWalletFromWalletAccount(account),
    wallet: { kind: 'wallet-standard', name: walletName },
  };
};
