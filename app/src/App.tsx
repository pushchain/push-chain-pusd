/**
 * App.tsx — top-level shell.
 *
 *   EditorialBand            ← VOL · NO · DATE | BLOCK · LATENCY
 *   Masthead                 ← logo + nav + connect
 *   Routes                   ← each page owns its own container / full-bleed layout
 *   Footer                   ← editorial colophon
 *
 * The InvariantRibbon is no longer mounted globally — solvency status is
 * surfaced by the Ticker on the editorial home and by the CTA state inside
 * MintCard / RedeemCard. Keeping a global ribbon made the page feel crowded
 * on top of the EditorialBand.
 *
 * Routes:
 *   /          ReservesPage  — editorial home
 *   /mint      MintPage
 *   /redeem    RedeemPage
 *   /reserves  alias → ReservesPage
 *   /history   HistoryPage
 *   *          → /
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EditorialBand } from './components/EditorialBand';
import { Footer } from './components/Footer';
import { Masthead } from './components/Masthead';
import HistoryPage from './pages/HistoryPage';
import MintPage from './pages/MintPage';
import RedeemPage from './pages/RedeemPage';
import ReservesPage from './pages/ReservesPage';

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <EditorialBand />
        <Masthead />
        <main>
          <Routes>
            <Route path="/" element={<ReservesPage />} />
            <Route path="/mint" element={<MintPage />} />
            <Route path="/redeem" element={<RedeemPage />} />
            <Route path="/reserves" element={<ReservesPage />} />
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
