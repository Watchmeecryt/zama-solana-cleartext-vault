import {
  type Address,
  type Instruction,
  type TransactionSigner,
  fetchEncodedAccount,
  getAddressEncoder,
  getProgramDerivedAddress,
} from '@solana/kit';
import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/loader-v3';
import {
  findEventAuthorityPda,
  findHostConfigPda,
  findKmsContextPda,
  findRandNoncePda,
  getDefineKmsContextInstructionAsync,
  getHostConfigDecoder,
  getInitializeHostConfigInstructionAsync,
  getKmsContextDecoder,
  getSetMaxHcuDepthPerTxInstructionAsync,
  getSetMaxHcuPerTxInstructionAsync,
  HCU_UNLIMITED,
  HOST_CONFIG_DISCRIMINATOR,
  KMS_CONTEXT_DISCRIMINATOR,
  MAX_COPROCESSOR_SIGNERS,
  MAX_KMS_SIGNERS,
  ZAMA_HOST_PROGRAM_ADDRESS,
} from '@fhevm/solana-zama-host';
import { BRINGUP_KMS_CONTEXT_ID, BRINGUP_KMS_EPOCH_ID, HCU_LIMITS } from './constants.js';
import type { HostDeployContext } from './send.js';

const EVM_CHAIN_TYPE = 0x00n;
const SOLANA_CHAIN_TYPE = 0x01n;
const CHAIN_TYPE_SHIFT = 56n;
const U64_MAX = (1n << 64n) - 1n;

export type GatewayBootstrapInputs = {
  readonly gatewayChainId: bigint;
  readonly inputVerificationContract: Uint8Array;
  readonly decryptionContract: Uint8Array;
  readonly coprocessorSigners: readonly Uint8Array[];
  readonly kmsSigners: readonly Uint8Array[];
};

const chainTypeByte = (chainId: bigint): bigint => (chainId >> CHAIN_TYPE_SHIFT) & 0xffn;

const isEvmHostChainId = (chainId: bigint | number): boolean => chainTypeByte(BigInt(chainId)) === EVM_CHAIN_TYPE;

const assertValidSolanaChainId = (chainId: bigint): void => {
  if (typeof chainId !== 'bigint' || chainId > U64_MAX || chainTypeByte(chainId) !== SOLANA_CHAIN_TYPE) {
    throw new Error('Solana chain id must be a u64 bigint with type byte 0x01');
  }
};

export const evmAddressBytes = (address: string): Uint8Array => {
  const hex = address.replace(/^0x/, '');
  if (hex.length !== 40 || !/^[0-9a-f]{40}$/i.test(hex)) {
    throw new Error(`expected a 20-byte EVM address, got "${address}"`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
};

export const kmsCertificateThreshold = (kmsCorruptionThreshold: number, registeredSignerCount: number): number => {
  if (!Number.isSafeInteger(kmsCorruptionThreshold) || kmsCorruptionThreshold < 0 || kmsCorruptionThreshold > 255) {
    throw new Error('KMS corruption threshold t must be an unsigned byte');
  }
  const committeeSize = 3 * kmsCorruptionThreshold + 1;
  if (registeredSignerCount !== committeeSize) {
    throw new Error(
      `KMS corruption threshold t=${kmsCorruptionThreshold} needs a committee of 3t+1=${committeeSize} ` +
        `KMS signers; the gateway has ${registeredSignerCount} registered`,
    );
  }
  return 2 * kmsCorruptionThreshold + 1;
};

export const defineKmsContextInstruction = (
  params: {
    readonly admin: TransactionSigner;
    readonly contextId: Uint8Array;
    readonly epochId: Uint8Array;
    readonly signers: readonly Uint8Array[];
    readonly kmsCorruptionThreshold: number;
  },
  config?: { readonly programAddress?: Address },
): Promise<Instruction> => {
  const certificateThreshold = kmsCertificateThreshold(params.kmsCorruptionThreshold, params.signers.length);
  return getDefineKmsContextInstructionAsync(
    {
      admin: params.admin,
      contextId: params.contextId,
      epochId: params.epochId,
      signers: [...params.signers],
      thresholds: {
        publicDecryption: certificateThreshold,
        userDecryption: certificateThreshold,
        kmsGen: certificateThreshold,
        mpc: params.kmsCorruptionThreshold,
      },
    },
    config,
  );
};

export const programDataAddressFor = async (programAddress: Address): Promise<Address> => {
  const [programData] = await getProgramDerivedAddress({
    programAddress: LOADER_V3_PROGRAM_ADDRESS,
    seeds: [getAddressEncoder().encode(programAddress)],
  });
  return programData;
};

export type BootstrapZamaHostParams = {
  readonly payer: TransactionSigner;
  readonly gateway: GatewayBootstrapInputs;
  readonly coprocessorThreshold?: number;
  readonly kmsCorruptionThreshold: number;
  readonly programAddress?: Address;
  readonly validateOnly?: boolean;
  readonly chainId: bigint;
};

export const validateBootstrapInputs = (params: BootstrapZamaHostParams): void => {
  assertValidSolanaChainId(params.chainId);
  for (const [name, signers, maximum] of [
    ['coprocessor', params.gateway.coprocessorSigners, MAX_COPROCESSOR_SIGNERS],
    ['KMS', params.gateway.kmsSigners, MAX_KMS_SIGNERS],
  ] as const) {
    const addresses = signers.map((signer) => Buffer.from(signer).toString('hex'));
    if (
      signers.length < 1 ||
      signers.length > maximum ||
      signers.some((s) => s.length !== 20 || s.every((b) => b === 0)) ||
      new Set(addresses).size !== signers.length
    ) {
      throw new Error(`${name} signer set must contain 1..${maximum} distinct nonzero 20-byte addresses`);
    }
  }
  const threshold = params.coprocessorThreshold ?? 1;
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > params.gateway.coprocessorSigners.length) {
    throw new Error('coprocessor threshold must be between 1 and signer count');
  }
  if (params.gateway.gatewayChainId < 0n || !isEvmHostChainId(params.gateway.gatewayChainId)) {
    throw new Error('gateway chain id must be a uint64-padded EVM id (high byte 0x00)');
  }
  if (
    [params.gateway.decryptionContract, params.gateway.inputVerificationContract].some(
      (contract) => contract.length !== 20 || contract.every((byte) => byte === 0),
    )
  ) {
    throw new Error('gateway contract addresses must be nonzero 20-byte addresses');
  }
  kmsCertificateThreshold(params.kmsCorruptionThreshold, params.gateway.kmsSigners.length);
};

export const bootstrapZamaHost = async (context: HostDeployContext, params: BootstrapZamaHostParams): Promise<void> => {
  validateBootstrapInputs(params);
  const programAddress = params.programAddress ?? ZAMA_HOST_PROGRAM_ADDRESS;
  const eventAuthority = (await findEventAuthorityPda({ programAddress }))[0];
  const programData = await programDataAddressFor(programAddress);
  const [hostConfig] = await findHostConfigPda({ programAddress });
  const [randNonce] = await findRandNoncePda({ programAddress });
  const shared = { eventAuthority, program: programAddress, hostConfig } as const;
  const ixConfig = { programAddress } as const;

  const { kmsCorruptionThreshold } = params;
  const certificateThreshold = kmsCertificateThreshold(kmsCorruptionThreshold, params.gateway.kmsSigners.length);
  const existing = await fetchEncodedAccount(context.rpc, hostConfig);

  if (existing.exists) {
    const equalBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => Buffer.from(a).equals(Buffer.from(b));
    if (
      existing.programAddress !== programAddress ||
      !equalBytes(existing.data.slice(0, 8), HOST_CONFIG_DISCRIMINATOR)
    ) {
      throw new Error('existing HostConfig has an unexpected owner or discriminator');
    }
    const config = getHostConfigDecoder().decode(existing.data);
    if (
      config.admin !== params.payer.address ||
      config.chainId !== params.chainId ||
      config.gatewayChainId !== params.gateway.gatewayChainId ||
      !equalBytes(config.inputVerificationContract, params.gateway.inputVerificationContract) ||
      !equalBytes(config.decryptionContract, params.gateway.decryptionContract) ||
      config.coprocessorThreshold !== (params.coprocessorThreshold ?? 1) ||
      config.coprocessorSignerCount !== params.gateway.coprocessorSigners.length ||
      !params.gateway.coprocessorSigners.every((signer, i) => equalBytes(signer, config.coprocessorSigners[i]!))
    ) {
      throw new Error(
        'existing HostConfig does not match deployment inputs; refuse to bind an existing host to a different stack',
      );
    }
    if (config.maxHcuPerTx === HCU_UNLIMITED && config.maxHcuDepthPerTx === HCU_UNLIMITED) {
      throw new Error(
        'existing HostConfig still has unlimited HCU limits (never bootstrapped); set them with the HCU setters first',
      );
    }
    console.log(
      `host_config matches deployment inputs; HCU limits: maxHcuPerTx=${config.maxHcuPerTx} ` +
        `maxHcuDepthPerTx=${config.maxHcuDepthPerTx} hcuBlockCapPerApp=${config.hcuBlockCapPerApp}`,
    );
  } else if (!params.validateOnly) {
    await context.sendTransaction(params.payer, [
      await getInitializeHostConfigInstructionAsync(
        {
          payer: params.payer,
          admin: params.payer,
          programData,
          randNonce,
          chainId: params.chainId,
          gatewayChainId: params.gateway.gatewayChainId,
          inputVerificationContract: params.gateway.inputVerificationContract,
          coprocessorSigners: [...params.gateway.coprocessorSigners],
          coprocessorThreshold: params.coprocessorThreshold ?? 1,
          decryptionContract: params.gateway.decryptionContract,
          grantDenyListEnabled: false,
          ...shared,
        },
        ixConfig,
      ),
      await getSetMaxHcuDepthPerTxInstructionAsync(
        { admin: params.payer, value: HCU_LIMITS.maxHcuDepthPerTx, ...shared },
        ixConfig,
      ),
      await getSetMaxHcuPerTxInstructionAsync(
        { admin: params.payer, value: HCU_LIMITS.maxHcuPerTx, ...shared },
        ixConfig,
      ),
    ]);
    console.log('OK initialize_host_config');
  }

  const [kmsContext] = await findKmsContextPda({ contextId: BRINGUP_KMS_CONTEXT_ID }, { programAddress });
  const existingContext = await fetchEncodedAccount(context.rpc, kmsContext);
  if (existingContext.exists) {
    const data = getKmsContextDecoder().decode(existingContext.data);
    const equal = (a: ArrayLike<number>, b: ArrayLike<number>) => Buffer.from(a).equals(Buffer.from(b));
    if (
      existingContext.programAddress !== programAddress ||
      !equal(data.discriminator, KMS_CONTEXT_DISCRIMINATOR) ||
      !equal(data.contextId, BRINGUP_KMS_CONTEXT_ID) ||
      data.destroyed ||
      data.signers.length !== params.gateway.kmsSigners.length ||
      !data.signers.every((signer, i) => equal(signer, params.gateway.kmsSigners[i]!)) ||
      data.thresholds.publicDecryption !== certificateThreshold ||
      data.thresholds.userDecryption !== certificateThreshold ||
      data.thresholds.kmsGen !== certificateThreshold ||
      data.thresholds.mpc !== kmsCorruptionThreshold
    )
      throw new Error('existing KMS context does not match deployment inputs');
    console.log('kms_context matches deployment inputs');
    return;
  }

  if (params.validateOnly) return;

  await context.sendTransaction(params.payer, [
    await defineKmsContextInstruction(
      {
        admin: params.payer,
        contextId: BRINGUP_KMS_CONTEXT_ID,
        epochId: BRINGUP_KMS_EPOCH_ID,
        signers: params.gateway.kmsSigners,
        kmsCorruptionThreshold,
      },
      ixConfig,
    ),
  ]);
  console.log(
    `OK define_kms_context (signers: ${params.gateway.kmsSigners.length}, ` +
      `t=${kmsCorruptionThreshold}, cert_threshold=${certificateThreshold})`,
  );
};
