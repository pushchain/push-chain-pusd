/**
 * App.tsx — top-level shell.
 *
 *   EditorialBand            ← VOL · NO · DATE | PEG | SUPPLY | RATIO | RESERVES | NETWORK
 *   Masthead                 ← logo + nav + connect
 *   Routes                   ← each page owns its own container / full-bleed layout
 *   Footer                   ← editorial colophon
 *
 * Routes:
 *   /           ReservesPage         — editorial home (narrative + reserves + dispatch)
 *   /mint       MintPage
 *   /redeem     RedeemPage
 *   /reserves   ReservesDetailPage   — focused book-of-reserves view
 *   /history    HistoryPage          — user activity
 *   /changelog  ChangelogPage        — editorial release notes
 *   *           → /
 *
 * /docs is an external link (pusd.push.org/docs) and is NOT handled in-app —
 * see Masthead for the anchor with target=_blank.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EditorialBand } from './components/EditorialBand';
import { Footer } from './components/Footer';
import { Masthead } from './components/Masthead';
import ChangelogPage from './pages/ChangelogPage';
import HistoryPage from './pages/HistoryPage';
import MintPage from './pages/MintPage';
import RedeemPage from './pages/RedeemPage';
import ReservesDetailPage from './pages/ReservesDetailPage';
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
            <Route path="/reserves" element={<ReservesDetailPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
