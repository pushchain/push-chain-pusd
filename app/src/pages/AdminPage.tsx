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
      </Section>

      {/* ============= POOL_ADMIN ============= */}
      <Section
        id="pool-admin"
        num="iii."
        title="Pool Admin"
        subtitle="Manage the vault basket and (later) Uniswap V3 positions."
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
