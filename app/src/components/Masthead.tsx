/**
 * Masthead — the "Push USD" logo, primary nav, and wallet connect.
 *
 * Sits directly below the EditorialBand. Five-item nav mirrors the mockup
 * (HOME / CONVERT / RESERVES / ACTIVITY / DOCS). /convert is an alias to
 * /mint — the convert flow lives there, since mint and redeem each earn
 * their own dedicated route.
 *
 * On mobile the nav wraps to its own row and the address chip hides —
 * the connect button remains reachable.
 */

import { NavLink } from 'react-router-dom';
import { PushUniversalAccountButton } from '@pushchain/ui-kit';

const NAV = [
  { to: '/',        label: 'HOME',     end: true },
  { to: '/mint',    label: 'CONVERT' },
  { to: '/reserves', label: 'RESERVES' },
  { to: '/history', label: 'ACTIVITY' },
  { to: '/docs',    label: 'DOCS' },
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
