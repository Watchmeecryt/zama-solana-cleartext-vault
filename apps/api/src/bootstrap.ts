import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import { SOLANA_CLEARTEXT_GATEWAY, SOLANA_CLEARTEXT_SIGNER_ADDRESSES } from '@fhevm/sdk/solana/cleartext';
import type { TransactionSigner } from '@solana/kit';
import { bootstrapZamaHost, evmAddressBytes } from './host/bootstrap.js';
import { createHostDeployContext } from './host/send.js';
import { env } from './env.js';

export const fundAddress = async (rpcUrl: string, address: string, sol: number): Promise<void> => {
  const rpc = createFinalizedRpc(rpcUrl);
  const lamports = BigInt(Math.round(sol * 1_000_000_000));
  const signature = await rpc.requestAirdrop(address as never, lamports).send();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    if (value[0]?.confirmationStatus === 'finalized' || value[0]?.confirmationStatus === 'confirmed') return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
};

export const bootstrapHost = async (rpcUrl: string, payer: TransactionSigner): Promise<void> => {
  await fundAddress(rpcUrl, payer.address, 1_000);
  const gateway = SOLANA_CLEARTEXT_GATEWAY;
  await bootstrapZamaHost(createHostDeployContext(rpcUrl), {
    payer,
    chainId: env.chainId,
    gateway: {
      gatewayChainId: BigInt(gateway.id),
      inputVerificationContract: evmAddressBytes(gateway.contracts.inputVerification.address),
      decryptionContract: evmAddressBytes(gateway.contracts.decryption.address),
      coprocessorSigners: SOLANA_CLEARTEXT_SIGNER_ADDRESSES.coprocessor.map(evmAddressBytes),
      kmsSigners: SOLANA_CLEARTEXT_SIGNER_ADDRESSES.kms.map(evmAddressBytes),
    },
    kmsCorruptionThreshold: 0,
  });
};
