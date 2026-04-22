/**
 * useIsConnected — convenience hook wrapping `usePushWalletContext` to
 * return a plain boolean for "is the connected status CONNECTED?".
 *
 * Lives in its own file so Vite's fast-refresh only-export-components rule
 * stays happy — `ConnectedGate.tsx` should only export the component.
 */

import { PushUI, usePushWalletContext } from '@pushchain/ui-kit';

export function useIsConnected(): boolean {
  const { connectionStatus } = usePushWalletContext();
  return connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTED;
}
