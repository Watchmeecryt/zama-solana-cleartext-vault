import { address, getAddressDecoder, type Address } from '@solana/kit';
import { hexToBytes } from '@fhevm/sdk/base';

export type DemoNetwork = 'localnet' | 'devnet';

export type DemoConfig = {
  readonly source: 'demo-config';
  readonly network: DemoNetwork;
  readonly demoBootId: string;
  readonly chainId: string;
  readonly rpcUrl: string;
  readonly wsUrl: string;
  readonly relayerUrl: string;
  readonly aclProgram: `0x${string}`;
  readonly fheParameter: string;
  readonly authorityFundingLamports: string;
  readonly vault: Address;
  readonly programs: {
    readonly batcher: Address;
    readonly token: Address;
    readonly vault: Address;
    readonly host: Address;
  };
  readonly mints: {
    readonly joinUnderlying: Address;
    readonly payoutUnderlying: Address;
    readonly joinConfidential: Address;
    readonly payoutConfidential: Address;
  };
  readonly batchers: {
    readonly deposit: { readonly batcher: Address };
    readonly redeem: { readonly batcher: Address };
  };
  readonly personas: {
    readonly keeper: Address;
    readonly alice: Address;
  };
  readonly mintAuthority?: Address;
};

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
};

const string = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
};

const hexBytes = (value: unknown, name: string, byteLength: number): `0x${string}` => {
  const text = string(value, name);
  if (!new RegExp(`^0x[0-9a-f]{${byteLength * 2}}$`, 'i').test(text)) {
    throw new Error(`${name} must be a 0x-prefixed ${byteLength}-byte hex value`);
  }
  return text as `0x${string}`;
};

const anyUrl = (value: unknown, name: string): string => {
  const parsed = new URL(string(value, name));
  return parsed.toString().replace(/\/$/, '');
};

export const parseDemoConfig = (value: unknown): DemoConfig => {
  const raw = object(value, 'demo config');
  const personas = object(raw.personas, 'demo config.personas');
  const programs = object(raw.programs, 'demo config.programs');
  const mints = object(raw.mints, 'demo config.mints');
  const batchers = object(raw.batchers, 'demo config.batchers');
  const deposit = object(batchers.deposit, 'demo config.batchers.deposit');
  const redeem = object(batchers.redeem, 'demo config.batchers.redeem');
  if (raw.source !== 'demo-config') throw new Error('demo config.source must be demo-config');
  const network = raw.network === 'devnet' ? 'devnet' : 'localnet';
  const aclProgram = hexBytes(raw.aclProgram, 'demo config.aclProgram', 32);
  const host = address(string(programs.host, 'demo config.programs.host'));
  if (getAddressDecoder().decode(hexToBytes(aclProgram)) !== host) {
    throw new Error('demo config.aclProgram and demo config.programs.host name different programs');
  }
  return {
    source: 'demo-config',
    network,
    demoBootId: string(raw.demoBootId, 'demo config.demoBootId'),
    chainId: string(raw.chainId, 'demo config.chainId'),
    rpcUrl: anyUrl(raw.rpcUrl, 'demo config.rpcUrl'),
    wsUrl: anyUrl(raw.wsUrl, 'demo config.wsUrl'),
    relayerUrl: anyUrl(raw.relayerUrl ?? 'http://127.0.0.1:9', 'demo config.relayerUrl'),
    aclProgram,
    fheParameter: string(raw.fheParameter ?? 'cleartext', 'demo config.fheParameter'),
    authorityFundingLamports: string(raw.authorityFundingLamports, 'demo config.authorityFundingLamports'),
    vault: address(string(raw.vault, 'demo config.vault')),
    programs: {
      batcher: address(string(programs.batcher, 'demo config.programs.batcher')),
      token: address(string(programs.token, 'demo config.programs.token')),
      vault: address(string(programs.vault, 'demo config.programs.vault')),
      host,
    },
    mints: {
      joinUnderlying: address(string(mints.joinUnderlying, 'demo config.mints.joinUnderlying')),
      payoutUnderlying: address(string(mints.payoutUnderlying, 'demo config.mints.payoutUnderlying')),
      joinConfidential: address(string(mints.joinConfidential, 'demo config.mints.joinConfidential')),
      payoutConfidential: address(string(mints.payoutConfidential, 'demo config.mints.payoutConfidential')),
    },
    batchers: {
      deposit: { batcher: address(string(deposit.batcher, 'demo config.batchers.deposit.batcher')) },
      redeem: { batcher: address(string(redeem.batcher, 'demo config.batchers.redeem.batcher')) },
    },
    personas: {
      keeper: address(string(personas.keeper, 'demo config.personas.keeper')),
      alice: address(string(personas.alice ?? personas.keeper, 'demo config.personas.alice')),
    },
    mintAuthority:
      raw.mintAuthority === undefined ? undefined : address(string(raw.mintAuthority, 'demo config.mintAuthority')),
  };
};

export const parseRuntimeDemoConfig = (value: unknown, demoBootId: string): DemoConfig =>
  parseDemoConfig({ ...object(value, 'runtime demo config'), demoBootId });

export const parseDemoConfigResponse = (value: unknown): DemoConfig =>
  parseDemoConfig(object(value, 'demo config response').config);
