/**
 * App.tsx — top-level shell: Masthead, InvariantRibbon, routed outlet, Footer.
 *
 * Four routes (§3 of v1-frontend-plan):
 *   /         ReservesPage  (default)
 *   /mint     MintPage
 *   /redeem   RedeemPage
 *   /history  HistoryPage
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Footer } from './components/Footer';
import { InvariantRibbon } from './components/InvariantRibbon';
import { Masthead } from './components/Masthead';
import HistoryPage from './pages/HistoryPage';
import MintPage from './pages/MintPage';
import RedeemPage from './pages/RedeemPage';
import ReservesPage from './pages/ReservesPage';

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Masthead />
        <InvariantRibbon />
        <main className="container">
          <Routes>
            <Route path="/" element={<ReservesPage />} />
            <Route path="/mint" element={<MintPage />} />
            <Route path="/redeem" element={<RedeemPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
