import path from 'node:path';

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

export const env = {
  port: integer('PORT', 8080),
  dataDir: process.env.DATA_DIR ?? '/data',
  ledgerDir: process.env.LEDGER_DIR ?? path.join(process.env.DATA_DIR ?? '/data', 'ledger'),
  programsDir: process.env.PROGRAMS_DIR ?? '/app/programs',
  publicDir: process.env.PUBLIC_DIR ?? '/app/public',
  publicUrl: process.env.PUBLIC_URL,
  resetToken: process.env.RESET_TOKEN,
  validatorRpcPort: integer('VALIDATOR_RPC_PORT', 8899),
  validatorFaucetPort: integer('VALIDATOR_FAUCET_PORT', 9900),
  validatorGossipPort: integer('VALIDATOR_GOSSIP_PORT', 8001),
  minBatchAgeSecs: BigInt(integer('MIN_BATCH_AGE_SECS', 10)),
  settleDeadlineSecs: BigInt(integer('SETTLE_DEADLINE_SECS', 120)),
  authorityFundingLamports: BigInt(integer('AUTHORITY_FUNDING_LAMPORTS', 100_000_000)),
  keeperIntervalMs: integer('KEEPER_INTERVAL_MS', 4000),
  harvestIntervalMs: integer('HARVEST_INTERVAL_MS', 180_000),
  chainId: BigInt(process.env.SOLANA_HOST_CHAIN_ID ?? '72057594037940281'),
};

export const paths = {
  config: path.join(env.dataDir, 'demo-config.json'),
  activity: path.join(env.dataDir, 'activity.json'),
  deployer: path.join(env.dataDir, 'keys', 'deployer.json'),
  keeper: path.join(env.dataDir, 'keys', 'keeper.json'),
  mintAuthority: path.join(env.dataDir, 'keys', 'mint-authority.json'),
  validatorLog: path.join(env.dataDir, 'validator.log'),
  genesisStamp: path.join(env.dataDir, 'genesis-stamp.json'),
  seededFlag: path.join(env.dataDir, 'seeded.json'),
};

export const programIds = {
  zamaHost: 'DPq5y89RDZPq9NcMh9X1NgjBWgYmSXg3QoipSBV3ZMzQ',
  confidentialToken: 'FAWs7E52LZmXR5YzFy4aXanfBjNtXV2qooQVtkmBa3cL',
  demoVault: 'DKuvkbkqo71fnbTsSNFzGCH1gT7FhKZU45bMqTSxxSFH',
  confidentialBatcher: 'DAVFjzkMrUZnX9wqbYbAGiPTHQPTmdZ2C9kNsuSykJHb',
} as const;

export const soFiles = {
  zamaHostCleartext: 'zama_host_cleartext.so',
  confidentialToken: 'confidential_token.so',
  demoVault: 'demo_vault.so',
  confidentialBatcher: 'confidential_batcher.so',
} as const;
