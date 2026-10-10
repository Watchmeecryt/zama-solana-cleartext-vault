import { useEffect, useState } from 'react';
import { Button } from '@unlocalhosted/metalui';
import { Vault } from '@phosphor-icons/react';
import { createFinalizedRpc } from '@fhevm/solana-zama-host';
import { fetchSysvarClock } from '@solana/sysvars';
import { BatchStatus, dispatchableAt, getBatcher, getCurrentBatch, settleDeadline, vaultRoots } from '@zama-demo/kit';
import { useSession } from '../session.js';
import { depositToBatch } from '../lib/flows.js';
import { describeError, formatCountdown } from '../lib/format.js';

const statusCopy: Record<number, string> = {
  [BatchStatus.Pending]: 'Open — accepting deposits',
  [BatchStatus.Dispatched]: 'Dispatched — waiting for settlement',
  [BatchStatus.Settled]: 'Settled — claim shares in Portfolio',
  [BatchStatus.Canceled]: 'Canceled',
  [BatchStatus.Refunding]: 'Refunding — deposits are being returned',
};

export function DepositPage() {
  const { session } = useSession();
  const [amount, setAmount] = useState('50');
  const [status, setStatus] = useState<string>('Loading batch…');
  const [countdown, setCountdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const rpc = createFinalizedRpc(session.config.rpcUrl);
        const roots = vaultRoots(session.config, 'deposit');
        const batch = await getCurrentBatch(rpc, roots);
        const batcher = await getBatcher(rpc, roots.batcher);
        const { unixTimestamp } = await fetchSysvarClock(rpc);
        if (cancelled) return;
        setStatus(statusCopy[batch.state.status] ?? `Status ${batch.state.status}`);
        if (batch.state.status === BatchStatus.Pending) {
          const readyAt = dispatchableAt(batch.state, batcher);
          setCountdown(
            unixTimestamp >= readyAt
              ? 'Ready for dispatch'
              : `Dispatch in ${formatCountdown(readyAt - unixTimestamp)}`,
          );
        } else if (batch.state.status === BatchStatus.Dispatched) {
          const deadline = settleDeadline(batch.state, batcher);
          setCountdown(
            unixTimestamp >= deadline
              ? 'Settle deadline passed — refunds can start'
              : `Settle deadline ${formatCountdown(deadline - unixTimestamp)}`,
          );
        } else {
          setCountdown(`Batch ${batch.index.toString()}`);
        }
      } catch (cause) {
        if (!cancelled) setError(describeError(cause));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session]);

  if (!session) return <div className="form-card">Connect a wallet to deposit.</div>;

  return (
    <section className="form-card stack">
      <h2>Deposit into the vault</h2>
      <p className="muted">
        Join the current deposit batch with cUSDC. The keeper dispatches the batch after the minimum
        age, settles the total, and you claim vault shares from Portfolio.
      </p>
      <p className="status-ok">{status}</p>
      {countdown && <p className="status-wait">{countdown}</p>}
      <label className="field">
        <span>cUSDC amount</span>
        <input
          type="number"
          min="0.000001"
          max="1000"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <Button
        cap="primary"
        icon={<Vault size={16} />}
        state={busy ? 'waiting' : 'idle'}
        onClick={() => {
          setBusy(true);
          setError(null);
          void depositToBatch(session, Number(amount))
            .then((signature) => setResult(`Joined batch · ${signature}`))
            .catch((cause) => setError(describeError(cause)))
            .finally(() => setBusy(false));
        }}
      >
        Join batch
      </Button>
      {result && <p className="status-ok">{result}</p>}
      {error && <p className="status-err">{error}</p>}
    </section>
  );
}
