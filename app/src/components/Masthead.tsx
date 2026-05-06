/**
 * Masthead — the "Push USD" logo, primary nav, and wallet connect.
 *
 * Sits directly below the EditorialBand. The CONVERT nav link points to
 * /convert/mint — the convert flow lives at /convert with mint / redeem
 * sub-routes, and MINT is the landing tab. DOCS is now an internal route
 * to the in-app DocsPage, which indexes the protocol prose.
 *
 * On desktop the nav sits inline between the logo and the connect button.
 * On tablet/phone (≤900px) the nav collapses behind a hamburger that lives
 * after the CONNECT button and slides a drawer in from the right.
 */

import { PushUniversalAccountButton } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

type NavItem = { to: string; label: string; end?: boolean };

const NAV: readonly NavItem[] = [
  { to: '/',          label: 'HOME',      end: true },
  { to: '/convert',   label: 'CONVERT' },
  { to: '/reserves',  label: 'RESERVES' },
  { to: '/dashboard', label: 'DASHBOARD' },
  { to: '/docs',      label: 'DOCS' },
];

export function Masthead() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the drawer whenever the route changes — handles cases where the
  // user navigates via a link inside the drawer or via browser back.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't scroll when the user pans across the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  // Escape key dismisses the drawer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className="masthead">
      <div className="container masthead__inner">
        <NavLink to="/" className="masthead__logo" aria-label="Push USD — home">
          Push<em>USD</em>
        </NavLink>

        <nav className="masthead__nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="masthead__right">
          <PushUniversalAccountButton
            connectButtonText="CONNECT"
            modalAppOverride={{
              title: 'Push USD',
              description: 'Par-backed universal stablecoin on Push Chain.',
            }}
          />
          <button
            type="button"
            className="masthead__hamburger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="masthead-drawer"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`masthead__hamburger-icon${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {/* Drawer + backdrop. Always rendered so the slide-in transition has
       * something to animate; visibility is driven by the .is-open class. */}
      <div
        className={`masthead__drawer-backdrop${menuOpen ? ' is-open' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="masthead-drawer"
        className={`masthead__drawer${menuOpen ? ' is-open' : ''}`}
        aria-hidden={!menuOpen}
        aria-label="Mobile navigation"
      >
        <div className="masthead__drawer-head">
          <span className="masthead__drawer-eyebrow">§ MENU</span>
          <button
            type="button"
            className="masthead__drawer-close"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            ✕
          </button>
        </div>
        <nav className="masthead__drawer-nav" aria-label="Primary mobile">
          {NAV.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `masthead__drawer-link${isActive ? ' active' : ''}`
              }
              style={{ transitionDelay: menuOpen ? `${60 + i * 40}ms` : '0ms' }}
            >
              <span className="masthead__drawer-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="masthead__drawer-label">{item.label}</span>
              <span className="masthead__drawer-arrow" aria-hidden="true">→</span>
            </NavLink>
          ))}
        </nav>
        <div className="masthead__drawer-foot">
          <span className="meta-sm">PUSH USD · ISSUE 01</span>
          <span className="meta-sm">PAR-BACKED STABLECOIN</span>
        </div>
      </aside>
    </header>
  );
}
