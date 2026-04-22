import { PushUniversalAccountButton } from "@pushchain/ui-kit";
import { useState } from "react";
import { DashboardTab } from "./components/DashboardTab";
import { InfoTab } from "./components/InfoTab";
import { MintTab } from "./components/MintTab";
import { RedeemTab } from "./components/RedeemTab";

type Tab = 'overview' | 'mint' | 'redeem' | 'dashboard';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview',   label: 'Overview',   icon: '◈' },
  { id: 'mint',       label: 'Mint',        icon: '⊕' },
  { id: 'redeem',     label: 'Redeem',      icon: '⊖' },
  { id: 'dashboard',  label: 'Dashboard',   icon: '◉' },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>

      {/* ── Navbar ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        backgroundColor: 'rgba(10,11,15,0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #4f8ef7 0%, #7c5ff7 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 16, color: '#fff', letterSpacing: '-0.5px',
              boxShadow: '0 0 16px rgba(79,142,247,0.4)',
            }}>P$</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px' }}>PUSD</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.2 }}>Universal Stablecoin</div>
            </div>
          </div>

          {/* Tab nav */}
          <nav style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center' }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  position: 'relative',
                  padding: '8px 20px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'color 0.15s',
                  borderRadius: 8,
                }}
                onMouseEnter={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
              >
                <span style={{ marginRight: 6, fontSize: 12, opacity: 0.8 }}>{tab.icon}</span>
                {tab.label}
                {activeTab === tab.id && (
                  <span style={{
                    position: 'absolute', bottom: -1, left: '20%', right: '20%',
                    height: 2, background: 'var(--accent)', borderRadius: '2px 2px 0 0',
                  }} />
                )}
              </button>
            ))}
          </nav>

          {/* Wallet button */}
          <div style={{ flexShrink: 0 }}>
            <PushUniversalAccountButton
              connectButtonText="Connect Wallet"
              themeOverrides={{
                '--pwauth-btn-connect-bg-color': '#4f8ef7',
                '--pwauth-btn-connect-border-radius': '10px',
                '--pwauth-btn-connected-bg-color': '#1e2330',
              }}
            />
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px 80px' }}>
        {activeTab === 'overview'   && <InfoTab />}
        {activeTab === 'mint'       && <MintTab />}
        {activeTab === 'redeem'     && <RedeemTab />}
        {activeTab === 'dashboard'  && <DashboardTab />}
      </main>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', padding: '24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto',
          display: 'flex', flexWrap: 'wrap', gap: 16,
          alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, color: 'var(--text-muted)' }}>
          <span>© 2025 PUSD · Universal stablecoin on Push Chain</span>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { label: 'Explorer', href: 'https://donut.push.network' },
              { label: 'Push Docs', href: 'https://docs.push.org' },
            ].map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--text-muted)', transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'}
              >{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
