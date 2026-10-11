import { createKeyPairSignerFromBytes, type TransactionSigner } from '@solana/kit';
import { solanaPermitWalletFromSecretKey, type SolanaPermitWallet } from '@fhevm/sdk/solana';
import { createTransactionSignerFromWalletAccount } from '@solana/wallet-account-signer';
import {
  SolanaSignOffchainMessage,
  SolanaSignTransaction,
  type SolanaSignOffchainMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { getWalletAccountFeature, getWalletFeature } from '@wallet-standard/ui';
import {
  getOrCreateUiWalletAccountForStandardWalletAccount,
  getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  getWalletForHandle,
} from '@wallet-standard/ui-registry';
import { type DemoConfig } from '@zama-demo/kit';
import { loadDemoConfig, requestFaucet } from '../lib/api.js';
import { loadOrCreateBurnerSecretKey } from './burner.js';

export const WALLET_PREFERENCE_STORAGE_KEY = 'cleartext-vault-wallet-preference';

export type WalletPreference = 'burner' | 'none' | (string & {});

export type AppSession = {
  readonly config: DemoConfig;
  readonly signer: TransactionSigner;
  readonly permitWallet: SolanaPermitWallet | undefined;
  readonly wallet:
    | { readonly kind: 'burner'; readonly name: 'Built-in wallet' }
    | { readonly kind: 'wallet-standard'; readonly name: string };
};

const STANDARD_CONNECT = 'standard:connect' as const;
const STANDARD_DISCONNECT = 'standard:disconnect' as const;
const STANDARD_EVENTS = 'standard:events' as const;

type StandardConnectFeature = {
  readonly connect: (input?: { readonly silent?: boolean }) => Promise<{
    readonly accounts: readonly WalletAccount[];
  }>;
};

type StandardDisconnectFeature = {
  readonly disconnect: () => Promise<void>;
};

type StandardEventsFeature = {
  readonly on: (
    event: 'change',
    listener: (properties: { readonly accounts?: readonly WalletAccount[] }) => void,
  ) => () => void;
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

export const readWalletPreference = (storage: Pick<Storage, 'getItem'> = window.localStorage): WalletPreference => {
  const value = storage.getItem(WALLET_PREFERENCE_STORAGE_KEY);
  if (value === null || value === '') return 'none';
  return value;
};

export const writeWalletPreference = (
  preference: WalletPreference,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void => {
  storage.setItem(WALLET_PREFERENCE_STORAGE_KEY, preference);
};

const standardWalletOf = (wallet: UiWallet): Wallet => getWalletForHandle(wallet);

const featureOf = <T>(wallet: Wallet, name: `${string}:${string}`): T | undefined =>
  wallet.features[name] as T | undefined;

export const requestStandardWalletAccounts = async (
  wallet: UiWallet,
  options?: { readonly silent?: boolean },
): Promise<readonly UiWalletAccount[]> => {
  const standardWallet = standardWalletOf(wallet);
  const connect = featureOf<StandardConnectFeature>(standardWallet, STANDARD_CONNECT);
  if (!connect?.connect) {
    throw new Error(`${wallet.name} does not implement standard:connect`);
  }
  const { accounts } = await connect.connect(options?.silent ? { silent: true } : {});
  return accounts.map((account) => getOrCreateUiWalletAccountForStandardWalletAccount(standardWallet, account));
};

export const disconnectStandardWallet = async (wallet: UiWallet): Promise<void> => {
  const disconnect = featureOf<StandardDisconnectFeature>(standardWalletOf(wallet), STANDARD_DISCONNECT);
  await disconnect?.disconnect();
};

export const subscribeStandardWalletEvents = (
  wallet: UiWallet,
  onChange: (properties: { readonly accounts?: readonly WalletAccount[] }) => void,
): (() => void) => {
  const events = featureOf<StandardEventsFeature>(standardWalletOf(wallet), STANDARD_EVENTS);
  if (!events?.on) return () => undefined;
  return events.on('change', onChange);
};

export const connectBurnerSession = async (): Promise<AppSession> => {
  const [config, secretKey] = await Promise.all([loadDemoConfig(), loadOrCreateBurnerSecretKey(window.localStorage)]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  await requestFaucet(signer.address, 1, 1000).catch(() => undefined);
  writeWalletPreference('burner');
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
  writeWalletPreference(walletName);
  return {
    config,
    signer,
    permitWallet: permitWalletFromWalletAccount(account),
    wallet: { kind: 'wallet-standard', name: walletName },
  };
};

export const connectExternalWallet = async (
  wallet: UiWallet,
  options?: { readonly silent?: boolean },
): Promise<AppSession> => {
  const accounts = await requestStandardWalletAccounts(wallet, options);
  const account = accounts[0];
  if (!account) throw new Error(`${wallet.name} has no account selected`);
  return connectExternalSession(account, wallet.name);
};
