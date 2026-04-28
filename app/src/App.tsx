/**
 * App.tsx — top-level shell.
 *
 *   EditorialBand            ← VOL · NO · DATE | PEG | SUPPLY | RATIO | RESERVES | NETWORK
 *   Masthead                 ← logo + nav + connect
 *   Routes                   ← each page owns its own container / full-bleed layout
 *   Footer                   ← editorial colophon
 *
 * Routes:
 *   /                   HomePage             — editorial home (narrative + reserves + dispatch)
 *   /convert            → /convert/mint
 *   /convert/mint       ConvertPage (mint tab)
 *   /convert/redeem     ConvertPage (redeem tab)
 *   /mint               → /convert/mint   (legacy)
 *   /redeem             → /convert/redeem (legacy)
 *   /reserves           ReservesDetailPage   — focused book-of-reserves view
 *   /history            HistoryPage          — user activity
 *   /docs               DocsPage             — designed index of the protocol docs
 *   *                   → /
 *
 * Long-form prose still lives in /docs/*.md in the repository; DocsPage
 * is the in-app entry point that surfaces the structure.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EditorialBand } from './components/EditorialBand';
import { Footer } from './components/Footer';
import { Masthead } from './components/Masthead';
import ConvertPage from './pages/ConvertPage';
import DocsPage from './pages/DocsPage';
import HistoryPage from './pages/HistoryPage';
import HomePage from './pages/HomePage';
import ReservesDetailPage from './pages/ReservesDetailPage';
import StyleDemoPage from './pages/StyleDemoPage';

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <EditorialBand />
        <Masthead />
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/convert" element={<Navigate to="/convert/mint" replace />} />
            <Route path="/convert/:mode" element={<ConvertPage />} />
            <Route path="/mint" element={<Navigate to="/convert/mint" replace />} />
            <Route path="/redeem" element={<Navigate to="/convert/redeem" replace />} />
            <Route path="/reserves" element={<ReservesDetailPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/docs" element={<DocsPage />} />
            {/* <Route path="/style-demo" element={<StyleDemoPage />} /> */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
