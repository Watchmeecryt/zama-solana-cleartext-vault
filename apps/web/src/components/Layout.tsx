import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@unlocalhosted/metalui';
import { Drop, House, Vault, Wallet, ClockCounterClockwise } from '@phosphor-icons/react';
import { WalletBar } from './WalletBar.js';

const links = [
  { to: '/', label: 'Overview', icon: House, end: true },
  { to: '/faucet', label: 'Faucet / Shield', icon: Drop },
  { to: '/deposit', label: 'Deposit', icon: Vault },
  { to: '/portfolio', label: 'Portfolio', icon: Wallet },
  { to: '/activity', label: 'Activity', icon: ClockCounterClockwise },
] as const;

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <Vault size={22} weight="fill" />
          Confidential Vault
        </div>
        <nav className="app-nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={'end' in link ? link.end : false}>
              {({ isActive }) => (
                <Button cap={isActive ? 'primary' : 'standard'} icon={<link.icon size={16} />}>
                  {link.label}
                </Button>
              )}
            </NavLink>
          ))}
        </nav>
        <WalletBar />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
