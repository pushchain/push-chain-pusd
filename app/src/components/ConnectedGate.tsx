/**
 * ConnectedGate — empty state that shows when a surface needs a wallet.
 *
 * Opens the Push wallet modal via `handleConnectToPushWallet()`. Used by
 * `/history` and by the action buttons on `/mint` / `/redeem` when there
 * is no connected account.
 *
 * Optional `links` render as secondary navigation under the connect
 * button so users can bounce between Mint / Redeem / History without
 * connecting first.
 *
 * Note: `useIsConnected` lives in `hooks/useIsConnected.ts` so this file
 * only exports a component (Vite fast-refresh friendliness).
 */

import { NavLink } from 'react-router-dom';
import { PushUI, usePushWalletContext } from '@pushchain/ui-kit';
import type { ReactNode } from 'react';

type ConnectedGateProps = {
  title?: string;
  subtitle?: string;
  glyph?: string;
  links?: ReadonlyArray<{ to: string; label: string }>;
  children?: ReactNode;
};

export function ConnectedGate({
  title = 'CONNECT TO CONTINUE',
  subtitle = 'This surface needs a connected universal account.',
  glyph = '◌',
  links,
  children,
}: ConnectedGateProps) {
  const { connectionStatus, handleConnectToPushWallet } = usePushWalletContext();
  const connecting = connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTING;

  return (
    <div className="empty">
      <div className="empty__glyph" aria-hidden="true">{glyph}</div>
      <div className="empty__title">{title}</div>
      <div className="empty__sub">{subtitle}</div>

      <div className="empty__cta-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleConnectToPushWallet}
          disabled={connecting}
        >
          {connecting ? 'CONNECTING…' : 'CONNECT WALLET →'}
        </button>
        {links?.map((l) => (
          <NavLink key={l.to} to={l.to} className="btn btn--ghost">
            {l.label}
          </NavLink>
        ))}
      </div>

      {children}
    </div>
  );
}
