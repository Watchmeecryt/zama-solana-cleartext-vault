import { useNavigate } from 'react-router-dom';
import { Button } from '@unlocalhosted/metalui';
import { ArrowRight, Drop, LockKey, Vault, Wallet } from '@phosphor-icons/react';

export function OverviewPage() {
  const navigate = useNavigate();
  return (
    <div className="stack">
      <section className="hero">
        <h1>A public vault with a confidential doorway</h1>
        <p>
          Deposit test USDC through a batch. Individual amounts stay encrypted on-chain. Only the
          batch total is revealed when the keeper settles, then you receive vault shares you can
          claim and later redeem.
        </p>
        <div className="caveat">
          This demo runs Zama’s Solana stack in cleartext mode: the host records plaintexts next to
          the encrypted handles so encrypt, compute, and decrypt work without a coprocessor or KMS.
          It is for local exploration, not production confidentiality.
        </div>
        <div className="row">
          <Button cap="primary" icon={<ArrowRight size={16} />} onClick={() => navigate('/faucet')}>
            Get test USDC
          </Button>
          <Button cap="standard" onClick={() => navigate('/deposit')}>
            Go to deposit
          </Button>
        </div>
      </section>
      <div className="card-grid">
        <article className="feature-card">
          <Drop size={24} color="#2563eb" />
          <h3>Faucet and shield</h3>
          <p className="muted">Mint test USDC, then wrap it to confidential cUSDC.</p>
        </article>
        <article className="feature-card">
          <Vault size={24} color="#2563eb" />
          <h3>Join a batch</h3>
          <p className="muted">Deposits wait together. The keeper dispatches and settles the total.</p>
        </article>
        <article className="feature-card">
          <LockKey size={24} color="#2563eb" />
          <h3>Cleartext decrypt</h3>
          <p className="muted">Reveal your cUSDC and vault shares with a user decrypt permit.</p>
        </article>
        <article className="feature-card">
          <Wallet size={24} color="#2563eb" />
          <h3>Claim and redeem</h3>
          <p className="muted">Claim settled shares, then redeem them back through the batcher.</p>
        </article>
      </div>
    </div>
  );
}
