/**
 * Masthead — the "Push USD" logo, primary nav, and wallet connect.
 *
 * Sits directly below the EditorialBand. /docs is an EXTERNAL link (pusd.push.org/docs)
 * rendered as a plain anchor so the in-app router never tries to match it.
 * The CONVERT nav link points to /convert/mint — the convert flow lives
 * at /convert with mint / redeem sub-routes, and MINT is the landing tab.
 *
 * On mobile the nav wraps to its own row and horizontally scrolls.
 */

import { PushUniversalAccountButton } from '@pushchain/ui-kit';
import { NavLink } from 'react-router-dom';

const DOCS_URL = 'https://push.org/docs';

type InternalLink = { to: string; label: string; end?: boolean; external?: false };
type ExternalLink = { href: string; label: string; external: true };
type NavItem = InternalLink | ExternalLink;

const NAV: readonly NavItem[] = [
  { to: '/',          label: 'HOME',      end: true },
  { to: '/convert',   label: 'CONVERT' },
  { to: '/reserves',  label: 'RESERVES' },
  { to: '/history',   label: 'ACTIVITY' },
  { href: DOCS_URL,   label: 'DOCS ↗',    external: true },
];

export function Masthead() {
  return (
    <header className="masthead">
      <div className="container masthead__inner">
        <NavLink to="/" className="masthead__logo" aria-label="Push USD — home">
          Push<em>USD</em>
        </NavLink>

        <nav className="masthead__nav" aria-label="Primary">
          {NAV.map((item) =>
            item.external ? (
              <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ),
          )}
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
