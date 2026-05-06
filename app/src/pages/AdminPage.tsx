/**
 * AdminPage — /admin route. Surfaces protocol admin actions gated by the
 * connected account's AccessControl roles.
 *
 * Layout:
 *   1. Header — connected account + role badges
 *   2. Per-role sections — actions enabled if the wallet has the role
 *      (otherwise rendered with a clear "missing role" disabled state)
 *   3. Permissionless section — public-callable functions (`rebalance` after
 *      cooldown, `fulfillQueueClaim`)
 *
 * Every action goes through `pushChainClient.universal.sendTransaction`
 * — same dispatch as ConvertPanel. Status states: idle → signing →
 * broadcasting → confirmed | error.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { ConnectedGate } from '../components/ConnectedGate';
import {
  PUSD_MANAGER_ADDRESS,
  PUSD_PLUS_ADDRESS,
  INSURANCE_FUND_ADDRESS,
} from '../contracts/config';
import { TOKENS } from '../contracts/tokens';
import { useRoles } from '../hooks/useRoles';
import { useNAV } from '../hooks/useNAV';
import { useVaultBook } from '../hooks/useVaultBook';
import { useVaultPoolMeta } from '../hooks/useVaultPoolMeta';
import { formatAmount } from '../lib/format';

// Selectors / function fragments — minimal so we don't pull a full ABI here.
// Reads encoded via ethers Interface for type safety.
const MANAGER_ABI = new ethers.Interface([
  'function setBaseFee(uint256)',
  'function setSurplusHaircutBps(address, uint16)',
  'function setTokenStatus(address, uint8)',
  'function setFeeExempt(address, bool)',
  'function setPlusVault(address)',
  'function setTreasuryReserve(address)',
  'function sweepAllSurplus(address)',
  'function sweepSurplus(address token, address treasury)',
  'function addSupportedToken(address token, string name, string namespace, uint8 decimals)',
  'function setPreferredFeeRange(uint16 minBps, uint16 maxBps)',
  'function rebalance(address tokenIn, uint256 amountIn, address tokenOut)',
]);

const VAULT_ABI = new ethers.Interface([
  'function rebalance()',
  'function setHaircutBps(uint16)',
  'function setMaxDeploymentBps(uint16)',
  'function setUnwindCapBps(uint16)',
  'function setPublicRebalanceCooldown(uint32)',
  'function addBasketToken(address)',
  'function removeBasketToken(address)',
  'function setFeeTierAllowed(uint24 fee, bool allowed)',
  'function setDefaultFeeTier(uint24 fee)',
  'function setDefaultTickRange(int24 lower, int24 upper)',
  // Mint params come from Uniswap V3 NPM. Encoded as a tuple.
  'function openPool((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) p)',
  'function closePool(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, uint256 deadline)',
  'function pause()',
  'function unpause()',
  'function redeemPusdForToken(uint256, address)',
  'function topUpPosition(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)',
  'function rebalanceBounded(uint256 startIdx, uint256 count)',
  'function setDefaultFeeTier(uint24 fee)',
  'function setMinBootstrapSize(uint256 amount)',
  'function setTopUpThreshold(uint256 amount)',
  'function setInstantFloorPusd(uint256 amount)',
  'function setInsuranceFund(address ifAddr)',
]);

// Uniswap V3 NPM — only the call we need to expose for pool creation.
const NPM_ABI = new ethers.Interface([
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) returns (address pool)',
]);

const IF_ABI = new ethers.Interface([
  'function pause()',
  'function unpause()',
  'function withdraw(address, address, uint256)',
]);

type TxStage =
  | { kind: 'idle' }
  | { kind: 'signing'; label: string }
  | { kind: 'broadcasting'; hash: `0x${string}`; label: string }
  | { kind: 'confirmed'; hash: `0x${string}`; label: string }
  | { kind: 'error'; message: string };

export default function AdminPage() {
  const { pushChainClient } = usePushChainClient();
  const roles = useRoles();
  const nav = useNAV();
  const vault = useVaultBook();
  const poolMeta = useVaultPoolMeta();
  const [stage, setStage] = useState<TxStage>({ kind: 'idle' });

  const account = roles.account;

  async function send(label: string, to: string, data: string) {
    if (!pushChainClient) return;
    try {
      setStage({ kind: 'signing', label });
      const tx = await pushChainClient.universal.sendTransaction({
        to,
        value: 0n,
        data,
      });
      const hash = tx.hash as `0x${string}`;
      setStage({ kind: 'broadcasting', hash, label });
      await tx.wait();
      setStage({ kind: 'confirmed', hash, label });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Transaction failed';
      setStage({ kind: 'error', message: message.slice(0, 240) });
    }
  }

  if (!account) {
    return (
      <div className="container">
        <ConnectedGate
          title="CONNECT TO CONTINUE"
          subtitle="This page surfaces protocol admin actions on PUSDManager, PUSDPlusVault, and InsuranceFund based on what your wallet is authorised to do. Connect via the CONNECT button in the masthead, then we'll show role-gated actions plus public ones (rebalance after cooldown, fulfillQueueClaim)."
          glyph="ADMIN"
        />
      </div>
    );
  }

  const sections = [
    { id: 'keeper',        num: 'i.',   title: 'Keeper',        held: roles.vaultKeeper },
    { id: 'vault-admin',   num: 'ii.',  title: 'Vault Admin',   held: roles.vaultVaultAdmin },
    { id: 'pool-admin',    num: 'iii.', title: 'Pool Admin',    held: roles.vaultPoolAdmin },
    { id: 'guardian',      num: 'iv.',  title: 'Guardian',      held: roles.vaultGuardian || roles.ifGuardian },
    { id: 'manager-admin', num: 'v.',   title: 'Manager Admin', held: roles.managerAdmin },
    { id: 'default-admin', num: 'vi.',  title: 'Default Admin', held: roles.managerDefaultAdmin || roles.vaultDefaultAdmin || roles.ifDefaultAdmin },
    { id: 'public',        num: 'vii.', title: 'Public',        held: true },
  ];

  return (
    <>
      <section className="hero hero--compact">
        <div className="container">
          <div className="hero__kicker">
            <span style={{ color: 'var(--c-magenta)' }}>§ ADMIN · ROLE-GATED OPERATIONS</span>
            <span>LIVE · {roles.hasAnyRole ? 'AUTHORISED' : 'NO ROLES'}</span>
          </div>
          <h1 className="hero__title" style={{ fontSize: 'clamp(44px, 5.5vw, 72px)' }}>
            Operate the <em>protocol</em>.
          </h1>
          <p className="hero__lead" style={{ maxWidth: '72ch' }}>
            Every state-changing function on PUSDManager, PUSDPlusVault, and InsuranceFund — grouped by the role that authorises it. Sections you can't act on stay visible and indexed; their cards are disabled.
          </p>
          <div className="meta-sm" style={{ marginTop: 24 }}>
            ACCOUNT <span className="mono">{account}</span>
          </div>
          <RoleBadgeStrip roles={roles} />
        </div>
      </section>

      <section className="section-rail">
        <div className="container">
          <nav className="section-rail__inner" aria-label="Admin sections">
            {sections.map(({ id, num, title, held }) => (
              <a
                key={id}
                href={`#${id}`}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: held ? 'var(--c-ink)' : 'var(--c-ink-mute)',
                  textDecoration: 'none',
                  padding: '5px 12px',
                  border: 'var(--rule-thin)',
                  marginRight: 6,
                  marginBottom: 4,
                  background: held ? 'transparent' : 'transparent',
                  transition: 'background 120ms, color 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--c-ink)';
                  e.currentTarget.style.color = 'var(--c-cream)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = held ? 'var(--c-ink)' : 'var(--c-ink-mute)';
                }}
              >
                <span style={{ color: 'var(--c-magenta)', marginRight: 8 }}>{num}</span>
                {title}
                <span style={{ marginLeft: 8, color: held ? 'var(--c-jade)' : 'var(--c-ink-mute)' }}>
                  {held ? '✓' : '—'}
                </span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      {stage.kind !== 'idle' && (
        <div className="container">
          <section className="section">
            <TxStatus stage={stage} />
          </section>
        </div>
      )}

      <div className="container">
        {!roles.hasAnyRole && (
          <div className="feedback feedback--warn" style={{ marginTop: 24 }}>
            <div className="feedback__title">NO ADMIN ROLES DETECTED</div>
            <div className="feedback__body">
              The connected account doesn't hold any role on PUSDManager,
              PUSDPlusVault, or InsuranceFund. You can still call
              public-permissionless actions in chapter <em>vii.</em> (rebalance after cooldown).
            </div>
          </div>
        )}

      {/* ============= KEEPER ============= */}
      <Section
        id="keeper"
        num="i."
        title="Keeper"
        subtitle="Harvest LP fees, convert idle reserves, top up positions."
        roleHeld={roles.vaultKeeper}
        roleLabel="PUSDPLUS_KEEPER_ROLE on vault"
      >
        <PoolStatusCard meta={poolMeta} vault={vault} />
        <ActionCard
          title="rebalance()"
          description="Walk vault.positionIds, collect uncollected V3 fees, apply haircut to InsuranceFund. KEEPER bypasses cooldown; everyone else is gated."
          enabled={!!pushChainClient}
          onClick={() => send('vault.rebalance', PUSD_PLUS_ADDRESS!, VAULT_ABI.encodeFunctionData('rebalance', []))}
          buttonLabel="Rebalance"
        />
        <RedeemPusdForTokenCard
          enabled={roles.vaultKeeper}
          onSend={(pusdIn, token) =>
            send(
              `vault.redeemPusdForToken(${pusdIn}, ${token})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('redeemPusdForToken', [pusdIn, token]),
            )
          }
        />
        <TopUpPositionCard
          enabled={roles.vaultKeeper}
          meta={poolMeta}
          onSend={(tokenId, a0, a1, m0, m1, deadline) =>
            send(
              `vault.topUpPosition(${tokenId})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('topUpPosition', [
                tokenId,
                a0,
                a1,
                m0,
                m1,
                deadline,
              ]),
            )
          }
        />
        <RebalanceBoundedCard
          enabled={roles.vaultKeeper}
          meta={poolMeta}
          onSend={(start, count) =>
            send(
              `vault.rebalanceBounded(${start}, ${count})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('rebalanceBounded', [start, count]),
            )
          }
        />
      </Section>

      {/* ============= VAULT_ADMIN ============= */}
      <Section
        id="vault-admin"
        num="ii."
        title="Vault Admin"
        subtitle="Vault knobs — every setter is bounded by an on-chain hard cap."
        roleHeld={roles.vaultVaultAdmin}
        roleLabel="PUSDPLUS_VAULT_ADMIN_ROLE on vault"
      >
        <BpsSetterCard
          title="setHaircutBps"
          description="Skim from harvested LP fees → InsuranceFund. Cap MAX_HAIRCUT_BPS = 500 (5%)."
          maxBps={500}
          enabled={roles.vaultVaultAdmin}
          onSend={(bps) =>
            send(
              `vault.setHaircutBps(${bps})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setHaircutBps', [bps]),
            )
          }
        />
        <BpsSetterCard
          title="setMaxDeploymentBps"
          description="Soft cap on % of TVL deployed in LP. Cap MAX_DEPLOYMENT_CAP_BPS = 8500 (85%)."
          maxBps={8500}
          enabled={roles.vaultVaultAdmin}
          onSend={(bps) =>
            send(
              `vault.setMaxDeploymentBps(${bps})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setMaxDeploymentBps', [bps]),
            )
          }
        />
        <SecondsSetterCard
          title="setPublicRebalanceCooldown"
          description="v2.1 — gate non-KEEPER rebalance callers. Cap MAX_REBALANCE_COOLDOWN = 86400s (24h)."
          maxSeconds={86400}
          enabled={roles.vaultVaultAdmin}
          onSend={(secs) =>
            send(
              `vault.setPublicRebalanceCooldown(${secs})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setPublicRebalanceCooldown', [secs]),
            )
          }
        />
        <FeeTierAllowedCard
          enabled={roles.vaultVaultAdmin}
          onSend={(fee, allowed) =>
            send(
              `vault.setFeeTierAllowed(${fee}, ${allowed})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setFeeTierAllowed', [fee, allowed]),
            )
          }
        />
        <DefaultTickRangeCard
          enabled={roles.vaultVaultAdmin}
          onSend={(lower, upper) =>
            send(
              `vault.setDefaultTickRange(${lower}, ${upper})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setDefaultTickRange', [lower, upper]),
            )
          }
        />
        <DefaultFeeTierCard
          enabled={roles.vaultVaultAdmin}
          meta={poolMeta}
          onSend={(fee) =>
            send(
              `vault.setDefaultFeeTier(${fee})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setDefaultFeeTier', [fee]),
            )
          }
        />
        <BpsSetterCard
          title="setUnwindCapBps"
          description="Share of deployed value redeemable per tx. Range 100–5000 bps. Currently 500."
          maxBps={5000}
          enabled={roles.vaultVaultAdmin}
          onSend={(bps) =>
            send(
              `vault.setUnwindCapBps(${bps})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setUnwindCapBps', [bps]),
            )
          }
        />
        <PusdAmountSetterCard
          title="setMinBootstrapSize"
          description="Min idle per side (PUSD-equivalent, 6dp) for the keeper to auto-open a pool."
          enabled={roles.vaultVaultAdmin}
          onSend={(amt) =>
            send(
              `vault.setMinBootstrapSize(${amt})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setMinBootstrapSize', [amt]),
            )
          }
        />
        <PusdAmountSetterCard
          title="setTopUpThreshold"
          description="Idle PUSD threshold (6dp) above which the keeper tops up the leading position."
          enabled={roles.vaultVaultAdmin}
          onSend={(amt) =>
            send(
              `vault.setTopUpThreshold(${amt})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setTopUpThreshold', [amt]),
            )
          }
        />
        <PusdAmountSetterCard
          title="setInstantFloorPusd"
          description="Redeems below this floor (6dp) skip throttling and pay instantly when liquid."
          enabled={roles.vaultVaultAdmin}
          onSend={(amt) =>
            send(
              `vault.setInstantFloorPusd(${amt})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setInstantFloorPusd', [amt]),
            )
          }
        />
        <AddressSetterCard
          title="setInsuranceFund"
          description="Address that receives the LP-fee haircut. Must be non-zero."
          enabled={roles.vaultVaultAdmin}
          onSend={(addr) =>
            send(
              `vault.setInsuranceFund(${addr})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('setInsuranceFund', [addr]),
            )
          }
        />
      </Section>

      {/* ============= POOL_ADMIN ============= */}
      <Section
        id="pool-admin"
        num="iii."
        title="Pool Admin"
        subtitle="Manage the vault basket, allowed fee tiers, and Uniswap V3 positions."
        roleHeld={roles.vaultPoolAdmin}
        roleLabel="PUSDPLUS_POOL_ADMIN_ROLE on vault"
      >
        <PoolStatusCard meta={poolMeta} vault={vault} />
        <BasketTokenCard
          enabled={roles.vaultPoolAdmin}
          meta={poolMeta}
          onAdd={(addr) =>
            send(
              `vault.addBasketToken(${addr})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('addBasketToken', [addr]),
            )
          }
          onRemove={(addr) =>
            send(
              `vault.removeBasketToken(${addr})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('removeBasketToken', [addr]),
            )
          }
        />
        <CreatePoolCard
          enabled={roles.vaultPoolAdmin}
          meta={poolMeta}
          onSend={(token0, token1, fee, sqrtPriceX96) => {
            if (!poolMeta.positionManager) return;
            send(
              `npm.createAndInitializePool(${token0.slice(0, 8)}…/${token1.slice(0, 8)}…, fee=${fee})`,
              poolMeta.positionManager,
              NPM_ABI.encodeFunctionData('createAndInitializePoolIfNecessary', [
                token0,
                token1,
                fee,
                sqrtPriceX96,
              ]),
            );
          }}
        />
        <OpenPoolCard
          enabled={roles.vaultPoolAdmin}
          recipient={PUSD_PLUS_ADDRESS!}
          meta={poolMeta}
          vault={vault}
          onSend={(params) =>
            send(
              `vault.openPool(${params.token0.slice(0, 8)}…/${params.token1.slice(0, 8)}…)`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('openPool', [
                [
                  params.token0,
                  params.token1,
                  params.fee,
                  params.tickLower,
                  params.tickUpper,
                  params.amount0Desired,
                  params.amount1Desired,
                  params.amount0Min,
                  params.amount1Min,
                  params.recipient,
                  params.deadline,
                ],
              ]),
            )
          }
        />
        <ClosePoolCard
          enabled={roles.vaultPoolAdmin}
          meta={poolMeta}
          onSend={(tokenId, min0, min1, deadline) =>
            send(
              `vault.closePool(${tokenId})`,
              PUSD_PLUS_ADDRESS!,
              VAULT_ABI.encodeFunctionData('closePool', [
                tokenId,
                min0,
                min1,
                deadline,
              ]),
            )
          }
        />
      </Section>

      {/* ============= GUARDIAN ============= */}
      <Section
        id="guardian"
        num="iv."
        title="Guardian"
        subtitle="Emergency pause. Asymmetric — cannot unpause; that's DEFAULT_ADMIN."
        roleHeld={roles.vaultGuardian || roles.ifGuardian}
        roleLabel="PUSDPLUS_GUARDIAN_ROLE on vault and/or INSURANCE_FUND_GUARDIAN_ROLE on IF"
      >
        <ActionCard
          title="vault.pause()"
          description="Halts all state-changing surface on the PUSD+ vault. DEFAULT_ADMIN only can unpause."
          enabled={roles.vaultGuardian}
          dangerous
          onClick={() => send('vault.pause', PUSD_PLUS_ADDRESS!, VAULT_ABI.encodeFunctionData('pause', []))}
          buttonLabel="Pause vault"
        />
        <ActionCard
          title="insuranceFund.pause()"
          description="Halts notifyDeposit + withdraw on the IF. Vault's _haircut try/catch means rebalance still works."
          enabled={roles.ifGuardian}
          dangerous
          onClick={() => send('if.pause', INSURANCE_FUND_ADDRESS!, IF_ABI.encodeFunctionData('pause', []))}
          buttonLabel="Pause IF"
        />
      </Section>

      {/* ============= MANAGER ADMIN ============= */}
      <Section
        id="manager-admin"
        num="v."
        title="Manager Admin"
        subtitle="Token lifecycle, redemption fees, surplus haircuts, fee sweeps."
        roleHeld={roles.managerAdmin}
        roleLabel="ADMIN_ROLE on PUSDManager"
      >
        <BpsSetterCard
          title="setBaseFee"
          description="Default redemption fee on plain redeem. Cap 100 bps (1%)."
          maxBps={100}
          enabled={roles.managerAdmin}
          onSend={(bps) =>
            send(
              `manager.setBaseFee(${bps})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setBaseFee', [BigInt(bps)]),
            )
          }
        />
        <PerTokenHaircutCard
          enabled={roles.managerAdmin}
          onSend={(token, bps) =>
            send(
              `manager.setSurplusHaircutBps(${token}, ${bps})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setSurplusHaircutBps', [token, bps]),
            )
          }
        />
        <TokenStatusCard
          enabled={roles.managerAdmin}
          onSend={(token, status) =>
            send(
              `manager.setTokenStatus(${token}, ${status})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setTokenStatus', [token, status]),
            )
          }
        />
        <SweepCard
          enabled={roles.managerAdmin}
          onSend={(treasury) =>
            send(
              `manager.sweepAllSurplus(${treasury})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('sweepAllSurplus', [treasury]),
            )
          }
        />
        <SweepSurplusSingleCard
          enabled={roles.managerAdmin}
          onSend={(token, treasury) =>
            send(
              `manager.sweepSurplus(${token}, ${treasury})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('sweepSurplus', [token, treasury]),
            )
          }
        />
        <AddSupportedTokenCard
          enabled={roles.managerAdmin}
          onSend={(token, name, ns, decimals) =>
            send(
              `manager.addSupportedToken(${token})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('addSupportedToken', [token, name, ns, decimals]),
            )
          }
        />
        <PreferredFeeRangeCard
          enabled={roles.managerAdmin}
          onSend={(min, max) =>
            send(
              `manager.setPreferredFeeRange(${min}, ${max})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setPreferredFeeRange', [min, max]),
            )
          }
        />
        <FeeExemptCard
          enabled={roles.managerAdmin}
          onSend={(account, exempt) =>
            send(
              `manager.setFeeExempt(${account}, ${exempt})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setFeeExempt', [account, exempt]),
            )
          }
        />
        <ManagerRebalanceCard
          enabled={roles.managerAdmin}
          onSend={(tokenIn, amountIn, tokenOut) =>
            send(
              `manager.rebalance(${tokenIn} → ${tokenOut})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('rebalance', [tokenIn, amountIn, tokenOut]),
            )
          }
        />
        <AddressSetterCard
          title="setTreasuryReserve"
          description="Where sweepSurplus pays out. Set this before a non-zero sweep."
          enabled={roles.managerAdmin}
          onSend={(addr) =>
            send(
              `manager.setTreasuryReserve(${addr})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setTreasuryReserve', [addr]),
            )
          }
        />
      </Section>

      {/* ============= DEFAULT_ADMIN ============= */}
      <Section
        id="default-admin"
        num="vi."
        title="Default Admin"
        subtitle="UUPS upgrades, unpause counterparts, role grants, system wiring."
        roleHeld={roles.managerDefaultAdmin || roles.vaultDefaultAdmin || roles.ifDefaultAdmin}
        roleLabel="DEFAULT_ADMIN_ROLE on any of manager / vault / IF"
      >
        <ActionCard
          title="vault.unpause()"
          description="Resume PUSD+ vault. Asymmetric counterpart of GUARDIAN.pause()."
          enabled={roles.vaultDefaultAdmin}
          onClick={() => send('vault.unpause', PUSD_PLUS_ADDRESS!, VAULT_ABI.encodeFunctionData('unpause', []))}
          buttonLabel="Unpause vault"
        />
        <ActionCard
          title="if.unpause()"
          description="Resume InsuranceFund."
          enabled={roles.ifDefaultAdmin}
          onClick={() => send('if.unpause', INSURANCE_FUND_ADDRESS!, IF_ABI.encodeFunctionData('unpause', []))}
          buttonLabel="Unpause IF"
        />
        <AddressSetterCard
          title="manager.setPlusVault"
          description="Wire the PUSD+ vault address into the manager. Two-key gate; rotate via timelock only."
          enabled={roles.managerDefaultAdmin}
          onSend={(addr) =>
            send(
              `manager.setPlusVault(${addr})`,
              PUSD_MANAGER_ADDRESS,
              MANAGER_ABI.encodeFunctionData('setPlusVault', [addr]),
            )
          }
        />
      </Section>

      {/* ============= ANYONE (PUBLIC) ============= */}
      <Section
        id="public"
        num="vii."
        title="Public"
        subtitle="Permissionless. Anyone can call once the cooldown elapses."
        roleHeld
        roleLabel="No role required"
      >
        <ActionCard
          title="rebalance() — public path"
          description={`Same as the keeper's rebalance, but cooldown-gated for non-KEEPER callers. Public callers must wait the configured cooldown since the last rebalance. NAV is currently ${nav.pusdPerPlus.toFixed(6)}.`}
          enabled={!!pushChainClient}
          onClick={() => send('vault.rebalance (public)', PUSD_PLUS_ADDRESS!, VAULT_ABI.encodeFunctionData('rebalance', []))}
          buttonLabel="Rebalance"
        />
      </Section>
      </div>
    </>
  );
}

// ============================================================
// Sub-components
// ============================================================

function RoleBadgeStrip({ roles }: { roles: ReturnType<typeof useRoles> }) {
  const items = [
    { label: 'MGR_DEFAULT_ADMIN', held: roles.managerDefaultAdmin },
    { label: 'MGR_ADMIN', held: roles.managerAdmin },
    { label: 'MGR_UPGRADER', held: roles.managerUpgrader },
    { label: 'VAULT_DEFAULT_ADMIN', held: roles.vaultDefaultAdmin },
    { label: 'VAULT_ADMIN', held: roles.vaultVaultAdmin },
    { label: 'KEEPER', held: roles.vaultKeeper },
    { label: 'POOL_ADMIN', held: roles.vaultPoolAdmin },
    { label: 'V_GUARDIAN', held: roles.vaultGuardian },
    { label: 'IF_DEFAULT_ADMIN', held: roles.ifDefaultAdmin },
    { label: 'IF_VAULT_ADMIN', held: roles.ifVaultAdmin },
    { label: 'IF_GUARDIAN', held: roles.ifGuardian },
  ];
  return (
    <div className="role-badge-strip" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => (
        <span
          key={it.label}
          className="role-badge"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '4px 8px',
            border: '1px solid var(--c-ink)',
            color: it.held ? 'var(--c-cream)' : 'var(--c-ink-mute)',
            background: it.held ? 'var(--c-jade)' : 'transparent',
            opacity: it.held ? 1 : 0.5,
            textDecoration: it.held ? 'none' : 'line-through',
          }}
        >
          {it.held ? '✓ ' : ''}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Section({
  id,
  num,
  title,
  subtitle,
  roleHeld,
  roleLabel,
  children,
}: {
  id: string;
  num: string;
  title: string;
  subtitle: string;
  roleHeld: boolean;
  roleLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="docs__chapter" id={id} style={{ scrollMarginTop: 80 }}>
      <div className="docs__chapter-head">
        <div className="docs__chapter-num">{num}</div>
        <div className="docs__chapter-meta">
          <h2 className="docs__chapter-title">
            {title}{' '}
            <span
              className="mono"
              style={{
                fontStyle: 'normal',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginLeft: 8,
                padding: '3px 8px',
                color: roleHeld ? 'var(--c-cream)' : 'var(--c-ink-mute)',
                background: roleHeld ? 'var(--c-jade)' : 'transparent',
                border: 'var(--rule-thin)',
                verticalAlign: 'middle',
              }}
            >
              {roleHeld ? '✓ AUTHORISED' : '— NOT HELD'}
            </span>
          </h2>
          <p className="docs__chapter-lede">{subtitle}</p>
          <div className="meta-sm" style={{ marginTop: 8 }}>
            ROLE · <span className="mono">{roleLabel}</span>
          </div>
        </div>
      </div>
      <div className="admin-grid">{children}</div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  enabled,
  onClick,
  buttonLabel,
  dangerous,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onClick: () => void;
  buttonLabel: string;
  dangerous?: boolean;
}) {
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">{title}</div>
      <div className="admin-card__body">{description}</div>
      <button
        className={`admin-card__btn${dangerous ? ' admin-card__btn--danger' : ''}`}
        onClick={onClick}
        disabled={!enabled}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function BpsSetterCard({
  title,
  description,
  maxBps,
  enabled,
  onSend,
}: {
  title: string;
  description: string;
  maxBps: number;
  enabled: boolean;
  onSend: (bps: number) => void;
}) {
  const [v, setV] = useState('');
  const n = Number(v);
  const valid = Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= maxBps;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">{title}</div>
      <div className="admin-card__body">{description}</div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder={`bps (0–${maxBps})`}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(n)}
      >
        Set
      </button>
    </div>
  );
}

function SecondsSetterCard({
  title,
  description,
  maxSeconds,
  enabled,
  onSend,
}: {
  title: string;
  description: string;
  maxSeconds: number;
  enabled: boolean;
  onSend: (s: number) => void;
}) {
  const [v, setV] = useState('');
  const n = Number(v);
  const valid = Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= maxSeconds;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">{title}</div>
      <div className="admin-card__body">{description}</div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder={`seconds (0–${maxSeconds})`}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(n)}
      >
        Set
      </button>
    </div>
  );
}

function PerTokenHaircutCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (token: string, bps: number) => void;
}) {
  const [token, setToken] = useState(TOKENS[0].address);
  const [bps, setBps] = useState('');
  const n = Number(bps);
  const valid = Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 1000;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setSurplusHaircutBps</div>
      <div className="admin-card__body">
        Per-token haircut on deposit. Cap 1000 bps (10%). Currently 0 on every
        token; raise to deprecate a risky reserve.
      </div>
      <select
        className="admin-card__input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      >
        {TOKENS.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} · {t.chainShort}
          </option>
        ))}
      </select>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="bps (0–1000)"
        value={bps}
        onChange={(e) => setBps(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(token, n)}
      >
        Set haircut
      </button>
    </div>
  );
}

function TokenStatusCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (token: string, status: number) => void;
}) {
  const [token, setToken] = useState(TOKENS[0].address);
  const [status, setStatus] = useState(1);
  const labels = ['REMOVED (terminal)', 'ENABLED', 'REDEEM_ONLY', 'EMERGENCY_REDEEM'];
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setTokenStatus</div>
      <div className="admin-card__body">
        Lifecycle: ENABLED → REDEEM_ONLY → EMERGENCY_REDEEM → REMOVED.
        REMOVED is terminal (A3 invariant).
      </div>
      <select
        className="admin-card__input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      >
        {TOKENS.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} · {t.chainShort}
          </option>
        ))}
      </select>
      <select
        className="admin-card__input"
        value={status}
        onChange={(e) => setStatus(Number(e.target.value))}
      >
        {labels.map((l, i) => (
          <option key={l} value={i}>
            {i} — {l}
          </option>
        ))}
      </select>
      <button
        className="admin-card__btn"
        disabled={!enabled}
        onClick={() => onSend(token, status)}
      >
        Set status
      </button>
    </div>
  );
}

function SweepCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (treasury: `0x${string}`) => void;
}) {
  const [treasury, setTreasury] = useState('');
  const valid = ethers.isAddress(treasury);
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">sweepAllSurplus</div>
      <div className="admin-card__body">
        Pull accruedFees + accruedHaircut for every supported token to a
        treasury address. `setTreasuryReserve` first if not set.
      </div>
      <input
        className="admin-card__input"
        placeholder="treasury address (0x...)"
        value={treasury}
        onChange={(e) => setTreasury(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(treasury as `0x${string}`)}
      >
        Sweep
      </button>
    </div>
  );
}

function BasketTokenCard({
  enabled,
  meta,
  onAdd,
  onRemove,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onAdd: (addr: `0x${string}`) => void;
  onRemove: (addr: `0x${string}`) => void;
}) {
  const inBasket = meta.basketMembership.filter((m) => m.inBasket);
  const notInBasket = meta.basketMembership.filter((m) => !m.inBasket);

  const [toAdd, setToAdd] = useState<string>('');
  useEffect(() => {
    if (!toAdd && notInBasket[0]) setToAdd(notInBasket[0].address);
  }, [notInBasket, toAdd]);

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">addBasketToken / removeBasketToken</div>
      <div className="admin-card__body">
        Vault basket — tokens that count toward NAV and are eligible for
        openPool. v2.1 direct-deposit reverts for tokens not in basket.
        Idempotent.
      </div>

      {/* — Currently in basket — */}
      <div className="meta-sm" style={{ marginTop: 4 }}>
        <strong>In basket · {inBasket.length}</strong>
      </div>
      {inBasket.length === 0 ? (
        <span
          className="mono"
          style={{ color: 'var(--c-ink-mute)', fontSize: 11 }}
        >
          Empty — add a token to start.
        </span>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 6,
          }}
        >
          {inBasket.map((t) => (
            <div
              key={t.address}
              style={{
                border: 'var(--rule-thin)',
                background: 'var(--c-cream)',
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 11, lineHeight: 1.3 }}
              >
                {t.symbol}{' '}
                <span style={{ color: 'var(--c-ink-mute)' }}>
                  · {t.chainShort}
                </span>
              </span>
              <button
                className="admin-card__btn admin-card__btn--danger"
                disabled={!enabled}
                onClick={() => onRemove(t.address)}
                style={{
                  fontSize: 9,
                  padding: '3px 8px',
                  letterSpacing: '0.12em',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* — Add a missing one — */}
      <div className="meta-sm" style={{ marginTop: 12 }}>
        <strong>Add to basket</strong>
      </div>
      {notInBasket.length === 0 ? (
        <span
          className="mono"
          style={{ color: 'var(--c-ink-mute)', fontSize: 11 }}
        >
          Every supported token is already in the basket.
        </span>
      ) : (
        <div className="admin-card__row">
          <select
            className="admin-card__input"
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            style={{ flex: 1 }}
          >
            {notInBasket.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {t.chainShort}
              </option>
            ))}
          </select>
          <button
            className="admin-card__btn"
            disabled={!enabled || !toAdd}
            onClick={() => onAdd(toAdd as `0x${string}`)}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function RedeemPusdForTokenCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (pusdIn: bigint, token: `0x${string}`) => void;
}) {
  const [token, setToken] = useState(TOKENS[0].address);
  const [amount, setAmount] = useState('');
  let pusdIn = 0n;
  let valid = false;
  try {
    pusdIn = ethers.parseUnits(amount || '0', 6);
    valid = pusdIn > 0n;
  } catch {
    valid = false;
  }
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">redeemPusdForToken</div>
      <div className="admin-card__body">
        Vault uses fee-exempt manager.redeem to convert idle PUSD into a basket
        reserve. Used for inventory rebalancing.
      </div>
      <select
        className="admin-card__input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      >
        {TOKENS.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} · {t.chainShort}
          </option>
        ))}
      </select>
      <input
        className="admin-card__input"
        inputMode="decimal"
        placeholder="PUSD amount (e.g. 10)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(pusdIn, token as `0x${string}`)}
      >
        Convert
      </button>
    </div>
  );
}

// ============================================================================
// FeeTierAllowedCard — toggle which Uniswap V3 fee tiers the vault may use.
// ============================================================================

function FeeTierAllowedCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (fee: number, allowed: boolean) => void;
}) {
  const [fee, setFee] = useState('500');
  const [allow, setAllow] = useState<'true' | 'false'>('true');
  const n = Number(fee);
  const valid = Number.isInteger(n) && n > 0 && n <= 1_000_000;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setFeeTierAllowed</div>
      <div className="admin-card__body">
        Whitelist a Uniswap V3 fee tier so <code>openPool</code> can use it.
        Common stable-stable values: <code>100</code> = 0.01%, <code>500</code>{' '}
        = 0.05%.
      </div>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="fee (e.g. 500)"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          className="admin-card__input"
          value={allow}
          onChange={(e) => setAllow(e.target.value as 'true' | 'false')}
          style={{ flex: 1 }}
        >
          <option value="true">allow</option>
          <option value="false">disallow</option>
        </select>
      </div>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(n, allow === 'true')}
      >
        Set
      </button>
    </div>
  );
}

// ============================================================================
// DefaultTickRangeCard — vault's default V3 tick range used for new pools.
// ============================================================================

function DefaultTickRangeCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (lower: number, upper: number) => void;
}) {
  const [lower, setLower] = useState('-20');
  const [upper, setUpper] = useState('20');
  const lo = Number(lower);
  const up = Number(upper);
  const valid =
    Number.isInteger(lo) &&
    Number.isInteger(up) &&
    lo < up &&
    lo >= -887272 &&
    up <= 887272;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setDefaultTickRange</div>
      <div className="admin-card__body">
        Default tick range for auto-opened pools (lower &lt; upper). For
        stable pairs, ±20 is roughly ±0.2% around price.
      </div>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="tickLower"
          value={lower}
          onChange={(e) => setLower(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="tickUpper"
          value={upper}
          onChange={(e) => setUpper(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(lo, up)}
      >
        Set range
      </button>
    </div>
  );
}

// ============================================================================
// OpenPoolCard — POOL_ADMIN opens a new V3 LP position. The recipient is
// pre-set to the vault address; deadline defaults to now + 30 minutes.
// ============================================================================

type OpenPoolParams = {
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: `0x${string}`;
  deadline: bigint;
};

// ============================================================================
// PoolStatusCard — read-only summary of basket / fee tiers / positions so the
// operator sees the vault state before driving any of the pool ops.
// ============================================================================

function PoolStatusCard({
  meta,
  vault,
}: {
  meta: ReturnType<typeof useVaultPoolMeta>;
  vault: ReturnType<typeof useVaultBook>;
}) {
  const basketTokens = meta.basketMembership.filter((m) => m.inBasket);
  const balanceFor = (addr: `0x${string}`) =>
    vault.basketIdle.find((s) => s.address.toLowerCase() === addr.toLowerCase());

  return (
    <div className="admin-card" data-disabled={false}>
      <div className="admin-card__title mono">VAULT STATE · LIVE</div>
      <div className="admin-card__body">
        Read-only snapshot of what the vault holds and what's allowed. Use
        this before openPool / closePool / topUpPosition.
      </div>

      <div className="meta-sm" style={{ marginTop: 4 }}>
        <strong>Allowed fee tiers</strong>
        <span className="mono" style={{ marginLeft: 6 }}>
          {meta.loading
            ? '…'
            : meta.allowedFeeTiers.length === 0
              ? 'NONE — set one via setFeeTierAllowed first.'
              : meta.allowedFeeTiers.map((f) => `${f}`).join(' · ')}
          {meta.defaultFeeTier !== null && (
            <span style={{ color: 'var(--c-ink-mute)', marginLeft: 8 }}>
              (default {meta.defaultFeeTier})
            </span>
          )}
        </span>
      </div>

      <div className="meta-sm" style={{ marginTop: 8 }}>
        <strong>Basket · {basketTokens.length} of {meta.basketMembership.length} tokens</strong>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 6,
          marginTop: 4,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
        }}
      >
        {basketTokens.length === 0 ? (
          <span style={{ color: 'var(--c-ink-mute)' }}>
            No basket tokens — call addBasketToken first.
          </span>
        ) : (
          basketTokens.map((m) => {
            const bal = balanceFor(m.address);
            return (
              <span
                key={m.address}
                style={{
                  border: 'var(--rule-thin)',
                  padding: '4px 8px',
                  background: 'var(--c-cream)',
                }}
              >
                {m.symbol} · {m.chainShort}
                <span
                  style={{
                    display: 'block',
                    color: 'var(--c-ink-mute)',
                    fontSize: 10,
                  }}
                >
                  {bal && bal.amount > 0n
                    ? `${formatAmount(bal.amount, m.decimals, { maxFractionDigits: 2 })} idle`
                    : '0 idle'}
                </span>
              </span>
            );
          })
        )}
      </div>

      <div className="meta-sm" style={{ marginTop: 12 }}>
        <strong>Open positions · {meta.positionIds.length}</strong>
        {meta.positionManager && (
          <span style={{ color: 'var(--c-ink-mute)', marginLeft: 8 }}>
            via NPM <span className="mono">{meta.positionManager.slice(0, 6)}…{meta.positionManager.slice(-4)}</span>
          </span>
        )}
      </div>
      {meta.positionIds.length === 0 ? (
        <span
          className="mono"
          style={{ color: 'var(--c-ink-mute)', fontSize: 11 }}
        >
          No positions — open one with openPool below.
        </span>
      ) : meta.positions.length === 0 ? (
        <span
          className="mono"
          style={{ color: 'var(--c-ink-mute)', fontSize: 11 }}
        >
          Reading position details from NPM…
        </span>
      ) : (
        <div
          style={{
            marginTop: 4,
            border: 'var(--rule-thin)',
            background: 'var(--c-cream)',
            overflowX: 'auto',
          }}
        >
          <table
            className="mono"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--c-paper-warm)' }}>
                <th style={positionTh}>tokenId</th>
                <th style={positionTh}>pair</th>
                <th style={positionTh}>fee</th>
                <th style={positionTh}>ticks</th>
                <th style={positionTh}>liquidity</th>
                <th style={positionTh}>fees owed</th>
                <th style={positionTh}>NAV value</th>
              </tr>
            </thead>
            <tbody>
              {meta.positions.map((p) => (
                <tr
                  key={p.tokenId.toString()}
                  style={{ borderTop: 'var(--rule-thin)' }}
                >
                  <td style={positionTd}>#{p.tokenId.toString()}</td>
                  <td style={positionTd}>
                    {p.symbol0 ?? p.token0.slice(0, 6) + '…'}{' '}
                    <span style={{ color: 'var(--c-ink-mute)' }}>
                      {p.chainShort0 ? `(${p.chainShort0})` : ''}
                    </span>
                    {' / '}
                    {p.symbol1 ?? p.token1.slice(0, 6) + '…'}{' '}
                    <span style={{ color: 'var(--c-ink-mute)' }}>
                      {p.chainShort1 ? `(${p.chainShort1})` : ''}
                    </span>
                  </td>
                  <td style={positionTd}>{p.fee}</td>
                  <td style={positionTd}>
                    [{p.tickLower}, {p.tickUpper}]
                  </td>
                  <td style={positionTd}>{formatBigint(p.liquidity)}</td>
                  <td style={positionTd}>
                    {p.tokensOwed0 === 0n && p.tokensOwed1 === 0n ? (
                      <span style={{ color: 'var(--c-ink-mute)' }}>0 / 0</span>
                    ) : (
                      <span>
                        {formatAmount(p.tokensOwed0, p.decimals0, {
                          maxFractionDigits: 4,
                        })}
                        {' / '}
                        {formatAmount(p.tokensOwed1, p.decimals1, {
                          maxFractionDigits: 4,
                        })}
                      </span>
                    )}
                  </td>
                  <td style={positionTd}>
                    {formatAmount(p.valuePusd, 6, { maxFractionDigits: 2 })}{' '}
                    <span style={{ color: 'var(--c-ink-mute)' }}>PUSD</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Compact a large bigint for table display: 4 sig figs, scientific past 7
 * digits. e.g.
 *   25013700000000000000n  →  "2.501e19"
 *   1234567n               →  "1234567"
 *   0n                      →  "0"
 */
function formatBigint(n: bigint): string {
  if (n === 0n) return '0';
  const s = n.toString();
  if (s.length <= 7) return s;
  const head = s[0];
  const tail = s.slice(1, 4);
  return `${head}.${tail}e${s.length - 1}`;
}

const positionTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--c-ink-mute)',
  fontWeight: 500,
  borderBottom: 'var(--rule-thin)',
};

const positionTd: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

// ============================================================================
// OpenPoolCard — POOL_ADMIN opens a new V3 LP position. Now meta-aware:
// dropdowns are restricted to basket tokens + allowed fee tiers, and a "Use
// idle" shortcut prefills the largest available balance for each side.
// ============================================================================

function OpenPoolCard({
  enabled,
  recipient,
  meta,
  vault,
  onSend,
}: {
  enabled: boolean;
  recipient: `0x${string}`;
  meta: ReturnType<typeof useVaultPoolMeta>;
  vault: ReturnType<typeof useVaultBook>;
  onSend: (p: OpenPoolParams) => void;
}) {
  const basketTokens = meta.basketMembership.filter((m) => m.inBasket);
  const allowedTiers = meta.allowedFeeTiers;
  const defaultFee = meta.defaultFeeTier ?? allowedTiers[0] ?? 500;

  const [token0, setToken0] = useState<string>('');
  const [token1, setToken1] = useState<string>('');
  const [fee, setFee] = useState<number>(defaultFee);
  const [tickLower, setTickLower] = useState('-20');
  const [tickUpper, setTickUpper] = useState('20');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [slippageBps, setSlippageBps] = useState('50'); // 0.5%

  // Seed the token dropdowns with the first two basket entries once meta arrives.
  useEffect(() => {
    if (!token0 && basketTokens[0]) setToken0(basketTokens[0].address);
    if (!token1 && basketTokens[1]) setToken1(basketTokens[1].address);
  }, [basketTokens, token0, token1]);

  // Keep fee in sync if the default arrives later.
  useEffect(() => {
    if (allowedTiers.length > 0 && !allowedTiers.includes(fee)) setFee(defaultFee);
  }, [allowedTiers, defaultFee, fee]);

  const t0 = basketTokens.find((t) => t.address === token0);
  const t1 = basketTokens.find((t) => t.address === token1);
  const dec0 = t0?.decimals ?? 6;
  const dec1 = t1?.decimals ?? 6;
  const idle0 = vault.basketIdle.find(
    (s) => s.address.toLowerCase() === token0.toLowerCase(),
  );
  const idle1 = vault.basketIdle.find(
    (s) => s.address.toLowerCase() === token1.toLowerCase(),
  );
  const idleAmount0 = idle0?.amount ?? 0n;
  const idleAmount1 = idle1?.amount ?? 0n;

  function parseTokenAmount(s: string, decimals: number): bigint | null {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return BigInt(Math.round(n * 10 ** decimals));
  }

  const a0 = parseTokenAmount(amount0, dec0);
  const a1 = parseTokenAmount(amount1, dec1);
  const lo = Number(tickLower);
  const up = Number(tickUpper);
  const slip = Number(slippageBps);

  // Reasons why the op might fail. Drives the "what's possible" hints.
  const reasons: string[] = [];
  if (basketTokens.length < 2) reasons.push('Basket needs ≥ 2 tokens.');
  if (allowedTiers.length === 0) reasons.push('No fee tier whitelisted.');
  if (token0 && token1 && token0 === token1) reasons.push('token0 must differ from token1.');
  if (token0 && !t0) reasons.push('token0 not in basket.');
  if (token1 && !t1) reasons.push('token1 not in basket.');
  if (!allowedTiers.includes(fee)) reasons.push(`fee ${fee} not allowed.`);
  if (a0 !== null && a0 > idleAmount0)
    reasons.push(
      `amount0 exceeds vault idle (${formatAmount(idleAmount0, dec0, { maxFractionDigits: 2 })}).`,
    );
  if (a1 !== null && a1 > idleAmount1)
    reasons.push(
      `amount1 exceeds vault idle (${formatAmount(idleAmount1, dec1, { maxFractionDigits: 2 })}).`,
    );
  if (Number.isInteger(lo) && Number.isInteger(up) && lo >= up)
    reasons.push('tickLower must be < tickUpper.');

  const valid =
    a0 !== null &&
    a1 !== null &&
    a0 > 0n &&
    a1 > 0n &&
    Number.isInteger(lo) &&
    Number.isInteger(up) &&
    lo < up &&
    Number.isInteger(slip) &&
    slip >= 0 &&
    slip <= 10000 &&
    reasons.length === 0;

  function send() {
    if (!valid || a0 === null || a1 === null) return;
    const slipFloor = (amt: bigint) => (amt * BigInt(10000 - slip)) / 10000n;

    // Uniswap V3 requires token0 < token1 (lex on the lowercased address).
    // Auto-sort so the operator can pick either order in the UI; if we flip
    // the pair we also flip amounts, slippage mins, and tick range (the
    // V3 price inverts under a token swap, so [a, b] becomes [-b, -a]).
    let tA = token0 as `0x${string}`;
    let tB = token1 as `0x${string}`;
    let aA = a0;
    let aB = a1;
    let mA = slipFloor(a0);
    let mB = slipFloor(a1);
    let tickLo = lo;
    let tickHi = up;
    if (tA.toLowerCase() > tB.toLowerCase()) {
      [tA, tB] = [tB, tA];
      [aA, aB] = [aB, aA];
      [mA, mB] = [mB, mA];
      const newLo = -up;
      const newHi = -lo;
      tickLo = newLo;
      tickHi = newHi;
    }

    onSend({
      token0: tA,
      token1: tB,
      fee,
      tickLower: tickLo,
      tickUpper: tickHi,
      amount0Desired: aA,
      amount1Desired: aB,
      amount0Min: mA,
      amount1Min: mB,
      recipient,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    });
  }

  function fillIdle(side: 0 | 1) {
    const dec = side === 0 ? dec0 : dec1;
    const amt = side === 0 ? idleAmount0 : idleAmount1;
    if (amt === 0n) return;
    const human = Number(amt) / 10 ** dec;
    const text = human.toString();
    if (side === 0) setAmount0(text);
    else setAmount1(text);
  }

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">openPool</div>
      <div className="admin-card__body">
        Open a new Uniswap V3 LP position from vault idle reserves. Vault is
        the recipient automatically. Both tokens must be in the basket and
        the fee tier must be allowed.
      </div>
      <div className="admin-card__row">
        <select
          className="admin-card__input"
          value={token0}
          onChange={(e) => setToken0(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— token0 —</option>
          {basketTokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {t.chainShort}
            </option>
          ))}
        </select>
        <select
          className="admin-card__input"
          value={token1}
          onChange={(e) => setToken1(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— token1 —</option>
          {basketTokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {t.chainShort}
            </option>
          ))}
        </select>
      </div>
      <select
        className="admin-card__input"
        value={fee}
        onChange={(e) => setFee(Number(e.target.value))}
      >
        {allowedTiers.length === 0 ? (
          <option value={fee}>no allowed tiers</option>
        ) : (
          allowedTiers.map((t) => (
            <option key={t} value={t}>
              fee {t} {t === meta.defaultFeeTier ? '(default)' : ''}
            </option>
          ))
        )}
      </select>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="tickLower"
          value={tickLower}
          onChange={(e) => setTickLower(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="tickUpper"
          value={tickUpper}
          onChange={(e) => setTickUpper(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div className="admin-card__row">
        <div style={{ flex: 1 }}>
          <input
            className="admin-card__input"
            inputMode="decimal"
            placeholder={`amount0 (${t0?.symbol ?? '?'})`}
            value={amount0}
            onChange={(e) => setAmount0(e.target.value)}
            style={{ width: '100%' }}
          />
          <button
            type="button"
            className="admin-card__btn"
            onClick={() => fillIdle(0)}
            disabled={!t0 || idleAmount0 === 0n}
            style={{ marginTop: 4, fontSize: 10, padding: '4px 8px' }}
          >
            Use idle{' '}
            {t0
              ? formatAmount(idleAmount0, dec0, { maxFractionDigits: 2 })
              : '—'}
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <input
            className="admin-card__input"
            inputMode="decimal"
            placeholder={`amount1 (${t1?.symbol ?? '?'})`}
            value={amount1}
            onChange={(e) => setAmount1(e.target.value)}
            style={{ width: '100%' }}
          />
          <button
            type="button"
            className="admin-card__btn"
            onClick={() => fillIdle(1)}
            disabled={!t1 || idleAmount1 === 0n}
            style={{ marginTop: 4, fontSize: 10, padding: '4px 8px' }}
          >
            Use idle{' '}
            {t1
              ? formatAmount(idleAmount1, dec1, { maxFractionDigits: 2 })
              : '—'}
          </button>
        </div>
      </div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="slippage (bps; 50 = 0.5%)"
        value={slippageBps}
        onChange={(e) => setSlippageBps(e.target.value)}
      />
      {reasons.length > 0 && (
        <div
          className="meta-sm"
          style={{
            color: 'var(--c-oxblood)',
            background: 'var(--c-paper-warm)',
            padding: '6px 10px',
            border: '1px solid var(--c-oxblood)',
          }}
        >
          {reasons.map((r) => (
            <div key={r}>· {r}</div>
          ))}
        </div>
      )}
      <button className="admin-card__btn" disabled={!enabled || !valid} onClick={send}>
        Open pool
      </button>
    </div>
  );
}

// ============================================================================
// ClosePoolCard — drain liquidity, collect fees, NPM-burn, drop the position
// from the vault registry. POOL_ADMIN-only. Picks the tokenId from a select
// of currently-owned positions so the op can't typo a stale ID.
// ============================================================================

function ClosePoolCard({
  enabled,
  meta,
  onSend,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onSend: (tokenId: bigint, min0: bigint, min1: bigint, deadline: bigint) => void;
}) {
  const positions = meta.positionIds;
  const [tokenId, setTokenId] = useState<string>('');
  const [min0, setMin0] = useState('0');
  const [min1, setMin1] = useState('0');

  useEffect(() => {
    if (!tokenId && positions[0]) setTokenId(positions[0].toString());
  }, [positions, tokenId]);

  const valid = tokenId !== '' && /^\d+$/.test(tokenId);
  const noPositions = positions.length === 0;

  function send() {
    if (!valid) return;
    const m0 = (() => {
      const n = Number(min0);
      return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n)) : 0n;
    })();
    const m1 = (() => {
      const n = Number(min1);
      return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n)) : 0n;
    })();
    onSend(
      BigInt(tokenId),
      m0,
      m1,
      BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    );
  }

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">closePool</div>
      <div className="admin-card__body">
        Close a position by tokenId. Drains liquidity, collects fees, burns
        the NPM, and removes the position from the vault registry. Only
        positions currently registered are listed.
      </div>
      {noPositions ? (
        <div
          className="meta-sm"
          style={{
            color: 'var(--c-ink-mute)',
            padding: '8px 0',
          }}
        >
          No positions to close — open one with openPool first.
        </div>
      ) : (
        <select
          className="admin-card__input"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {positions.map((id) => (
            <option key={id.toString()} value={id.toString()}>
              #{id.toString()}
            </option>
          ))}
        </select>
      )}
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount0Min (raw)"
          value={min0}
          onChange={(e) => setMin0(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount1Min (raw)"
          value={min1}
          onChange={(e) => setMin1(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="admin-card__btn admin-card__btn--danger"
        disabled={!enabled || !valid || noPositions}
        onClick={send}
      >
        Close pool
      </button>
    </div>
  );
}

// ============================================================================
// TopUpPositionCard — KEEPER increases liquidity on an existing position.
// Picks tokenId from the vault's owned positions; raw token amounts.
// ============================================================================

function TopUpPositionCard({
  enabled,
  meta,
  onSend,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onSend: (
    tokenId: bigint,
    a0: bigint,
    a1: bigint,
    m0: bigint,
    m1: bigint,
    deadline: bigint,
  ) => void;
}) {
  const positions = meta.positionIds;
  const [tokenId, setTokenId] = useState<string>('');
  const [a0, setA0] = useState('0');
  const [a1, setA1] = useState('0');
  const [m0, setM0] = useState('0');
  const [m1, setM1] = useState('0');

  useEffect(() => {
    if (!tokenId && positions[0]) setTokenId(positions[0].toString());
  }, [positions, tokenId]);

  const noPositions = positions.length === 0;
  const parseRaw = (s: string): bigint => {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n)) : 0n;
  };
  const valid =
    tokenId !== '' && /^\d+$/.test(tokenId) && (parseRaw(a0) > 0n || parseRaw(a1) > 0n);

  function send() {
    if (!valid) return;
    onSend(
      BigInt(tokenId),
      parseRaw(a0),
      parseRaw(a1),
      parseRaw(m0),
      parseRaw(m1),
      BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    );
  }

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">topUpPosition</div>
      <div className="admin-card__body">
        Increase liquidity on an existing position. Caller passes raw token
        amounts (encoded at each token's decimals) and slippage minimums;
        deployment cap is enforced inline by the vault.
      </div>
      {noPositions ? (
        <div className="meta-sm" style={{ color: 'var(--c-ink-mute)', padding: '8px 0' }}>
          No positions to top up.
        </div>
      ) : (
        <select
          className="admin-card__input"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {positions.map((id) => (
            <option key={id.toString()} value={id.toString()}>
              #{id.toString()}
            </option>
          ))}
        </select>
      )}
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount0Desired (raw)"
          value={a0}
          onChange={(e) => setA0(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount1Desired (raw)"
          value={a1}
          onChange={(e) => setA1(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount0Min (raw)"
          value={m0}
          onChange={(e) => setM0(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="amount1Min (raw)"
          value={m1}
          onChange={(e) => setM1(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid || noPositions}
        onClick={send}
      >
        Top up
      </button>
    </div>
  );
}

// ============================================================================
// Generic helpers — single-input setters used in many places.
// ============================================================================

function PusdAmountSetterCard({
  title,
  description,
  enabled,
  onSend,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onSend: (amount: bigint) => void;
}) {
  const [v, setV] = useState('');
  const n = Number(v);
  const valid = Number.isFinite(n) && n >= 0;
  const amt = valid ? BigInt(Math.round(n * 1_000_000)) : 0n;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">{title}</div>
      <div className="admin-card__body">{description}</div>
      <input
        className="admin-card__input"
        inputMode="decimal"
        placeholder="amount in PUSD (whole units)"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(amt)}
      >
        Set
      </button>
    </div>
  );
}

function AddressSetterCard({
  title,
  description,
  enabled,
  onSend,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onSend: (addr: `0x${string}`) => void;
}) {
  const [v, setV] = useState('');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(v);
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">{title}</div>
      <div className="admin-card__body">{description}</div>
      <input
        className="admin-card__input mono"
        placeholder="0x…"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(v as `0x${string}`)}
      >
        Set
      </button>
    </div>
  );
}

// ============================================================================
// DefaultFeeTierCard — pick from currently-allowed tiers only.
// ============================================================================

function DefaultFeeTierCard({
  enabled,
  meta,
  onSend,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onSend: (fee: number) => void;
}) {
  const [fee, setFee] = useState<number>(0);
  useEffect(() => {
    if (fee === 0 && meta.allowedFeeTiers.length > 0) {
      setFee(meta.defaultFeeTier ?? meta.allowedFeeTiers[0]);
    }
  }, [meta.allowedFeeTiers, meta.defaultFeeTier, fee]);
  const noTiers = meta.allowedFeeTiers.length === 0;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setDefaultFeeTier</div>
      <div className="admin-card__body">
        Default tier the keeper auto-opens new pools with. Must be one of the
        currently-allowed tiers (set via setFeeTierAllowed).
      </div>
      {noTiers ? (
        <div className="meta-sm" style={{ color: 'var(--c-ink-mute)' }}>
          No allowed tiers yet — call setFeeTierAllowed first.
        </div>
      ) : (
        <select
          className="admin-card__input"
          value={fee}
          onChange={(e) => setFee(Number(e.target.value))}
        >
          {meta.allowedFeeTiers.map((t) => (
            <option key={t} value={t}>
              fee {t} {t === meta.defaultFeeTier ? '(current default)' : ''}
            </option>
          ))}
        </select>
      )}
      <button
        className="admin-card__btn"
        disabled={!enabled || noTiers || fee === 0}
        onClick={() => onSend(fee)}
      >
        Set default
      </button>
    </div>
  );
}

// ============================================================================
// CreatePoolCard — calls Uniswap V3 NPM to create + initialise a pool. Required
// before openPool can mint into it. sqrtPriceX96 defaults to 1:1 (Q64.96 of 1).
// ============================================================================

const SQRT_PRICE_X96_ONE = (1n << 96n).toString(); // 79228162514264337593543950336

function CreatePoolCard({
  enabled,
  meta,
  onSend,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onSend: (
    token0: `0x${string}`,
    token1: `0x${string}`,
    fee: number,
    sqrtPriceX96: bigint,
  ) => void;
}) {
  const basketTokens = meta.basketMembership.filter((m) => m.inBasket);
  const allowedTiers = meta.allowedFeeTiers;
  const defaultFee = meta.defaultFeeTier ?? allowedTiers[0] ?? 500;

  const [tA, setTA] = useState<string>('');
  const [tB, setTB] = useState<string>('');
  const [fee, setFee] = useState<number>(defaultFee);
  const [sqrt, setSqrt] = useState<string>(SQRT_PRICE_X96_ONE);

  useEffect(() => {
    if (!tA && basketTokens[0]) setTA(basketTokens[0].address);
    if (!tB && basketTokens[1]) setTB(basketTokens[1].address);
  }, [basketTokens, tA, tB]);

  useEffect(() => {
    if (allowedTiers.length > 0 && !allowedTiers.includes(fee)) setFee(defaultFee);
  }, [allowedTiers, defaultFee, fee]);

  // Sort tokens canonically.
  const [t0, t1] =
    tA && tB && tA.toLowerCase() < tB.toLowerCase() ? [tA, tB] : [tB, tA];
  const sqrtBig = (() => {
    try {
      return BigInt(sqrt);
    } catch {
      return 0n;
    }
  })();
  const reasons: string[] = [];
  if (!meta.positionManager) reasons.push('NPM address unknown.');
  if (!t0 || !t1) reasons.push('Pick both tokens.');
  if (t0 && t1 && t0 === t1) reasons.push('token0 must differ from token1.');
  if (!allowedTiers.includes(fee)) reasons.push(`fee ${fee} not allowed.`);
  if (sqrtBig <= 0n) reasons.push('sqrtPriceX96 must be > 0.');

  const valid = reasons.length === 0;

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">npm.createAndInitializePool</div>
      <div className="admin-card__body">
        Create the V3 pool on Donut if it doesn't exist yet. Required before
        openPool can mint a position. Tokens are auto-sorted; default
        sqrtPriceX96 = 1.0 (Q64.96) which is correct for stable/stable pairs.
      </div>
      {meta.positionManager && (
        <div className="meta-sm">
          NPM target: <span className="mono">{meta.positionManager}</span>
        </div>
      )}
      <div className="admin-card__row">
        <select
          className="admin-card__input"
          value={tA}
          onChange={(e) => setTA(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— token A —</option>
          {basketTokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {t.chainShort}
            </option>
          ))}
        </select>
        <select
          className="admin-card__input"
          value={tB}
          onChange={(e) => setTB(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— token B —</option>
          {basketTokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {t.chainShort}
            </option>
          ))}
        </select>
      </div>
      <select
        className="admin-card__input"
        value={fee}
        onChange={(e) => setFee(Number(e.target.value))}
      >
        {allowedTiers.length === 0 ? (
          <option value={fee}>no allowed tiers</option>
        ) : (
          allowedTiers.map((t) => (
            <option key={t} value={t}>
              fee {t} {t === meta.defaultFeeTier ? '(default)' : ''}
            </option>
          ))
        )}
      </select>
      <input
        className="admin-card__input mono"
        placeholder="sqrtPriceX96"
        value={sqrt}
        onChange={(e) => setSqrt(e.target.value)}
      />
      {reasons.length > 0 && (
        <div
          className="meta-sm"
          style={{
            color: 'var(--c-oxblood)',
            background: 'var(--c-paper-warm)',
            padding: '6px 10px',
            border: '1px solid var(--c-oxblood)',
          }}
        >
          {reasons.map((r) => (
            <div key={r}>· {r}</div>
          ))}
        </div>
      )}
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() =>
          onSend(t0 as `0x${string}`, t1 as `0x${string}`, fee, sqrtBig)
        }
      >
        Create pool
      </button>
    </div>
  );
}

// ============================================================================
// RebalanceBoundedCard — keeper bounded harvest (gas-aware variant of rebalance).
// ============================================================================

function RebalanceBoundedCard({
  enabled,
  meta,
  onSend,
}: {
  enabled: boolean;
  meta: ReturnType<typeof useVaultPoolMeta>;
  onSend: (start: bigint, count: bigint) => void;
}) {
  const total = meta.positionIds.length;
  const [start, setStart] = useState('0');
  const [count, setCount] = useState(total > 0 ? String(total) : '0');
  const s = Number(start);
  const c = Number(count);
  const valid =
    Number.isInteger(s) &&
    Number.isInteger(c) &&
    s >= 0 &&
    c > 0 &&
    s + c <= total;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">rebalanceBounded</div>
      <div className="admin-card__body">
        Harvest a slice of positionIds to keep gas predictable on busy days.
        Currently {total} position{total === 1 ? '' : 's'} registered.
      </div>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="startIdx"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="count"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(BigInt(s), BigInt(c))}
      >
        Harvest slice
      </button>
    </div>
  );
}

// ============================================================================
// SweepSurplusSingleCard — sweep one token's accrued fees + haircut.
// ============================================================================

function SweepSurplusSingleCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (token: `0x${string}`, treasury: `0x${string}`) => void;
}) {
  const [token, setToken] = useState<string>(TOKENS[0]?.address ?? '');
  const [treasury, setTreasury] = useState('');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(treasury);
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">sweepSurplus</div>
      <div className="admin-card__body">
        Move accruedFees + accruedHaircut for a single token to the treasury
        address. Treasury must be set elsewhere or passed explicitly.
      </div>
      <select
        className="admin-card__input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      >
        {TOKENS.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} · {t.chainShort}
          </option>
        ))}
      </select>
      <input
        className="admin-card__input mono"
        placeholder="treasury 0x…"
        value={treasury}
        onChange={(e) => setTreasury(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() =>
          onSend(token as `0x${string}`, treasury as `0x${string}`)
        }
      >
        Sweep
      </button>
    </div>
  );
}

// ============================================================================
// AddSupportedTokenCard — register a new reserve token on PUSDManager.
// ============================================================================

function AddSupportedTokenCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (
    token: `0x${string}`,
    name: string,
    namespace: string,
    decimals: number,
  ) => void;
}) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [ns, setNs] = useState('');
  const [decimals, setDecimals] = useState('6');
  const dn = Number(decimals);
  const valid =
    /^0x[a-fA-F0-9]{40}$/.test(token) &&
    name.trim() !== '' &&
    ns.trim() !== '' &&
    Number.isInteger(dn) &&
    dn >= 0 &&
    dn <= 18;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">addSupportedToken</div>
      <div className="admin-card__body">
        Register a new reserve token. After this, also call{' '}
        <code>vault.addBasketToken(token)</code> if PUSD+ should accept it.
      </div>
      <input
        className="admin-card__input mono"
        placeholder="token 0x…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          placeholder='name (e.g. "USDT")'
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          placeholder="namespace (e.g. ETH_SEP)"
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="decimals"
        value={decimals}
        onChange={(e) => setDecimals(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(token as `0x${string}`, name, ns, dn)}
      >
        Register
      </button>
    </div>
  );
}

// ============================================================================
// PreferredFeeRangeCard — preferred-asset surcharge bounds (min / max bps).
// ============================================================================

function PreferredFeeRangeCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (min: number, max: number) => void;
}) {
  const [min, setMin] = useState('10');
  const [max, setMax] = useState('50');
  const mn = Number(min);
  const mx = Number(max);
  const valid =
    Number.isInteger(mn) &&
    Number.isInteger(mx) &&
    mn >= 0 &&
    mx >= mn &&
    mx <= 200;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setPreferredFeeRange</div>
      <div className="admin-card__body">
        Min/max preferred-asset surcharge applied on single-token redeems.
        Cap MAX_PREFERRED_FEE_BPS = 200 (2%).
      </div>
      <div className="admin-card__row">
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="min bps"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="numeric"
          placeholder="max bps"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(mn, mx)}
      >
        Set range
      </button>
    </div>
  );
}

// ============================================================================
// FeeExemptCard — toggle fee-exempt status for an account.
// ============================================================================

function FeeExemptCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (account: `0x${string}`, exempt: boolean) => void;
}) {
  const [addr, setAddr] = useState('');
  const [exempt, setExempt] = useState<'true' | 'false'>('true');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(addr);
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">setFeeExempt</div>
      <div className="admin-card__body">
        Toggle fee-exempt status for an account. Vault is the only intended
        exempt address; flipping false on the vault disables depositForVault.
      </div>
      <input
        className="admin-card__input mono"
        placeholder="account 0x…"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
      />
      <select
        className="admin-card__input"
        value={exempt}
        onChange={(e) => setExempt(e.target.value as 'true' | 'false')}
      >
        <option value="true">exempt = true</option>
        <option value="false">exempt = false</option>
      </select>
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() => onSend(addr as `0x${string}`, exempt === 'true')}
      >
        Set
      </button>
    </div>
  );
}

// ============================================================================
// ManagerRebalanceCard — manager-side reserve swap (different from vault rebalance).
// ============================================================================

function ManagerRebalanceCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (
    tokenIn: `0x${string}`,
    amountIn: bigint,
    tokenOut: `0x${string}`,
  ) => void;
}) {
  const [tokenIn, setTokenIn] = useState<string>(TOKENS[0]?.address ?? '');
  const [tokenOut, setTokenOut] = useState<string>(TOKENS[1]?.address ?? '');
  const [amount, setAmount] = useState('');

  const t = TOKENS.find((x) => x.address === tokenIn);
  const dec = t?.decimals ?? 6;
  const n = Number(amount);
  const valid =
    Number.isFinite(n) &&
    n > 0 &&
    tokenIn !== tokenOut &&
    /^0x[a-fA-F0-9]{40}$/.test(tokenIn) &&
    /^0x[a-fA-F0-9]{40}$/.test(tokenOut);
  const amt = valid ? BigInt(Math.round(n * 10 ** dec)) : 0n;
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">manager.rebalance</div>
      <div className="admin-card__body">
        Swap reserve composition on the manager — tokenIn → tokenOut at par.
        Useful for re-balancing the basket ratios held by the manager.
      </div>
      <div className="admin-card__row">
        <select
          className="admin-card__input"
          value={tokenIn}
          onChange={(e) => setTokenIn(e.target.value)}
          style={{ flex: 1 }}
        >
          {TOKENS.map((x) => (
            <option key={x.address} value={x.address}>
              {x.symbol} · {x.chainShort}
            </option>
          ))}
        </select>
        <select
          className="admin-card__input"
          value={tokenOut}
          onChange={(e) => setTokenOut(e.target.value)}
          style={{ flex: 1 }}
        >
          {TOKENS.map((x) => (
            <option key={x.address} value={x.address}>
              {x.symbol} · {x.chainShort}
            </option>
          ))}
        </select>
      </div>
      <input
        className="admin-card__input"
        inputMode="decimal"
        placeholder={`amountIn (${t?.symbol ?? '?'})`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button
        className="admin-card__btn"
        disabled={!enabled || !valid}
        onClick={() =>
          onSend(tokenIn as `0x${string}`, amt, tokenOut as `0x${string}`)
        }
      >
        Rebalance
      </button>
    </div>
  );
}

function TxStatus({ stage }: { stage: TxStage }) {
  if (stage.kind === 'idle') return null;
  const cls = stage.kind === 'error'
    ? 'feedback feedback--error'
    : stage.kind === 'confirmed'
      ? 'feedback feedback--success'
      : 'feedback';
  return (
    <div className={cls}>
      <div className="feedback__title">
        {stage.kind === 'signing' && `SIGNING · ${stage.label}`}
        {stage.kind === 'broadcasting' && `BROADCASTING · ${stage.label}`}
        {stage.kind === 'confirmed' && `CONFIRMED · ${stage.label}`}
        {stage.kind === 'error' && 'TRANSACTION FAILED'}
      </div>
      {stage.kind === 'error' && <div className="feedback__body">{stage.message}</div>}
      {(stage.kind === 'broadcasting' || stage.kind === 'confirmed') && (
        <div className="feedback__body mono" style={{ fontSize: 12 }}>
          tx{' '}
          <a
            className="link-mono"
            href={`https://donut.push.network/tx/${stage.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {stage.hash}
          </a>
        </div>
      )}
    </div>
  );
}
