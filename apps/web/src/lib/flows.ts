import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { getAddressEncoder, type Address } from '@solana/kit';
import { prepareTransientStore } from '@fhevm/sdk/solana';
import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import { BALANCE_KEY, findTokenAccountPda } from '@fhevm/confidential-token';
import { encryptedStoreHandle } from '@fhevm/sdk/solana';
import {
  buildInitializeTokenAccountInstruction,
  buildWrapUsdcInstruction,
  createDemoClient,
  getCurrentBatch,
  getEncryptedStore,
  joinBatch,
  readHostPolicy,
  tokenStoreAddress,
  vaultRoots,
  type DemoConfig,
} from '@zama-demo/kit';
import type { Bytes32Hex } from '@fhevm/sdk/types';
import { createCleartextDecryptClient, createCleartextEncryptClient, solanaChain } from './clients.js';
import { rememberActivity } from './activityStore.js';
import type { AppSession } from '../wallet/session.js';

const addressEncoder = getAddressEncoder();
const asBytes32Hex = (value: Address): Bytes32Hex =>
  `0x${Array.from(addressEncoder.encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Bytes32Hex;

export const usdcToBaseUnits = (amount: number): bigint => {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000) {
    throw new Error('Amount must be between 0 and 1,000 USDC');
  }
  return BigInt(Math.round(amount * 1_000_000));
};

export const shieldUsdc = async (session: AppSession, amount: number): Promise<string> => {
  const amountBaseUnits = usdcToBaseUnits(amount);
  const client = createDemoClient(session.config, session.signer);
  const host = await readHostPolicy(client.rpc);
  const transientStore = await prepareTransientStore({ payer: session.signer, host: session.config.programs.host });
  const { context } = await client.sendFheTransaction(transientStore, [
    await buildInitializeTokenAccountInstruction({
      transientStore,
      payer: session.signer,
      owner: session.signer.address,
      mint: session.config.mints.joinConfidential,
      host,
    }),
    await buildWrapUsdcInstruction({
      transientStore,
      host,
      owner: session.signer,
      mint: session.config.mints.joinConfidential,
      underlyingMint: session.config.mints.joinUnderlying,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      amount: amountBaseUnits,
    }),
  ]);
  rememberActivity({ label: 'Wrap USDC to cUSDC', signature: context.signature, at: Date.now() });
  return context.signature;
};

export const depositToBatch = async (session: AppSession, amount: number): Promise<string> => {
  const amountBaseUnits = usdcToBaseUnits(amount);
  const client = createDemoClient(session.config, session.signer);
  const roots = vaultRoots(session.config, 'deposit');
  const batch = await getCurrentBatch(client.rpc, roots);
  if (batch.state.status !== 0) throw new Error('The current deposit batch is no longer accepting deposits');
  const host = await readHostPolicy(client.rpc);
  const encryptClient = createCleartextEncryptClient(session.config);
  const { inputProof } = await encryptClient.encryptValues({
    contractAddress: asBytes32Hex(session.config.programs.token),
    userAddress: asBytes32Hex(session.signer.address),
    values: [{ type: 'uint64', value: amountBaseUnits }],
  });
  const signature = await joinBatch(
    { solanaChain: solanaChain(session.config), aclProgramAddress: session.config.aclProgram as Bytes32Hex },
    client,
    {
      inputProof,
      inputIndex: 0,
      user: session.signer,
      batcher: roots.batcher,
      batch: batch.addresses.batch,
      joinConfidentialMint: roots.joinConfidentialMint,
      joinUnderlyingMint: roots.joinUnderlyingMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      host,
    },
  );
  rememberActivity({ label: 'Join deposit batch', signature, at: Date.now() });
  return signature;
};

export const redeemShares = async (session: AppSession, amount: number): Promise<string> => {
  const amountBaseUnits = usdcToBaseUnits(amount);
  const client = createDemoClient(session.config, session.signer);
  const roots = vaultRoots(session.config, 'redeem');
  const batch = await getCurrentBatch(client.rpc, roots);
  if (batch.state.status !== 0) throw new Error('The current redeem batch is no longer accepting joins');
  const host = await readHostPolicy(client.rpc);
  const encryptClient = createCleartextEncryptClient(session.config);
  const { inputProof } = await encryptClient.encryptValues({
    contractAddress: asBytes32Hex(session.config.programs.token),
    userAddress: asBytes32Hex(session.signer.address),
    values: [{ type: 'uint64', value: amountBaseUnits }],
  });
  const signature = await joinBatch(
    { solanaChain: solanaChain(session.config), aclProgramAddress: session.config.aclProgram as Bytes32Hex },
    client,
    {
      inputProof,
      inputIndex: 0,
      user: session.signer,
      batcher: roots.batcher,
      batch: batch.addresses.batch,
      joinConfidentialMint: roots.joinConfidentialMint,
      joinUnderlyingMint: roots.joinUnderlyingMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      host,
    },
  );
  rememberActivity({ label: 'Join redeem batch', signature, at: Date.now() });
  return signature;
};

export const revealConfidentialBalance = async (
  session: AppSession,
  mint: DemoConfig['mints']['joinConfidential'],
  label: 'cUSDC' | 'cShares',
): Promise<bigint> => {
  if (session.permitWallet === undefined) {
    throw new Error(`${session.wallet.name} cannot sign a decrypt permit. Use the built-in wallet, or a wallet that supports solana:signOffchainMessage.`);
  }
  const tokenAccount = (await findTokenAccountPda({ mint, owner: session.signer.address }))[0];
  const encryptedStore = await tokenStoreAddress(mint, tokenAccount);
  const client = createCleartextDecryptClient(session.config);
  const state = await getEncryptedStore(client, encryptedStore);
  const permit = await client.signPermit({
    wallet: session.permitWallet,
    durationSeconds: 3_600n,
    allowedScopes: [{ program: session.config.programs.token, scope: mint }],
  });
  const [clearValue] = await client.decryptValues({
    session: permit,
    entries: [
      {
        handle: encryptedStoreHandle(state, BALANCE_KEY),
        encryptedStore: new Uint8Array(getAddressEncoder().encode(encryptedStore)),
      },
    ],
  });
  if (clearValue === undefined || typeof clearValue.value !== 'bigint') {
    throw new Error(`Could not decrypt the ${label} balance`);
  }
  return clearValue.value;
};

export const readUsdcBalance = async (config: DemoConfig, owner: string): Promise<bigint> => {
  const rpc = createFinalizedRpc(config.rpcUrl);
  const accounts = await rpc
    .getTokenAccountsByOwner(owner as never, { mint: config.mints.joinUnderlying }, { encoding: 'jsonParsed' })
    .send();
  return accounts.value.reduce((sum, tokenAccount) => {
    const data = tokenAccount.account.data as {
      readonly parsed?: { readonly info?: { readonly tokenAmount?: { readonly amount?: string } } };
    };
    return sum + BigInt(data.parsed?.info?.tokenAmount?.amount ?? '0');
  }, 0n);
};
