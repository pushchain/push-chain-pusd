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
import { useState } from 'react';
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
        <BasketTokenCard
          enabled={roles.vaultPoolAdmin}
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
        <OpenPoolCard
          enabled={roles.vaultPoolAdmin}
          recipient={PUSD_PLUS_ADDRESS!}
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
  onAdd,
  onRemove,
}: {
  enabled: boolean;
  onAdd: (addr: `0x${string}`) => void;
  onRemove: (addr: `0x${string}`) => void;
}) {
  const [token, setToken] = useState(TOKENS[0].address);
  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">addBasketToken / removeBasketToken</div>
      <div className="admin-card__body">
        Vault basket — tokens that count toward NAV and are eligible for
        openPool. v2.1 direct-deposit reverts for tokens not in basket.
        Idempotent.
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
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="admin-card__btn"
          disabled={!enabled}
          onClick={() => onAdd(token as `0x${string}`)}
        >
          Add
        </button>
        <button
          className="admin-card__btn admin-card__btn--danger"
          disabled={!enabled}
          onClick={() => onRemove(token as `0x${string}`)}
        >
          Remove
        </button>
      </div>
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

function OpenPoolCard({
  enabled,
  recipient,
  onSend,
}: {
  enabled: boolean;
  recipient: `0x${string}`;
  onSend: (p: OpenPoolParams) => void;
}) {
  const [token0, setToken0] = useState<string>(TOKENS[0]?.address ?? '');
  const [token1, setToken1] = useState<string>(TOKENS[1]?.address ?? '');
  const [fee, setFee] = useState('500');
  const [tickLower, setTickLower] = useState('-20');
  const [tickUpper, setTickUpper] = useState('20');
  const [amount0, setAmount0] = useState('100');
  const [amount1, setAmount1] = useState('100');
  const [slippageBps, setSlippageBps] = useState('50'); // 0.5%

  const t0 = TOKENS.find((t) => t.address === token0);
  const t1 = TOKENS.find((t) => t.address === token1);
  const dec0 = t0?.decimals ?? 6;
  const dec1 = t1?.decimals ?? 6;

  function parseTokenAmount(s: string, decimals: number): bigint | null {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return BigInt(Math.round(n * 10 ** decimals));
  }

  const a0 = parseTokenAmount(amount0, dec0);
  const a1 = parseTokenAmount(amount1, dec1);
  const fn = Number(fee);
  const lo = Number(tickLower);
  const up = Number(tickUpper);
  const slip = Number(slippageBps);

  const valid =
    a0 !== null &&
    a1 !== null &&
    a0 > 0n &&
    a1 > 0n &&
    Number.isInteger(fn) &&
    Number.isInteger(lo) &&
    Number.isInteger(up) &&
    lo < up &&
    Number.isInteger(slip) &&
    slip >= 0 &&
    slip <= 10000 &&
    token0 !== token1;

  function send() {
    if (!valid || a0 === null || a1 === null) return;
    const slipFloor = (amt: bigint) => (amt * BigInt(10000 - slip)) / 10000n;
    onSend({
      token0: token0 as `0x${string}`,
      token1: token1 as `0x${string}`,
      fee: fn,
      tickLower: lo,
      tickUpper: up,
      amount0Desired: a0,
      amount1Desired: a1,
      amount0Min: slipFloor(a0),
      amount1Min: slipFloor(a1),
      recipient,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    });
  }

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">openPool</div>
      <div className="admin-card__body">
        Open a new Uniswap V3 LP position. Both tokens must be in the vault
        basket, the fee tier must be allowed, and the pool must already exist
        on Donut. Vault is set as the position recipient automatically.
      </div>
      <div className="admin-card__row">
        <select
          className="admin-card__input"
          value={token0}
          onChange={(e) => setToken0(e.target.value)}
          style={{ flex: 1 }}
        >
          {TOKENS.map((t) => (
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
          {TOKENS.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {t.chainShort}
            </option>
          ))}
        </select>
      </div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="fee tier (e.g. 500)"
        value={fee}
        onChange={(e) => setFee(e.target.value)}
      />
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
        <input
          className="admin-card__input"
          inputMode="decimal"
          placeholder={`amount0 (${t0?.symbol ?? '?'})`}
          value={amount0}
          onChange={(e) => setAmount0(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="admin-card__input"
          inputMode="decimal"
          placeholder={`amount1 (${t1?.symbol ?? '?'})`}
          value={amount1}
          onChange={(e) => setAmount1(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="slippage (bps; 50 = 0.5%)"
        value={slippageBps}
        onChange={(e) => setSlippageBps(e.target.value)}
      />
      <button className="admin-card__btn" disabled={!enabled || !valid} onClick={send}>
        Open pool
      </button>
    </div>
  );
}

// ============================================================================
// ClosePoolCard — drain liquidity, collect fees, NPM-burn, and drop the
// position from the vault registry. POOL_ADMIN-only.
// ============================================================================

function ClosePoolCard({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (tokenId: bigint, min0: bigint, min1: bigint, deadline: bigint) => void;
}) {
  const [tokenId, setTokenId] = useState('');
  const [min0, setMin0] = useState('0');
  const [min1, setMin1] = useState('0');

  const id = Number(tokenId);
  const valid = Number.isInteger(id) && id > 0;

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
      BigInt(id),
      m0,
      m1,
      BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
    );
  }

  return (
    <div className="admin-card" data-disabled={!enabled}>
      <div className="admin-card__title mono">closePool</div>
      <div className="admin-card__body">
        Close a position by NPM tokenId. Drains liquidity, collects fees,
        burns the NPM, and removes the position from the vault registry.
        Slippage minimums default to 0 (set per-token if the position is large).
      </div>
      <input
        className="admin-card__input"
        inputMode="numeric"
        placeholder="NPM tokenId"
        value={tokenId}
        onChange={(e) => setTokenId(e.target.value)}
      />
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
        disabled={!enabled || !valid}
        onClick={send}
      >
        Close pool
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
