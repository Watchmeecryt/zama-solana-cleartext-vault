import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { OverviewPage } from './pages/Overview.js';
import { FaucetPage } from './pages/Faucet.js';
import { DepositPage } from './pages/Deposit.js';
import { PortfolioPage } from './pages/Portfolio.js';
import { ActivityPage } from './pages/Activity.js';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="faucet" element={<FaucetPage />} />
        <Route path="deposit" element={<DepositPage />} />
        <Route path="portfolio" element={<PortfolioPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
