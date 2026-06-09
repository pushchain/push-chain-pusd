import { usePushWalletContext } from '@pushchain/ui-kit';
import { type PUSDSigner } from '../lib/questWebhook';

export function useSignMessage(): PUSDSigner | undefined {
  const { universalAccount, handleSignMessage } = usePushWalletContext();
  if (!universalAccount?.address || typeof handleSignMessage !== 'function') return undefined;
  return {
    address: universalAccount.address,
    chain: universalAccount.chain ?? 'eip155:42101',
    sign: handleSignMessage,
  };
}
