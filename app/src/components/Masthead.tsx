/**
 * Masthead — brutalist wordmark, subtitle, nav, connect pill.
 *
 * Scrolls off (not sticky — §4 of v1-frontend-plan). Sits above the
 * InvariantRibbon which handles its own stickiness.
 */

import { NavLink } from 'react-router-dom';
import { PushUniversalAccountButton } from '@pushchain/ui-kit';

const NAV = [
  { to: '/', label: 'RESERVES', end: true },
  { to: '/mint', label: 'MINT' },
  { to: '/redeem', label: 'REDEEM' },
  { to: '/history', label: 'HISTORY' },
];

export function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <div className="masthead__wordmark">
          <div className="masthead__logo">
            PUSD <em>— Push USD / issue 001</em>
          </div>
          <div className="masthead__sub">
            A par-backed universal stablecoin on Push Chain
          </div>
        </div>

        <div className="masthead__right">
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

          <PushUniversalAccountButton
            connectButtonText="CONNECT WALLET"
            modalAppOverride={{
              title: 'PUSD',
              description: 'Par-backed universal stablecoin on Push Chain.',
            }}
          />
        </div>
      </div>
    </header>
  );
}
