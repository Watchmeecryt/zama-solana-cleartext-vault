import { useEffect, useState } from 'react';
import { Button } from '@unlocalhosted/metalui';
import { useWallets } from '@wallet-standard/react';
import { Export, Plugs, Trash } from '@phosphor-icons/react';
import { shortAddress } from '../lib/format.js';
import { useSession } from '../session.js';
import { connectBurnerSession, connectExternalSession, signsVersion1Transactions } from '../wallet/session.js';
import { exportBurnerSecretKey, resetBurnerSecretKey } from '../wallet/burner.js';
import { publicRpcUrls } from '../lib/api.js';

export function WalletBar() {
  const { session, setSession } = useSession();
  const wallets = useWallets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRpc, setShowRpc] = useState(false);

  useEffect(() => {
    if (session) return;
    setBusy(true);
    void connectBurnerSession()
      .then(setSession)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  }, [session, setSession]);

  const urls = publicRpcUrls();

  return (
    <div className="wallet-box">
      {session ? (
        <span className="muted mono">
          {session.wallet.name} · {shortAddress(session.signer.address)}
        </span>
      ) : (
        <span className="muted">{busy ? 'Connecting…' : 'No wallet'}</span>
      )}
      <Button
        cap="standard"
        size="compact"
        icon={<Plugs size={14} />}
        onClick={() => {
          setBusy(true);
          void connectBurnerSession()
            .then(setSession)
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setBusy(false));
        }}
      >
        Built-in wallet
      </Button>
      {wallets.filter(signsVersion1Transactions).map((wallet) => (
        <Button
          key={wallet.name}
          cap="standard"
          size="compact"
          onClick={() => {
            const account = wallet.accounts[0];
            if (!account) {
              setError(`${wallet.name} has no account selected`);
              return;
            }
            setBusy(true);
            void connectExternalSession(account, wallet.name)
              .then(setSession)
              .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {wallet.name}
        </Button>
      ))}
      <Button cap="standard" size="compact" onClick={() => setShowRpc((value) => !value)}>
        Custom RPC
      </Button>
      {session?.wallet.kind === 'burner' && (
        <>
          <Button
            cap="standard"
            size="compact"
            icon={<Export size={14} />}
            onClick={() => {
              const secret = exportBurnerSecretKey(window.localStorage);
              if (!secret) return;
              void navigator.clipboard.writeText(secret);
            }}
          >
            Export
          </Button>
          <Button
            cap="destructive"
            size="compact"
            icon={<Trash size={14} />}
            onClick={() => {
              resetBurnerSecretKey(window.localStorage);
              setSession(null);
            }}
          >
            Reset
          </Button>
        </>
      )}
      {error && <span className="status-err">{error}</span>}
      {showRpc && (
        <div className="panel" style={{ width: 'min(420px, 100%)' }}>
          <h3>External wallet RPC</h3>
          <p className="muted">
            Point Phantom or Solflare at this demo cluster. In the wallet, add a custom Solana network
            (localnet) and paste these endpoints.
          </p>
          <p className="mono">{urls.rpcUrl}</p>
          <p className="mono">{urls.wsUrl}</p>
        </div>
      )}
    </div>
  );
}
