/**
 * Masthead — the "Push USD" logo, primary nav, and wallet connect.
 *
 * Sits directly below the EditorialBand. The CONVERT nav link points to
 * /convert/mint — the convert flow lives at /convert with mint / redeem
 * sub-routes, and MINT is the landing tab. DOCS is now an internal route
 * to the in-app DocsPage, which indexes the protocol prose.
 *
 * On mobile the nav wraps to its own row and horizontally scrolls.
 */

import { PushUniversalAccountButton } from '@pushchain/ui-kit';
import { NavLink } from 'react-router-dom';

type NavItem = { to: string; label: string; end?: boolean };

const NAV: readonly NavItem[] = [
  { to: '/',          label: 'HOME',      end: true },
  { to: '/convert',   label: 'CONVERT' },
  { to: '/reserves',  label: 'RESERVES' },
  { to: '/dashboard', label: 'DASHBOARD' },
  { to: '/docs',      label: 'DOCS' },
];

export function Masthead() {
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
        </div>
      </div>
    </header>
  );
}
