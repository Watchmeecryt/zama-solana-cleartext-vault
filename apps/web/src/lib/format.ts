export const formatUsdc = (baseUnits: bigint): string => {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
};

export const shortAddress = (value: string): string =>
  value.length <= 12 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;

export const formatCountdown = (seconds: bigint): string => {
  const total = Number(seconds < 0n ? 0n : seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};
