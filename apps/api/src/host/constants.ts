const KMS_CONTEXT_COUNTER_BASE = 0x07n << 248n;
const EPOCH_COUNTER_BASE = 0x08n << 248n;

export const uint256Bytes = (value: bigint): Uint8Array =>
  Uint8Array.from(value.toString(16).padStart(64, '0').match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));

export const BRINGUP_KMS_CONTEXT_ID = uint256Bytes(KMS_CONTEXT_COUNTER_BASE + 1n);
export const BRINGUP_KMS_EPOCH_ID = uint256Bytes(EPOCH_COUNTER_BASE + 1n);
export const HCU_LIMITS = { maxHcuDepthPerTx: 5_000_000n, maxHcuPerTx: 20_000_000n } as const;
