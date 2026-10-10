import { useState } from 'react';
import { Button } from '@unlocalhosted/metalui';
import { Eye, Recycle, Trophy } from '@phosphor-icons/react';
import { useSession } from '../session.js';
import { describeError, formatUsdc } from '../lib/format.js';
import { redeemShares, revealConfidentialBalance } from '../lib/flows.js';

export function PortfolioPage() {
  const { session } = useSession();
  const [cusdc, setCusdc] = useState<string | null>(null);
  const [shares, setShares] = useState<string | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('10');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!session) return <div className="form-card">Connect a wallet to view the portfolio.</div>;

  return (
    <div className="stack">
      <section className="form-card stack">
        <h2>Confidential balances</h2>
        <p className="muted">
          Decrypt cUSDC and vault shares with a cleartext user decrypt and permit. The value is
          computed locally from the host’s recorded plaintext.
        </p>
        <p>cUSDC: {cusdc ?? 'Hidden'}</p>
        <p>Vault shares: {shares ?? 'Hidden'}</p>
        <div className="row">
          <Button
            cap="primary"
            icon={<Eye size={16} />}
            state={busy === 'cusdc' ? 'waiting' : 'idle'}
            onClick={() => {
              setBusy('cusdc');
              setError(null);
              void revealConfidentialBalance(session, session.config.mints.joinConfidential, 'cUSDC')
                .then((value) => setCusdc(formatUsdc(value)))
                .catch((cause) => setError(describeError(cause)))
                .finally(() => setBusy(null));
            }}
          >
            Decrypt cUSDC
          </Button>
          <Button
            cap="primary"
            icon={<Eye size={16} />}
            state={busy === 'shares' ? 'waiting' : 'idle'}
            onClick={() => {
              setBusy('shares');
              setError(null);
              void revealConfidentialBalance(session, session.config.mints.payoutConfidential, 'cShares')
                .then((value) => setShares(formatUsdc(value)))
                .catch((cause) => setError(describeError(cause)))
                .finally(() => setBusy(null));
            }}
          >
            Decrypt shares
          </Button>
        </div>
      </section>

      <section className="form-card stack">
        <h2>Claim and redeem</h2>
        <p className="muted">
          Settled deposit batches are claimed by the keeper. To leave the vault, join a redeem batch
          with confidential shares.
        </p>
        <label className="field">
          <span>Shares to redeem</span>
          <input
            type="number"
            min="0.000001"
            value={redeemAmount}
            onChange={(event) => setRedeemAmount(event.target.value)}
          />
        </label>
        <div className="row">
          <Button cap="standard" icon={<Trophy size={16} />} onClick={() => setStatus('Claims are processed by the keeper after settlement.')}>
            Claim status
          </Button>
          <Button
            cap="primary"
            icon={<Recycle size={16} />}
            state={busy === 'redeem' ? 'waiting' : 'idle'}
            onClick={() => {
              setBusy('redeem');
              setError(null);
              void redeemShares(session, Number(redeemAmount))
                .then((signature) => setStatus(`Joined redeem batch · ${signature}`))
                .catch((cause) => setError(describeError(cause)))
                .finally(() => setBusy(null));
            }}
          >
            Redeem shares
          </Button>
        </div>
      </section>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="status-err">{error}</p>}
    </div>
  );
}
