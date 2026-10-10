/** Matches `zama_host::cleartext::layout::STORE_ACCOUNT_SIZE` (js-sdk `hostConstants`). */
export const CLEARTEXT_STORE_ACCOUNT_SIZE = 9401;

/** Anchor discriminator + `ConfidentialTokenAccount::SPACE` (owner + mint + bump). */
export const CONFIDENTIAL_TOKEN_ACCOUNT_SIZE = 8 + 32 + 32 + 1;

/** OpenBatch initializes join + payout confidential token accounts, each with its own store. */
export const OPEN_BATCH_CONFIDENTIAL_ACCOUNTS = 2;

/** Headroom after both stores so the batch authority is not left empty. */
export const AUTHORITY_FUNDING_BUFFER_LAMPORTS = 50_000_000n;

/**
 * Official confidential-batcher mollusk tests fund `batch_authority` with 1 SOL
 * (`AUTHORITY_FUNDING = 1_000_000_000` in `batcher_mollusk.rs`). That PDA — not
 * the fee payer — pays both `InitializeTokenAccount` → `CreateEncryptedStore` rents.
 */
export const DEFAULT_AUTHORITY_FUNDING_LAMPORTS = 1_000_000_000;

export const requiredOpenBatchAuthorityLamports = (storeRent: bigint, tokenAccountRent: bigint): bigint =>
  BigInt(OPEN_BATCH_CONFIDENTIAL_ACCOUNTS) * (storeRent + tokenAccountRent) + AUTHORITY_FUNDING_BUFFER_LAMPORTS;

export const resolveAuthorityFundingLamports = (
  configured: bigint,
  storeRent: bigint,
  tokenAccountRent: bigint,
): bigint => {
  const required = requiredOpenBatchAuthorityLamports(storeRent, tokenAccountRent);
  return configured > required ? configured : required;
};
