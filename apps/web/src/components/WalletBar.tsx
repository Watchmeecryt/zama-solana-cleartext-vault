import { useEffect, useRef, useState } from 'react';
import { Button, Menu, MenuItem, MenuSeparator, Tooltip, TooltipProvider } from '@unlocalhosted/metalui';
import { useWallets } from '@wallet-standard/react';
import { Copy, Export, HardDrives, Plugs, Trash, Wallet } from '@phosphor-icons/react';
import { shortAddress } from '../lib/format.js';
import { useSession } from '../session.js';
import {
  connectBurnerSession,
  connectExternalSession,
  connectExternalWallet,
  disconnectStandardWallet,
  readWalletPreference,
  signsVersion1Transactions,
  subscribeStandardWalletEvents,
  writeWalletPreference,
} from '../wallet/session.js';
import { exportBurnerSecretKey, resetBurnerSecretKey } from '../wallet/burner.js';
import { publicRpcUrls } from '../lib/api.js';
import { getOrCreateUiWalletAccountForStandardWalletAccount, getWalletForHandle } from '@wallet-standard/ui-registry';

const UNSUPPORTED_WALLET_HINT = "this wallet can't sign v1 transactions";

export function WalletBar() {
  const { session, setSession } = useSession();
  const wallets = useWallets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const restoreStarted = useRef(false);

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const run = (work: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void work.catch(fail).finally(() => setBusy(false));
  };

  useEffect(() => {
    if (session || restoreStarted.current) return;
    const preference = readWalletPreference();
    if (preference === 'none') {
      restoreStarted.current = true;
      return;
    }
    if (preference === 'burner') {
      restoreStarted.current = true;
      setBusy(true);
      setError(null);
      void connectBurnerSession().then(setSession).catch(fail).finally(() => setBusy(false));
      return;
    }
    const wallet = wallets.find((item) => item.name === preference);
    if (!wallet) return;
    restoreStarted.current = true;
    setBusy(true);
    setError(null);
    void connectExternalWallet(wallet, { silent: true }).then(setSession).catch(fail).finally(() => setBusy(false));
  }, [session, setSession, wallets]);

  useEffect(() => {
    if (!session || session.wallet.kind !== 'wallet-standard') return;
    const wallet = wallets.find((item) => item.name === session.wallet.name);
    if (!wallet) return;
    return subscribeStandardWalletEvents(wallet, (properties) => {
      if (!properties.accounts) return;
      if (properties.accounts.length === 0) {
        writeWalletPreference('none');
        setSession(null);
        return;
      }
      const next = properties.accounts[0];
      if (!next || next.address === session.signer.address) return;
      const account = getOrCreateUiWalletAccountForStandardWalletAccount(getWalletForHandle(wallet), next);
      run(connectExternalSession(account, wallet.name).then(setSession));
    });
  }, [session, setSession, wallets]);

  const connectBurner = () => {
    setMenuOpen(false);
    run(connectBurnerSession().then(setSession));
  };

  const connectExternal = (walletName: string) => {
    const wallet = wallets.find((item) => item.name === walletName);
    if (!wallet) {
      setError(`${walletName} is not available`);
      return;
    }
    setMenuOpen(false);
    run(connectExternalWallet(wallet).then(setSession));
  };

  const disconnect = () => {
    const walletName = session?.wallet.kind === 'wallet-standard' ? session.wallet.name : null;
    writeWalletPreference('none');
    setSession(null);
    setError(null);
    if (walletName) {
      const wallet = wallets.find((item) => item.name === walletName);
      if (wallet) void disconnectStandardWallet(wallet).catch(() => undefined);
    }
  };

  const urls = publicRpcUrls();

  return (
    <TooltipProvider>
      <div className="wallet-box">
        {session ? (
          <span className="muted mono">
            {session.wallet.name} · {shortAddress(session.signer.address)}
          </span>
        ) : (
          <span className="muted">{busy ? 'Connecting…' : 'No wallet'}</span>
        )}
        {!session && (
          <Menu
            heading="Connect wallet"
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <Button cap="standard" size="compact" icon={<Wallet size={14} />} disabled={busy}>
                Connect wallet
              </Button>
            }
          >
            <MenuItem icon={<HardDrives size={14} />} onSelect={connectBurner}>
              Built-in wallet
            </MenuItem>
            {wallets.length > 0 && <MenuSeparator />}
            {wallets.map((wallet) => {
              const supported = signsVersion1Transactions(wallet);
              if (supported) {
                return (
                  <MenuItem key={wallet.name} onSelect={() => connectExternal(wallet.name)}>
                    {wallet.name}
                  </MenuItem>
                );
              }
              return (
                <Tooltip key={wallet.name} label={UNSUPPORTED_WALLET_HINT} wrap>
                  <span className="wallet-disabled-hit">
                    <MenuItem disabled>{wallet.name}</MenuItem>
                  </span>
                </Tooltip>
              );
            })}
          </Menu>
        )}
        {session && (
          <Button cap="standard" size="compact" icon={<Plugs size={14} />} onClick={disconnect}>
            Disconnect
          </Button>
        )}
        {session?.wallet.kind === 'wallet-standard' && (
          <span className="wallet-rpc-hint">
            Add custom RPC <span className="mono">{urls.rpcUrl}</span> in your wallet
            <Tooltip label={copied ? 'Copied' : 'Copy RPC URL'}>
              <Button
                cap="standard"
                size="compact"
                iconOnly
                icon={<Copy size={14} />}
                aria-label="Copy RPC URL"
                onClick={() => {
                  void navigator.clipboard.writeText(urls.rpcUrl).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  });
                }}
              />
            </Tooltip>
          </span>
        )}
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
                writeWalletPreference('burner');
                setSession(null);
                restoreStarted.current = false;
              }}
            >
              Reset
            </Button>
          </>
        )}
        {error && <span className="status-err">{error}</span>}
      </div>
    </TooltipProvider>
  );
}
