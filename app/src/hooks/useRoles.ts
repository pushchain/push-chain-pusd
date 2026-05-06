/**
 * useRoles — read AccessControl role membership for the connected account
 * across PUSDManager, PUSDPlusVault, and InsuranceFund.
 *
 * Returns a flat record of `<contract>_<role>` → boolean. Polls every 30s
 * (roles change rarely; mostly captured on connect / page focus).
 *
 * Used by `/admin` to gate which actions to expose. A connected user
 * with any role gets the role-specific section enabled; others see the
 * full menu but disabled with explanation.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import {
  PUSD_MANAGER_ADDRESS,
  PUSD_PLUS_ADDRESS,
  INSURANCE_FUND_ADDRESS,
} from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = ['function hasRole(bytes32, address) view returns (bool)'];
const POLL_MS = 30_000;

// Role hashes (keccak256 of role names; bytes32(0) for DEFAULT_ADMIN_ROLE)
const ROLE = {
  DEFAULT_ADMIN: '0x0000000000000000000000000000000000000000000000000000000000000000',
  // PUSD / PUSDManager
  ADMIN: ethers.id('ADMIN_ROLE'),
  UPGRADER: ethers.id('UPGRADER_ROLE'),
  MINTER: ethers.id('MINTER_ROLE'),
  BURNER: ethers.id('BURNER_ROLE'),
  // PUSDPlusVault
  V_MANAGER: ethers.id('PUSDPLUS_MANAGER_ROLE'),
  V_KEEPER: ethers.id('PUSDPLUS_KEEPER_ROLE'),
  V_POOL_ADMIN: ethers.id('PUSDPLUS_POOL_ADMIN_ROLE'),
  V_VAULT_ADMIN: ethers.id('PUSDPLUS_VAULT_ADMIN_ROLE'),
  V_GUARDIAN: ethers.id('PUSDPLUS_GUARDIAN_ROLE'),
  // InsuranceFund
  IF_VAULT_ADMIN: ethers.id('INSURANCE_FUND_VAULT_ADMIN_ROLE'),
  IF_GUARDIAN: ethers.id('INSURANCE_FUND_GUARDIAN_ROLE'),
} as const;

export type RolesState = {
  account: `0x${string}` | null;

  // PUSDManager
  managerDefaultAdmin: boolean;
  managerAdmin: boolean;
  managerUpgrader: boolean;

  // PUSDPlusVault
  vaultDefaultAdmin: boolean;
  vaultKeeper: boolean;
  vaultPoolAdmin: boolean;
  vaultVaultAdmin: boolean;
  vaultGuardian: boolean;

  // InsuranceFund
  ifDefaultAdmin: boolean;
  ifVaultAdmin: boolean;
  ifGuardian: boolean;

  // Derived
  hasAnyRole: boolean;

  loading: boolean;
  error: Error | null;
};

const EMPTY: Omit<RolesState, 'account'> = {
  managerDefaultAdmin: false,
  managerAdmin: false,
  managerUpgrader: false,
  vaultDefaultAdmin: false,
  vaultKeeper: false,
  vaultPoolAdmin: false,
  vaultVaultAdmin: false,
  vaultGuardian: false,
  ifDefaultAdmin: false,
  ifVaultAdmin: false,
  ifGuardian: false,
  hasAnyRole: false,
  loading: false,
  error: null,
};

export function useRoles(): RolesState {
  const { pushChainClient } = usePushChainClient();
  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;

  const [state, setState] = useState<RolesState>({ ...EMPTY, account, loading: !!account });

  useEffect(() => {
    if (!account) {
      setState({ ...EMPTY, account: null, loading: false });
      return;
    }
    let cancelled = false;

    const read = async () => {
      try {
        const provider = getReadProvider();
        const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, ABI, provider);
        const vault = new ethers.Contract(PUSD_PLUS_ADDRESS, ABI, provider);
        const ifund = new ethers.Contract(INSURANCE_FUND_ADDRESS, ABI, provider);

        const [
          mDefaultAdmin,
          mAdmin,
          mUpgrader,
          vDefaultAdmin,
          vKeeper,
          vPoolAdmin,
          vVaultAdmin,
          vGuardian,
          ifDefaultAdmin,
          ifVaultAdmin,
          ifGuardian,
        ] = await Promise.all([
          manager.hasRole(ROLE.DEFAULT_ADMIN, account),
          manager.hasRole(ROLE.ADMIN, account),
          manager.hasRole(ROLE.UPGRADER, account),
          vault.hasRole(ROLE.DEFAULT_ADMIN, account),
          vault.hasRole(ROLE.V_KEEPER, account),
          vault.hasRole(ROLE.V_POOL_ADMIN, account),
          vault.hasRole(ROLE.V_VAULT_ADMIN, account),
          vault.hasRole(ROLE.V_GUARDIAN, account),
          ifund.hasRole(ROLE.DEFAULT_ADMIN, account),
          ifund.hasRole(ROLE.IF_VAULT_ADMIN, account),
          ifund.hasRole(ROLE.IF_GUARDIAN, account),
        ]);

        if (cancelled) return;

        const next = {
          account,
          managerDefaultAdmin: !!mDefaultAdmin,
          managerAdmin: !!mAdmin,
          managerUpgrader: !!mUpgrader,
          vaultDefaultAdmin: !!vDefaultAdmin,
          vaultKeeper: !!vKeeper,
          vaultPoolAdmin: !!vPoolAdmin,
          vaultVaultAdmin: !!vVaultAdmin,
          vaultGuardian: !!vGuardian,
          ifDefaultAdmin: !!ifDefaultAdmin,
          ifVaultAdmin: !!ifVaultAdmin,
          ifGuardian: !!ifGuardian,
          loading: false,
          error: null,
        };

        const hasAnyRole =
          next.managerDefaultAdmin ||
          next.managerAdmin ||
          next.managerUpgrader ||
          next.vaultDefaultAdmin ||
          next.vaultKeeper ||
          next.vaultPoolAdmin ||
          next.vaultVaultAdmin ||
          next.vaultGuardian ||
          next.ifDefaultAdmin ||
          next.ifVaultAdmin ||
          next.ifGuardian;

        setState({ ...next, hasAnyRole });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read roles'),
        }));
      }
    };

    setState((prev) => ({ ...prev, account, loading: true }));
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account]);

  return state;
}
