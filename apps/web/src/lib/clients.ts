import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import {
  createFhevmCleartextDecryptClient,
  createFhevmCleartextEncryptClient,
  createSolanaLeafRecord,
} from '@fhevm/sdk/solana/cleartext';
import { defineFhevmSolanaChain, setFhevmRuntimeConfig, solanaHostProgram } from '@fhevm/sdk/solana';
import type { DemoConfig } from '@zama-demo/kit';
import type { Bytes32Hex } from '@fhevm/sdk/types';

let configured = false;

export const ensureRuntime = (): void => {
  if (configured) return;
  setFhevmRuntimeConfig({
    auth: { type: 'ApiKeyHeader', value: 'local' },
    singleThread: !(globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined'),
  });
  configured = true;
};

export const solanaChain = (config: DemoConfig) =>
  defineFhevmSolanaChain({
    id: BigInt(config.chainId),
    fhevm: {
      relayerUrl: config.relayerUrl,
      programs: { host: { address: config.aclProgram as Bytes32Hex } },
    },
  });

export const createCleartextEncryptClient = (config: DemoConfig) => {
  ensureRuntime();
  const rpc = createFinalizedRpc(config.rpcUrl);
  return createFhevmCleartextEncryptClient({ chain: solanaChain(config), rpc });
};

export const createCleartextDecryptClient = (config: DemoConfig) => {
  ensureRuntime();
  const rpc = createFinalizedRpc(config.rpcUrl);
  const chain = solanaChain(config);
  return createFhevmCleartextDecryptClient({
    chain,
    rpc,
    readMerkleProofs: createSolanaLeafRecord(rpc, solanaHostProgram(chain)),
  });
};
