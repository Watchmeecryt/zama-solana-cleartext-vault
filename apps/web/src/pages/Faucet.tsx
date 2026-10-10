import { useState } from 'react';
import { Button } from '@unlocalhosted/metalui';
import { Drop, ShieldCheck } from '@phosphor-icons/react';
import { useSession } from '../session.js';
import { requestFaucet, requestUsdc } from '../lib/api.js';
import { describeError } from '../lib/format.js';
import { shieldUsdc } from '../lib/flows.js';

export function FaucetPage() {
  const { session } = useSession();
  const [usdcAmount, setUsdcAmount] = useState('1000');
  const [wrapAmount, setWrapAmount] = useState('100');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'faucet' | 'wrap' | null>(null);

  if (!session) {
    return <div className="form-card">Connect a wallet to use the faucet.</div>;
  }

  return (
    <div className="stack">
      <section className="form-card stack">
        <h2>Test USDC</h2>
        <p className="muted">Mint mock USDC to this wallet. The faucet also tops up SOL for fees.</p>
        <label className="field">
          <span>Amount</span>
          <input
            type="number"
            min="1"
            max="1000"
            value={usdcAmount}
            onChange={(event) => setUsdcAmount(event.target.value)}
          />
        </label>
        <Button
          cap="primary"
          icon={<Drop size={16} />}
          state={busy === 'faucet' ? 'waiting' : 'idle'}
          onClick={() => {
            setBusy('faucet');
            setError(null);
            void requestFaucet(session.signer.address, 1, Number(usdcAmount))
              .then(() => setStatus(`Received ${usdcAmount} test USDC`))
              .catch((cause) => setError(describeError(cause)))
              .finally(() => setBusy(null));
          }}
        >
          Request funds
        </Button>
      </section>

      <section className="form-card stack">
        <h2>Wrap to cUSDC</h2>
        <p className="muted">Move public USDC into confidential cUSDC so you can join a deposit batch.</p>
        <label className="field">
          <span>Amount to wrap</span>
          <input
            type="number"
            min="0.000001"
            max="1000"
            value={wrapAmount}
            onChange={(event) => setWrapAmount(event.target.value)}
          />
        </label>
        <Button
          cap="primary"
          icon={<ShieldCheck size={16} />}
          state={busy === 'wrap' ? 'waiting' : 'idle'}
          onClick={() => {
            setBusy('wrap');
            setError(null);
            void requestUsdc(session.signer.address, Number(wrapAmount))
              .then(() => shieldUsdc(session, Number(wrapAmount)))
              .then((signature) => setStatus(`Wrapped USDC · ${signature}`))
              .catch((cause) => setError(describeError(cause)))
              .finally(() => setBusy(null));
          }}
        >
          Wrap USDC
        </Button>
      </section>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="status-err">{error}</p>}
    </div>
  );
}
