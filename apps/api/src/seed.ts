import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSigner, getAddressEncoder, type Instruction, type TransactionSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS as SPL_TOKEN_PROGRAM_ADDRESS,
  getMintSize,
  getInitializeMint2Instruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token';
import { findKmsContextPda } from '@fhevm/solana-zama-host';
import { findVaultAuthorityPda as findTokenVaultAuthorityPda } from '@fhevm/confidential-token';
import { prepareTransientStore, type TransientStore } from '@fhevm/sdk/solana';
import { BRINGUP_KMS_CONTEXT_ID } from './host/constants.js';
import {
  BatchDirection,
  buildInitializeMintInstruction,
  createDemoClient,
  findShareMintPda,
  getInitializeBatcherInstruction,
  getInitializeVaultInstructionAsync,
  openBatchForBatcher,
  readHostPolicy,
  ZAMA_HOST_PROGRAM_ADDRESS,
  CONFIDENTIAL_TOKEN_PROGRAM_ADDRESS,
  CONFIDENTIAL_BATCHER_PROGRAM_ADDRESS,
  DEMO_VAULT_PROGRAM_ADDRESS,
} from '@zama-demo/kit';
import { env, paths } from './env.js';
import { recordActivity } from './activity.js';
import { fundAddress } from './bootstrap.js';
import type { AppKeys } from './keys.js';

const MOCK_USDC_DECIMALS = 6;

const addressToBytes32Hex = (value: string): `0x${string}` => {
  const bytes = new Uint8Array(getAddressEncoder().encode(value as never));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const escrowAta = async (params: {
  payer: TransactionSigner;
  confidentialMint: string;
  underlyingMint: string;
}) => {
  const [vaultAuthority] = await findTokenVaultAuthorityPda({ mint: params.confidentialMint as never });
  const [escrow] = await findAssociatedTokenPda({
    owner: vaultAuthority,
    tokenProgram: SPL_TOKEN_PROGRAM_ADDRESS,
    mint: params.underlyingMint as never,
  });
  return getCreateAssociatedTokenIdempotentInstruction({
    payer: params.payer,
    ata: escrow,
    owner: vaultAuthority,
    mint: params.underlyingMint as never,
  });
};

export const seedDemo = async (rpcUrl: string, wsUrl: string, keys: AppKeys, publicRpcUrl: string, publicWsUrl: string) => {
  const { deployer, keeper, mintAuthority } = keys;
  for (const actor of [mintAuthority, keeper]) {
    await fundAddress(rpcUrl, actor.address, 100);
  }
  const endpoints = { rpcUrl, wsUrl };
  const send = async (payer: TransactionSigner, instructions: readonly Instruction[]) => {
    const result = await createDemoClient(endpoints, payer).sendTransaction(instructions);
    return result.context.signature;
  };
  const sendFhe = async (payer: TransactionSigner, transientStore: TransientStore, instructions: readonly Instruction[]) => {
    const result = await createDemoClient(endpoints, payer).sendFheTransaction(transientStore, instructions);
    return result.context.signature;
  };

  const [kmsContext] = await findKmsContextPda({ contextId: BRINGUP_KMS_CONTEXT_ID });
  const rpc = createDemoClient(endpoints, deployer).rpc;
  const kmsContextAccount = await rpc.getAccountInfo(kmsContext, { encoding: 'base64' }).send();
  if (kmsContextAccount.value === null) {
    throw new Error(`kms-context account ${kmsContext} is missing; host bootstrap did not finish`);
  }

  const mockUsdcMint = await generateKeyPairSigner();
  const vaultAccount = await generateKeyPairSigner();
  const cUsdcMint = await generateKeyPairSigner();
  const cSharesMint = await generateKeyPairSigner();
  const depositBatcher = await generateKeyPairSigner();
  const redeemBatcher = await generateKeyPairSigner();
  const [shareMint] = await findShareMintPda({ vault: vaultAccount.address });

  const mintRent = await rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize())).send();
  await send(deployer, [
    getCreateAccountInstruction({
      payer: deployer,
      newAccount: mockUsdcMint,
      lamports: mintRent,
      space: BigInt(getMintSize()),
      programAddress: SPL_TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({
      mint: mockUsdcMint.address,
      decimals: MOCK_USDC_DECIMALS,
      mintAuthority: mintAuthority.address,
    }),
  ]);
  await recordActivity('Create test USDC mint', 'seed');

  await send(deployer, [
    await getInitializeVaultInstructionAsync({
      payer: deployer,
      vault: vaultAccount,
      underlyingMint: mockUsdcMint.address,
    }),
  ]);

  const mintTransientStore = await prepareTransientStore({ payer: deployer, host: ZAMA_HOST_PROGRAM_ADDRESS });
  await sendFhe(deployer, mintTransientStore, [
    await buildInitializeMintInstruction({
      transientStore: mintTransientStore,
      authority: keeper,
      mint: cUsdcMint,
      underlyingMint: mockUsdcMint.address,
    }),
  ]);
  await sendFhe(deployer, mintTransientStore, [
    await buildInitializeMintInstruction({
      transientStore: mintTransientStore,
      authority: keeper,
      mint: cSharesMint,
      underlyingMint: shareMint,
    }),
  ]);

  await send(deployer, [
    await escrowAta({
      payer: deployer,
      confidentialMint: cUsdcMint.address,
      underlyingMint: mockUsdcMint.address,
    }),
    await escrowAta({
      payer: deployer,
      confidentialMint: cSharesMint.address,
      underlyingMint: shareMint,
    }),
  ]);

  await send(deployer, [
    getInitializeBatcherInstruction({
      payer: deployer,
      batcher: depositBatcher,
      joinConfidentialMint: cUsdcMint.address,
      payoutConfidentialMint: cSharesMint.address,
      vault: vaultAccount.address,
      minBatchAgeSecs: env.minBatchAgeSecs,
      settleDeadlineSecs: env.settleDeadlineSecs,
      direction: BatchDirection.Deposit,
    }),
  ]);
  await send(deployer, [
    getInitializeBatcherInstruction({
      payer: deployer,
      batcher: redeemBatcher,
      joinConfidentialMint: cSharesMint.address,
      payoutConfidentialMint: cUsdcMint.address,
      vault: vaultAccount.address,
      minBatchAgeSecs: env.minBatchAgeSecs,
      settleDeadlineSecs: env.settleDeadlineSecs,
      direction: BatchDirection.Redeem,
    }),
  ]);

  const commonRoots = {
    batcherProgram: CONFIDENTIAL_BATCHER_PROGRAM_ADDRESS,
    tokenProgram: CONFIDENTIAL_TOKEN_PROGRAM_ADDRESS,
    vaultProgram: DEMO_VAULT_PROGRAM_ADDRESS,
    hostProgram: ZAMA_HOST_PROGRAM_ADDRESS,
    vault: vaultAccount.address,
  } as const;

  const openFirst = async (roots: {
    batcher: typeof depositBatcher.address;
    joinConfidentialMint: typeof cUsdcMint.address;
    payoutConfidentialMint: typeof cSharesMint.address;
    joinUnderlyingMint: typeof mockUsdcMint.address;
    payoutUnderlyingMint: typeof shareMint;
  }) => {
    const transientStore = await prepareTransientStore({ payer: keeper, host: ZAMA_HOST_PROGRAM_ADDRESS });
    await sendFhe(keeper, transientStore, [
      await openBatchForBatcher({
        transientStore,
        roots: { ...commonRoots, ...roots },
        batchIndex: 0n,
        payer: keeper,
        authorityFundingLamports: env.authorityFundingLamports,
        host: await readHostPolicy(rpc),
      }),
    ]);
  };

  await openFirst({
    batcher: depositBatcher.address,
    joinConfidentialMint: cUsdcMint.address,
    payoutConfidentialMint: cSharesMint.address,
    joinUnderlyingMint: mockUsdcMint.address,
    payoutUnderlyingMint: shareMint,
  });
  await openFirst({
    batcher: redeemBatcher.address,
    joinConfidentialMint: cSharesMint.address,
    payoutConfidentialMint: cUsdcMint.address,
    joinUnderlyingMint: shareMint,
    payoutUnderlyingMint: mockUsdcMint.address,
  });

  const config = {
    source: 'demo-config',
    network: 'localnet',
    demoBootId: `cleartext-${Date.now()}`,
    chainId: env.chainId.toString(),
    rpcUrl: publicRpcUrl,
    wsUrl: publicWsUrl,
    relayerUrl: `${publicRpcUrl.replace(/\/rpc$/, '')}/api/relayer`,
    aclProgram: addressToBytes32Hex(ZAMA_HOST_PROGRAM_ADDRESS),
    fheParameter: 'cleartext',
    authorityFundingLamports: env.authorityFundingLamports.toString(),
    programs: {
      batcher: CONFIDENTIAL_BATCHER_PROGRAM_ADDRESS,
      token: CONFIDENTIAL_TOKEN_PROGRAM_ADDRESS,
      vault: DEMO_VAULT_PROGRAM_ADDRESS,
      host: ZAMA_HOST_PROGRAM_ADDRESS,
    },
    vault: vaultAccount.address,
    mints: {
      joinUnderlying: mockUsdcMint.address,
      payoutUnderlying: shareMint,
      joinConfidential: cUsdcMint.address,
      payoutConfidential: cSharesMint.address,
    },
    batchers: {
      deposit: { batcher: depositBatcher.address },
      redeem: { batcher: redeemBatcher.address },
    },
    mintAuthority: mintAuthority.address,
    personas: { keeper: keeper.address, alice: keeper.address },
  };

  await mkdir(path.dirname(paths.config), { recursive: true });
  await writeFile(paths.config, JSON.stringify(config, null, 2));
  await writeFile(paths.seededFlag, JSON.stringify({ at: Date.now(), vault: vaultAccount.address }));
  await recordActivity('Seed vault, batchers, and test USDC', 'seed');
  return config;
};
