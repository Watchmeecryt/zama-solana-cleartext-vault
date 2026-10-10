export const BURNER_WALLET_STORAGE_KEY = 'cleartext-vault-burner';

const parseStored = (value: string | null): Uint8Array | undefined => {
  if (value === null) return undefined;
  try {
    const bytes = JSON.parse(value) as unknown;
    if (Array.isArray(bytes) && bytes.length === 64 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Uint8Array.from(bytes as number[]);
    }
  } catch {
    // replace
  }
  return undefined;
};

const generateSecretKey = async (): Promise<Uint8Array> => {
  const keyPair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const [pkcs8, publicKey] = await Promise.all([
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    crypto.subtle.exportKey('raw', keyPair.publicKey),
  ]);
  const secretKey = new Uint8Array(64);
  secretKey.set(new Uint8Array(pkcs8).slice(-32), 0);
  secretKey.set(new Uint8Array(publicKey), 32);
  return secretKey;
};

export const loadOrCreateBurnerSecretKey = async (storage: Pick<Storage, 'getItem' | 'setItem'>): Promise<Uint8Array> => {
  const stored = parseStored(storage.getItem(BURNER_WALLET_STORAGE_KEY));
  if (stored !== undefined) return stored;
  const secretKey = await generateSecretKey();
  storage.setItem(BURNER_WALLET_STORAGE_KEY, JSON.stringify(Array.from(secretKey)));
  return secretKey;
};

export const exportBurnerSecretKey = (storage: Pick<Storage, 'getItem'>): string | null =>
  storage.getItem(BURNER_WALLET_STORAGE_KEY);

export const resetBurnerSecretKey = (storage: Pick<Storage, 'removeItem'>): void => {
  storage.removeItem(BURNER_WALLET_STORAGE_KEY);
};
