/**
 * DocsPage — /docs route.
 *
 * Two parts on the same scrollable page:
 *
 *   Part 1 — Editorial index
 *     Chapters I–VI linking out to canonical source files in the repository.
 *
 *   Part 2 — Developer integration guide  (#developer)
 *     Inline reference: architecture, on-chain contract calls, off-chain SDK.
 *     Navigable via the anchor strip at the top of Part 2.
 *
 * Design: Direction C brutalist editorial. All CSS from global.css design tokens.
 * Code blocks use var(--c-ink) surface / var(--c-cream) text — no new colors.
 */

import type { ReactNode } from "react";

/* =========================================================================
   PART 1 — Editorial index data
   ====================================================================== */

/* =========================================================================
   Developer Docs helpers
   ====================================================================== */

function Ic({ children }: { children: string }) {
  return (
    <code
      style={{
        fontFamily: "var(--f-mono)",
        fontSize: "0.875em",
        background: "var(--c-paper-warm)",
        padding: "1px 5px",
        borderRadius: 2,
      }}
    >
      {children}
    </code>
  );
}

function Block({ lang, children }: { lang?: string; children: string }) {
  return (
    <div
      style={{
        margin: "16px 0",
        borderTop: lang ? undefined : "1px solid var(--c-rule)",
      }}
    >
      {lang && (
        <div
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "var(--c-ink)",
            color: "var(--c-ink-mute)",
            padding: "5px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {lang}
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: "16px",
          background: "var(--c-ink)",
          color: "var(--c-cream)",
          fontFamily: "var(--f-mono)",
          fontSize: 12.5,
          lineHeight: 1.75,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        <code>{children.replace(/^\n/, "")}</code>
      </pre>
    </div>
  );
}

function DevTable({
  head,
  rows,
}: {
  head: string[];
  rows: (string | ReactNode)[][];
}) {
  return (
    <div style={{ overflowX: "auto", margin: "16px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--f-mono)",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: "7px 12px",
                  background: "var(--c-ink)",
                  color: "var(--c-cream)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: "var(--rule-thin)" }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "9px 12px",
                    verticalAlign: "top",
                    background:
                      ri % 2 === 0 ? "var(--c-paper)" : "var(--c-cream)",
                    fontFamily: "var(--f-mono)",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {typeof cell === "string" && cell.startsWith("`") ? (
                    <Ic>{cell.replace(/`/g, "")}</Ic>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        borderLeft: "3px solid var(--c-gold)",
        paddingLeft: 14,
        margin: "14px 0",
        fontFamily: "var(--f-mono)",
        fontSize: 12,
        lineHeight: 1.65,
        color: "var(--c-ink-dim)",
      }}
    >
      {children}
    </div>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return (
    <h4
      style={{
        fontFamily: "var(--f-mono)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        margin: "28px 0 12px",
        color: "var(--c-ink)",
        borderBottom: "var(--rule-thin)",
        paddingBottom: 7,
      }}
    >
      {children}
    </h4>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--f-body)",
        fontSize: 15,
        lineHeight: 1.7,
        color: "var(--c-ink-dim)",
        margin: "0 0 12px",
      }}
    >
      {children}
    </p>
  );
}

/**
 * Heavyweight sub-chapter divider, e.g. "iii.i  Deposit". Mirrors the
 * main chapter head (display italic numeral + display title) at a smaller
 * scale so a single chapter can be cleanly split into operations.
 */
function SubChapter({
  num,
  title,
  lede,
}: {
  num: string;
  title: string;
  lede?: string;
}) {
  return (
    <div style={{ margin: "48px 0 18px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 16,
          alignItems: "baseline",
          borderTop: "1px solid var(--c-ink)",
          paddingTop: 18,
        }}
      >
        <div
          style={{
            fontFamily: "var(--f-display)",
            fontStyle: "italic",
            fontSize: "clamp(20px, 2.2vw, 28px)",
            lineHeight: 1.05,
            color: "var(--c-magenta)",
            letterSpacing: "-0.02em",
          }}
        >
          {num}
        </div>
        <div>
          <h3
            style={{
              fontFamily: "var(--f-display)",
              fontWeight: 500,
              fontSize: "clamp(20px, 2.2vw, 28px)",
              lineHeight: 1.1,
              letterSpacing: "-0.015em",
              color: "var(--c-ink)",
              margin: 0,
            }}
          >
            {title}
          </h3>
          {lede && (
            <p
              style={{
                fontFamily: "var(--f-display)",
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--c-ink-dim)",
                margin: "8px 0 0",
                maxWidth: "64ch",
              }}
            >
              {lede}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline tag that flags a code example as belonging to one of the two
 * write paths developers will encounter on Push Chain:
 *
 *   path "a" — external-chain wallet (MetaMask/Phantom/etc.) that gets
 *              a relay-managed Donut account with multicall support.
 *              Rendered with the magenta accent.
 *
 *   path "b" — native Push EOA (Push Wallet, raw private key against the
 *              Donut RPC). Vanilla EVM externally-owned account. No
 *              multicall. Rendered with the espresso/ink accent.
 */
function PathTag({ path }: { path: "a" | "b" }) {
  const isA = path === "a";
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--f-mono)",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        background: isA ? "var(--c-magenta)" : "var(--c-ink)",
        color: "var(--c-cream)",
        padding: "3px 9px 4px",
        marginRight: 10,
        marginBottom: 2,
        verticalAlign: "2px",
        borderRadius: 1,
        whiteSpace: "nowrap",
      }}
    >
      Path {path} · {isA ? "External chain" : "Push EOA"}
    </span>
  );
}

/* =========================================================================
   Page
   ====================================================================== */

export default function DocsPage() {
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          Developer Docs
          ═══════════════════════════════════════════════════════════════ */}
      <section
        className="hero hero--compact"
        style={{ borderBottom: 0 }}
        id="developer"
      >
        <div className="container">
          <div className="hero__kicker">
            <span>§ Developer Docs · THE TRUTH</span>
            <span>COMPOSABLE· ON-CHAIN· OFF-CHAIN</span>
          </div>
          <h1
            className="hero__title"
            style={{ fontSize: "clamp(44px, 5.5vw, 72px)" }}
          >
            Build with <em style={{ color: "var(--c-magenta)" }}>PUSD</em>.
          </h1>
          <p className="hero__lead" style={{ maxWidth: "72ch" }}>
            Architecture first. Then on-chain direct contract calls. Then the
            off-chain SDK path via Push Chain's universal transaction layer.
          </p>
        </div>
      </section>

      <section
        style={{
          background: "var(--c-paper)",
          borderTop: "var(--rule-thin)",
          borderBottom: "var(--rule-thin)",
        }}
      >
        <div className="container">
          {/* ── Navigation index ──────────────────────────────────────── */}
          <nav
            aria-label="Developer guide sections"
            style={{
              display: "flex",
              gap: "2px",
              flexWrap: "wrap",
              padding: "16px 0 12px 0",
              marginBottom: 0,
            }}
          >
            {[
              { label: "Architecture", href: "#arch" },
              { label: "Off-Chain SDK · Writes", href: "#off-chain" },
              { label: "On-Chain Contract Call", href: "#on-chain" },
              { label: "ABI Fragments", href: "#abi" },
              { label: "Quick Ref", href: "#quick-ref" },
              { label: "For AI · LLMs.txt", href: "#machine-readable" },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--c-ink-mute)",
                  textDecoration: "none",
                  padding: "5px 14px",
                  border: "var(--rule-thin)",
                  marginRight: 6,
                  marginBottom: 4,
                  transition: "background 120ms, color 120ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--c-ink)";
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--c-cream)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--c-ink-mute)";
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section>
        <div className="container">
          {/* ── i. Architecture ─────────────────────────────────────────── */}
          <div className="docs__chapter" id="arch">
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">i.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">Architecture</h2>
                <p className="docs__chapter-lede">
                  Two upgradeable contracts on Push Chain Donut Testnet. PUSD is
                  a minimal ERC-20. PUSDManager owns all reserve logic.
                </p>
              </div>
            </div>

            <Block lang="contracts">
              {`PUSD.sol — ERC-20, 6 decimals, UUPS proxy
  mint(to, amount)           ← MINTER_ROLE only  → held by PUSDManager
  burn(from, amount)         ← BURNER_ROLE only  → held by PUSDManager

PUSDManager.sol — reserve orchestrator, UUPS proxy
  deposit(token, amount, recipient)                           → mints PUSD
  redeem(pusdAmount, preferredAsset, allowBasket, recipient)  → burns PUSD`}
            </Block>

            <SubHead>Live addresses · Donut Testnet (chain 42101)</SubHead>
            <DevTable
              head={["Contract", "Proxy address"]}
              rows={[
                ["PUSD", "`0x488d080e16386379561a47a4955d22001d8a9d89`"],
                ["PUSDManager", "`0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46`"],
              ]}
            />
            <p className="docs__entry-meta" style={{ marginTop: 6 }}>
              RPC:{" "}
              <a
                href="https://evm.donut.rpc.push.org/"
                target="_blank"
                rel="noreferrer"
              >
                https://evm.donut.rpc.push.org/
              </a>
              {" · "}
              Explorer:{" "}
              <a
                href="https://donut.push.network"
                target="_blank"
                rel="noreferrer"
              >
                https://donut.push.network
              </a>
            </p>

            <SubHead>
              Reserve tokens — 9 total, 5 chains, all 6 decimals on Donut
            </SubHead>
            <DevTable
              head={["Symbol", "Origin chain", "Donut address"]}
              rows={[
                [
                  "USDT",
                  "Ethereum Sepolia",
                  "`0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3`",
                ],
                [
                  "USDC",
                  "Ethereum Sepolia",
                  "`0x7A58048036206bB898008b5bBDA85697DB1e5d66`",
                ],
                [
                  "USDT",
                  "Solana Devnet",
                  "`0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34`",
                ],
                [
                  "USDC",
                  "Solana Devnet",
                  "`0xCd6e2e7A43E0Cfd0Df83dCb0EdB5c5EC4F27Ce8f`",
                ],
                [
                  "USDT",
                  "Base Sepolia",
                  "`0x9f475519ac7bdbEC65F00E2f6A6CB26c20B5Ff52`",
                ],
                [
                  "USDC",
                  "Base Sepolia",
                  "`0x2fCC0Ef4F0b0Ffb5Ee93F48B48F50Ef5e66c0b5b`",
                ],
                [
                  "USDT",
                  "Arbitrum Sepolia",
                  "`0x3A3c8aFC2e7BCBe3d79Af9dD4cA4CD7C1eEDD23c`",
                ],
                [
                  "USDC",
                  "Arbitrum Sepolia",
                  "`0x9fa527Fe5e16b9e1bfa72Cb9C01d40aaab11EBC2`",
                ],
                [
                  "USDT",
                  "BNB Testnet",
                  "`0xEc9E90Dc88D86dB0e9E1f4aA59a61Df5f7A5E3b1`",
                ],
              ]}
            />

            <SubHead>Fee model</SubHead>
            <DevTable
              head={["Fee", "When", "Default", "Max", "Effect"]}
              rows={[
                [
                  "Deposit haircut",
                  "On mint",
                  "0 bps (0%)",
                  "4000 bps (40%)",
                  "Stays in reserve as surplus, used to deprecate risky tokens",
                ],
                [
                  "Base redemption fee",
                  "On every redeem",
                  "5 bps (0.05%)",
                  "100 bps (1%)",
                  "Accrued per-token, swept to treasury",
                ],
                [
                  "Preferred asset premium",
                  "Single-token redeem",
                  "preferredFeeMin–Max",
                  "200 bps (2%)",
                  "Interpolated by token liquidity",
                ],
              ]}
            />
            <Block lang="fee math">
              {`Net PUSD minted  = amount − floor(amount × haircutBps / 10000)
Net token out    = pusdAmount − floor(pusdAmount × (baseFee + preferredFee) / 10000)`}
            </Block>

            <SubHead>Redemption routing</SubHead>
            <DevTable
              head={["Route", "Condition", "Fee"]}
              rows={[
                [
                  "Preferred asset",
                  "preferredAsset ENABLED + sufficient liquidity",
                  "baseFee + preferredFee",
                ],
                [
                  "Basket",
                  "preferred unavailable, allowBasket = true",
                  "baseFee only",
                ],
                [
                  "Emergency",
                  "any token in EMERGENCY_REDEEM status",
                  "forced proportional drain",
                ],
              ]}
            />
            <Note>
              Always pass <Ic>allowBasket = true</Ic> in production
              integrations. If the preferred token runs dry the basket route
              activates — your transaction won't revert.
            </Note>
          </div>

          {/* ── ii. Off-Chain SDK ──────────────────────────────────────── */}
          <div className="docs__chapter" id="off-chain">
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">ii.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">Off-Chain SDK · Writes</h2>
                <p className="docs__chapter-lede">
                  Every PUSD mutation (mint, redeem) goes through Push
                  Chain's universal transaction layer. Use{" "}
                  <Ic>@pushchain/ui-kit</Ic> in React and{" "}
                  <Ic>@pushchain/core</Ic> in Node. <br />
                  <br />
                  The SDK call site is always{" "}
                  <Ic>pushChainClient.universal.sendTransaction(...)</Ic>;
                  what changes is the <strong>shape of the payload</strong>{" "}
                  depending on which wallet signed in and where the funds
                  live (Push Chain, Ethereum, Solana, Base, Arbitrum, BNB).
                </p>
              </div>
            </div>

            <Note>
              <strong>Two write paths.</strong> Pick by wallet type, not by
              chain.
              <br />
              <br />
              <PathTag path="a" /> MetaMask on Sepolia, Phantom on Solana,
              Coinbase Wallet, etc. {"->"} the user gets a relay-managed
              account on Donut that supports multicall. Approve + deposit
              ride in <strong>one signature</strong>, batched as a
              multicall: pass both calls inside the <Ic>data</Ic> array of
              one <Ic>sendTransaction</Ic>. The outer <Ic>to</Ic> is the
              zero address (the marker the relay reads as "this is a
              multicall, walk the legs against their own <Ic>to</Ic>").
              <br />
              <br />
              <PathTag path="b" /> Push Wallet, or any private key signing
              directly against the Donut RPC {"->"} a regular EVM
              externally-owned account, no multicall. Mint takes{" "}
              <strong>two separate signatures</strong> (approve, then
              deposit). Redeem is a <strong>single signature</strong>{" "}
              {"->"} <Ic>PUSDManager</Ic> burns the user's PUSD directly
              via <Ic>BURNER_ROLE</Ic>, so no PUSD approval is required.
              <br />
              <br />
              <strong>Bridging.</strong> If the reserve token lives on the
              user's origin chain (USDT on Sepolia, USDC on Solana, etc.)
              instead of already sitting on Donut, attach a <Ic>funds</Ic>{" "}
              param to the same call. The relay moves the tokens over to
              your Push Chain account before the legs execute. Bridging
              applies to path (a) only; path (b) assumes the token is
              already on Donut.
            </Note>

            <SubChapter
              num="ii.i"
              title="Deposit"
              lede="Mint PUSD by sending the reserve token to PUSDManager.
                Shape varies by wallet type: external-chain wallets batch
                approve + deposit in one signed multicall (path a),
                native Push EOAs send the two transactions sequentially
                (path b)."
            />

            {/* ── UI Kit ── */}
            <SubHead>React · @pushchain/ui-kit</SubHead>
            <Block lang="bash">{`npm install @pushchain/ui-kit@latest`}</Block>

            <Lead>Wrap your app root once with the provider:</Lead>
            <Block lang="tsx">
              {`import { PushUniversalWalletProvider, PushUI } from '@pushchain/ui-kit';

// main.tsx
<PushUniversalWalletProvider
  config={{
    network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
    app: { title: 'My PUSD App' },
    login: { email: true, google: true, wallet: true },
  }}
>
  <App />
</PushUniversalWalletProvider>`}
            </Block>

            <Lead>
              <PathTag path="a" />Mint with an external-chain wallet {"->"}{" "}
              approve + deposit batched in one signature, funds already on
              Donut:
            </Lead>
            <Block lang="tsx">
              {`import { usePushChainClient, usePushChain } from '@pushchain/ui-kit';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

function MintButton() {
  const { pushChainClient, isInitialized, error } = usePushChainClient();
  const { PushChain } = usePushChain();

  if (error)            return <div role="alert">{error.message}</div>;
  if (!isInitialized)   return <div>Loading…</div>;
  if (!pushChainClient) return null;

  const mint = async () => {
    const h         = PushChain.utils.helpers;
    const amount    = h.parseUnits('100', 6);                              // 100 USDT (6 dec)
    const recipient = pushChainClient.universal.account.address as \`0x\${string}\`;
    const TOKEN     = '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3' as const; // USDT-Sepolia on Donut
    const MANAGER   = '0x809d550fca64d94Bd9F66E60752A544199cfAC3D' as const;

    const multicall = [
      { to: TOKEN,   value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
      { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, recipient] }) },
    ];

    // Outer 'to' is the zero sentinel -> the relay treats this as a multicall
    // and walks each leg against its own 'to'.
    const tx = await pushChainClient.universal.sendTransaction({
      to:    ZERO,
      value: 0n,
      data:  multicall,
    });
    await tx.wait();
  };

  return <button onClick={mint}>Mint 100 PUSD</button>;
}`}
            </Block>

            <Lead>
              <PathTag path="a" />Same flow, with bridging {"->"} user
              holds USDT on Ethereum Sepolia, attach a <Ic>funds</Ic> param
              and the relay bridges the tokens into the user's Push Chain
              account before the multicall runs. Still one signature.
            </Lead>
            <Block lang="tsx">
              {`// User signs once with MetaMask on Ethereum Sepolia.
// Relay bridges USDT into the user's Push Chain account, then runs the multicall.
const tx = await pushChainClient.universal.sendTransaction({
  to:    ZERO,
  value: 0n,
  data:  multicall,                                     // approve + deposit, as above
  funds: {
    amount,                                             // 100 USDT (6 dec)
    token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT,
  },
});
await tx.wait();`}
            </Block>

            <Lead>
              <PathTag path="b" />Mint with a native Push EOA {"->"} no
              multicall on an EOA, so split the flow into two signed
              transactions. Wait for the approve receipt before sending
              the deposit so the allowance is on-chain when the deposit
              lands:
            </Lead>
            <Block lang="tsx">
              {`const mintFromPushEoa = async () => {
  const h         = PushChain.utils.helpers;
  const amount    = h.parseUnits('100', 6);
  const recipient = pushChainClient.universal.account.address as \`0x\${string}\`;

  // Tx 1 (signature 1 of 2): approve PUSDManager to spend the reserve token.
  const approveTx = await pushChainClient.universal.sendTransaction({
    to:    TOKEN,
    value: 0n,
    data:  h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }),
  });
  await approveTx.wait();

  // Tx 2 (signature 2 of 2): deposit, mint PUSD to recipient.
  const depositTx = await pushChainClient.universal.sendTransaction({
    to:    MANAGER,
    value: 0n,
    data:  h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, recipient] }),
  });
  await depositTx.wait();
};`}
            </Block>

            {/* ── Core (Deposit) ── */}
            <SubHead>Node.js · @pushchain/core</SubHead>
            <Lead>
              Same primitives, server-side. Wrap an ethers / viem / Solana
              signer into a Push universal signer. The path you get is a
              property of the signer you wrap: an external-chain signer
              gets the relay-managed Donut account (path a, multicall);
              a key pointed at the Donut RPC gets a native Push EOA
              (path b, sequential transactions).
            </Lead>
            <Block lang="bash">{`npm install @pushchain/core ethers`}</Block>

            <Lead>
              <PathTag path="a" />Mint server-side on behalf of an
              external-chain user {"->"} approve + deposit batched in one
              signed multicall:
            </Lead>
            <Block lang="ts">
              {`import { PushChain } from '@pushchain/core';
import { ethers } from 'ethers';

// External-chain signer -> the wrapped account on Donut supports multicall.
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!,
  new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/<KEY>'));
const signer = PushChain.utils.signer.toUniversalFromEthersSigner(wallet);
const pc     = await PushChain.initialize(signer, {
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
});

const ZERO   = '0x0000000000000000000000000000000000000000';
const h      = pc.utils.helpers;
const amount = h.parseUnits('100', 6);
const owner  = pc.universal.account.address;

await (await pc.universal.sendTransaction({
  to:    ZERO,
  value: 0n,
  data: [
    { to: TOKEN,   value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
    { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, owner] }) },
  ],
})).wait();`}
            </Block>

            <Lead>
              <PathTag path="b" />Mint server-side with a native Push EOA
              (private key points at the Donut RPC) {"->"} approve, then
              deposit, two signed transactions:
            </Lead>
            <Block lang="ts">
              {`const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!,
  new ethers.JsonRpcProvider('https://evm.donut.rpc.push.org/'));
const signer = PushChain.utils.signer.toUniversalFromEthersSigner(wallet);
const pc     = await PushChain.initialize(signer, {
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
});

const h      = pc.utils.helpers;
const amount = h.parseUnits('100', 6);
const owner  = await wallet.getAddress();

// Tx 1: approve PUSDManager to spend the reserve token.
await (await pc.universal.sendTransaction({
  to:    TOKEN,
  value: 0n,
  data:  h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }),
})).wait();

// Tx 2: deposit, mint PUSD to owner.
await (await pc.universal.sendTransaction({
  to:    MANAGER,
  value: 0n,
  data:  h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, owner] }),
})).wait();`}
            </Block>

            <SubChapter
              num="ii.ii"
              title="Redeem"
              lede="Burn PUSD for the preferred reserve token. Identical on
                both paths → a single signed call. PUSDManager holds
                BURNER_ROLE on PUSD and burns msg.sender's balance
                directly, so no PUSD approval is required."
            />
            <Note>
              Path (a) and path (b) issue the <strong>exact same call</strong>
              {" "}for redeem. The only difference is who holds the signing
              key. The cross-chain payout pattern (burn on Push Chain, then
              bridge the freed reserve token out) uses{" "}
              <Ic>prepareTransaction</Ic> +{" "}
              <Ic>executeTransactions</Ic>; everything else is a single{" "}
              <Ic>sendTransaction</Ic>.
            </Note>

            {/* ── UI Kit (Redeem) ── */}
            <SubHead>React · @pushchain/ui-kit</SubHead>

            <Lead>
              Redeem to your Push Chain account. <Ic>PUSDManager</Ic>{" "}
              burns <Ic>pusdAmount</Ic> of the caller's PUSD and sends
              the preferred reserve token to <Ic>recipient</Ic>:
            </Lead>
            <Block lang="tsx">
              {`const MANAGER = '0x809d550fca64d94Bd9F66E60752A544199cfAC3D' as const;
const TOKEN   = '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3' as const; // USDT-Sepolia on Donut, the asset you want back

const redeem = async () => {
  const h          = PushChain.utils.helpers;
  const pusdAmount = h.parseUnits('99', 6);
  const recipient  = pushChainClient.universal.account.address as \`0x\${string}\`;

  // One signature, one transaction. No approve. PUSDManager.redeem(...)
  // calls pusd.burn(msg.sender, pusdAmount) under the hood.
  const tx = await pushChainClient.universal.sendTransaction({
    to:    MANAGER,
    value: 0n,
    data:  h.encodeTxData({
      abi:          REDEEM_ABI,
      functionName: 'redeem',
      args:         [pusdAmount, TOKEN, true, recipient],
    }),
  });
  await tx.wait();
};`}
            </Block>

            <Lead>
              Redeem and pay out on an external chain {"->"} two real
              top-level transactions (burn on Push Chain, then bridge the
              freed reserve token out to the destination chain). This is
              the one place you actually need{" "}
              <Ic>prepareTransaction</Ic> +{" "}
              <Ic>executeTransactions</Ic>; the second hop carries{" "}
              <Ic>{"to: { address, chain }"}</Ic> so the relay knows where
              to send the tokens. Same flow on both paths:
            </Lead>
            <Block lang="tsx">
              {`const redeemAndPayout = async () => {
  const h              = PushChain.utils.helpers;
  const pusdAmount     = h.parseUnits('99', 6);
  const pushAccount    = pushChainClient.universal.account.address as \`0x\${string}\`;
  const externalWallet = '0xUserOnSepolia' as const;

  // Hop 1: burn PUSD on Push Chain. recipient = the user's Push Chain
  //        account so the freed USDT lands there. Single call, no approve.
  const burnHop = await pushChainClient.universal.prepareTransaction({
    to:    MANAGER,
    value: 0n,
    data:  h.encodeTxData({
      abi:          REDEEM_ABI,
      functionName: 'redeem',
      args:         [pusdAmount, TOKEN, true, pushAccount],
    }),
  });

  // Hop 2: forward the received USDT to the user's wallet on Sepolia.
  //        to.chain + to.address tells the relay to bridge out; 'funds'
  //        names the token to move.
  const payoutHop = await pushChainClient.universal.prepareTransaction({
    to:    { address: externalWallet, chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },
    value: 0n,
    data:  '0x',
    funds: { amount: pusdAmount, token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT },
  });

  const result = await pushChainClient.universal.executeTransactions(
    [burnHop, payoutHop],
    { progressHook: (p) => console.log(p.id, p.message) },
  );
  if (!result.success) throw new Error('Cross-chain redeem failed');
};`}
            </Block>

            {/* ── Core (Redeem) ── */}
            <SubHead>Node.js · @pushchain/core</SubHead>
            <Lead>
              Server-side redeem {"->"} <strong>one</strong> signed
              transaction on either path. Same call regardless of which
              signer is wrapped:
            </Lead>
            <Block lang="ts">
              {`// Works for both path (a) and path (b) -- same RPC, same call.
const pusdAmount = h.parseUnits('99', 6);
const owner      = pc.universal.account.address; // or await wallet.getAddress()

await (await pc.universal.sendTransaction({
  to:    MANAGER,
  value: 0n,
  data:  h.encodeTxData({
    abi:          REDEEM_ABI,
    functionName: 'redeem',
    args:         [pusdAmount, TOKEN, true, owner],
  }),
})).wait();`}
            </Block>
          </div>

          {/* ── iii. On-Chain Contract Call ──────────────────────────────── */}
          <div className="docs__chapter" id="on-chain">
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">iii.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">On-Chain Contract Call</h2>
                <p className="docs__chapter-lede">
                  How another smart contract on Donut talks to PUSD and
                  PUSDManager. No SDK, no off-chain relay, just plain
                  Solidity calling deployed addresses. Use this when your
                  protocol holds PUSD, mints / burns PUSD on behalf of users,
                  or quotes its own state against the reserve.
                </p>
              </div>
            </div>

            <Note>
              <strong>Both contracts live on Donut Testnet (chain 42101).</strong>
              {" "}A contract that wants to integrate PUSD must itself be
              deployed on Donut. Cross-chain callers go through{" "}
              <a href="#off-chain">Off-Chain SDK · Writes</a>; on-chain
              callers just <Ic>import</Ic> the interfaces below and call
              the live addresses directly.
            </Note>

            <SubHead>Minimal interfaces</SubHead>
            <Lead>
              Drop these two interfaces into your project. They expose
              every function you'll need from another contract: ERC-20
              moves on PUSD, plus deposit / redeem / read helpers on
              PUSDManager. Both contracts use 6 decimals.
            </Lead>
            <Block lang="solidity">
              {`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPUSD {
    function totalSupply()                       external view returns (uint256);
    function balanceOf(address account)          external view returns (uint256);
    function transfer(address to, uint256 amt)   external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function approve(address spender, uint256 amt) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPUSDManager {
    enum TokenStatus { REMOVED, ENABLED, REDEEM_ONLY, EMERGENCY_REDEEM }

    struct TokenInfo {
        bool    exists;
        uint8   status;
        uint8   decimals;
        uint16  surplusHaircutBps;
        string  name;
        string  chainNamespace;
    }

    // Mutators -- called by the integrating contract.
    function deposit(address token, uint256 amount, address recipient) external;
    function redeem (uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient) external;

    // Reads -- safe to call from any context.
    function baseFee()                                  external view returns (uint256);
    function preferredFeeMin()                          external view returns (uint256);
    function preferredFeeMax()                          external view returns (uint256);
    function getSupportedTokensCount()                  external view returns (uint256);
    function getTokenStatus(address token)              external view returns (uint8);
    function getTokenInfo(address token)                external view returns (TokenInfo memory);
    function getAccruedSurplus(address token)           external view returns (uint256);
}`}
            </Block>

            <SubChapter
              num="iii.i"
              title="Deposit"
              lede="Mint PUSD from another contract. Your contract is the
                caller of PUSDManager.deposit, so it must hold the reserve
                token and approve the manager to pull it. Recipient of the
                fresh PUSD is whichever address you pass."
            />
            <Lead>
              The flow is: pull reserve from your end user, approve{" "}
              <Ic>PUSDManager</Ic>, call <Ic>deposit</Ic>.{" "}
              <Ic>safeTransferFrom</Ic> inside the manager pulls from{" "}
              <Ic>address(this)</Ic>, so the allowance is from your
              contract, not from the user.
            </Lead>
            <Block lang="solidity">
              {`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPUSD, IPUSDManager} from "./IPUSD.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PUSDMinter {
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46);

    /// @notice Pull \`amount\` of \`token\` from caller, deposit it into
    ///         PUSDManager, mint PUSD straight to \`recipient\`.
    function mintFor(address token, uint256 amount, address recipient) external {
        // 1. Move reserve from caller to this contract.
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // 2. Approve PUSDManager to pull it (use forceApprove on USDT etc.).
        IERC20(token).approve(address(MANAGER), amount);

        // 3. Deposit -> mints PUSD 1:1 (minus baseFee + surplusHaircut)
        //    directly to the recipient.
        MANAGER.deposit(token, amount, recipient);
    }
}`}
            </Block>

            <SubChapter
              num="iii.ii"
              title="Redeem"
              lede="Burn PUSD from another contract for the reserve token of
                your choice. The mirror image of deposit, but simpler:
                PUSDManager holds BURNER_ROLE and burns msg.sender's PUSD
                directly, so no approval is needed."
            />
            <Lead>
              Pull PUSD from your end user into your contract, then call{" "}
              <Ic>PUSDManager.redeem</Ic>. Your contract becomes{" "}
              <Ic>msg.sender</Ic> on that call, so the burn comes from
              your contract's PUSD balance and the freed reserve token
              lands at the <Ic>recipient</Ic> you pass.
            </Lead>
            <Block lang="solidity">
              {`contract PUSDRedeemer {
    IPUSD        public constant PUSD =
        IPUSD(0x488d080e16386379561A47A4955d22001D8a9D89);
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46);

    /// @notice Pull PUSD from the caller, redeem it for \`preferredAsset\`,
    ///         deliver the proceeds to \`recipient\`.
    /// @param  allowBasket  If true and the preferred asset is short on
    ///                      liquidity, the manager pays out a basket of
    ///                      multiple reserve tokens instead of reverting.
    function redeemFor(
        uint256 pusdAmount,
        address preferredAsset,
        bool    allowBasket,
        address recipient
    ) external {
        // Pull PUSD into this contract -- THIS contract becomes msg.sender
        // when it calls redeem(...) below, so the burn comes from here.
        PUSD.transferFrom(msg.sender, address(this), pusdAmount);

        // No approve needed. PUSDManager calls pusd.burn(msg.sender, ...)
        // under BURNER_ROLE; the manager doesn't need our allowance.
        MANAGER.redeem(pusdAmount, preferredAsset, allowBasket, recipient);
    }
}`}
            </Block>

            <SubChapter
              num="iii.iii"
              title="Read"
              lede="Read protocol state on-chain. All helpers are view
                functions, so any contract can call them in the same
                transaction it is executing in -> no oracle, no off-chain
                trip. Useful for fee math, liquidity checks before
                quoting, or surfacing status to your own users."
            />
            <Lead>
              The reader below covers the three reads you'll reach for
              most often: a deposit-side quote (<Ic>quoteMint</Ic>), the
              manager's current reserve for a token (<Ic>reserveOf</Ic>),
              and PUSD in circulation (<Ic>circulating</Ic>).
            </Lead>
            <Block lang="solidity">
              {`contract PUSDReader {
    IPUSD        public constant PUSD =
        IPUSD(0x488d080e16386379561A47A4955d22001D8a9D89);
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46);

    /// Quote how much PUSD a user would get from depositing \`amount\` of
    /// \`token\`, accounting for the manager's base fee (in basis points).
    /// 6-decimal math throughout.
    function quoteMint(address token, uint256 amount)
        external view returns (uint256 expectedPUSD, IPUSDManager.TokenStatus status)
    {
        IPUSDManager.TokenInfo memory info = MANAGER.getTokenInfo(token);
        require(info.exists, "PUSDReader: unsupported token");

        uint256 baseFeeBps = MANAGER.baseFee();              // e.g. 5 = 0.05%
        uint256 fee        = (amount * baseFeeBps) / 10_000;
        expectedPUSD       = amount - fee;                    // 1:1 minus fee
        status             = IPUSDManager.TokenStatus(info.status);
    }

    /// Total reserve held by the manager for a given token.
    function reserveOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(MANAGER));
    }

    /// PUSD in circulation.
    function circulating() external view returns (uint256) {
        return PUSD.totalSupply();
    }
}`}
            </Block>
          </div>

          {/* ── ABI fragments ──────────────────────────────────────────────── */}
          <div className="docs__chapter" id="abi">
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">iv.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">ABI Fragments</h2>
                <p className="docs__chapter-lede">
                  Copy these into any integration — they work with both the SDK{" "}
                  <Ic>encodeTxData</Ic> helper and directly with ethers.js{" "}
                  <Ic>ContractInterface</Ic>.
                </p>
              </div>
            </div>

            <Block lang="ts">
              {`const APPROVE_ABI = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }] }] as const;

const DEPOSIT_ABI = [{ type: 'function', name: 'deposit', stateMutability: 'nonpayable',
  inputs: [{ name: 'token',     type: 'address' },
           { name: 'amount',    type: 'uint256' },
           { name: 'recipient', type: 'address' }],
  outputs: [] }] as const;

const REDEEM_ABI = [{ type: 'function', name: 'redeem', stateMutability: 'nonpayable',
  inputs: [{ name: 'pusdAmount',     type: 'uint256' },
           { name: 'preferredAsset', type: 'address' },
           { name: 'allowBasket',    type: 'bool'    },
           { name: 'recipient',      type: 'address' }],
  outputs: [] }] as const;`}
            </Block>
          </div>

          {/* ── Quick reference ──────────────────────────────────────────── */}
          <div className="docs__chapter" id="quick-ref">
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">v.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">Quick Reference</h2>
                <p className="docs__chapter-lede">
                  Common operations and the gotchas that catch new integrators.
                </p>
              </div>
            </div>

            <SubHead>Function calls</SubHead>
            <DevTable
              head={["Operation", "Contract", "Function"]}
              rows={[
                [
                  "Mint PUSD",
                  "PUSDManager",
                  "`deposit(token, amount, recipient)`",
                ],
                [
                  "Redeem PUSD",
                  "PUSDManager",
                  "`redeem(pusdAmount, preferredAsset, allowBasket, recipient)`",
                ],
                ["PUSD balance", "PUSD", "`balanceOf(address)`"],
                ["Total supply", "PUSD", "`totalSupply()`"],
                ["Token info", "PUSDManager", "`getTokenInfo(token)`"],
                [
                  "Fee config",
                  "PUSDManager",
                  "`baseFee()`, `preferredFeeMin()`, `preferredFeeMax()`",
                ],
                [
                  "Reserve balance",
                  "reserve token",
                  "`balanceOf(PUSD_MANAGER)`",
                ],
                [
                  "Accrued surplus",
                  "PUSDManager",
                  "`getAccruedSurplus(token)`",
                ],
              ]}
            />

            <SubHead>Common mistakes</SubHead>
            <DevTable
              head={["Mistake", "Fix"]}
              rows={[
                [
                  "sendTransaction([leg1, leg2]) — bare array",
                  "Cascade rides in data: sendTransaction({ to: ZERO, value: 0n, data: legs })",
                ],
                [
                  "Forgetting the approve leg",
                  "Approve is leg 0, mutator is leg 1 — both in the data array",
                ],
                [
                  "parseUnits(value, 18)",
                  "PUSD + all reserves use 6 decimals — use parseUnits(value, 6)",
                ],
                [
                  "recipient = address(0)",
                  "Both deposit and redeem revert on zero address",
                ],
                [
                  "Preferred redeem always expected to succeed",
                  "Pass allowBasket = true as live fallback",
                ],
                [
                  "Calling manager.deposit() with an ethers.Wallet",
                  "Reserve tokens live on origin chains — go through the SDK so the relay bridges + executes via the UEA",
                ],
                [
                  "npm install @pushchain/core in a UI Kit app",
                  "Use usePushChain() — core is already bundled in ui-kit",
                ],
              ]}
            />

          </div>

          {/* ── vi. Machine Readable ──────────────────────────────────────── */}
          <div
            className="docs__chapter"
            id="machine-readable"
            style={{ borderBottom: "none" }}
          >
            <div className="docs__chapter-head">
              <div className="docs__chapter-num">vi.</div>
              <div className="docs__chapter-meta">
                <h2 className="docs__chapter-title">
                  Machine Readable · LLMs.txt for AI
                </h2>
                <p className="docs__chapter-lede">
                  Two artifacts ship with this app for AI coding agents:
                  a <strong>Skill</strong> (a single self-contained
                  integration guide an agent can drop into its toolkit)
                  and an <Ic>llms.txt</Ic> map (an entry point that
                  points agents at every other agent-readable resource
                  in the repo).
                </p>
              </div>
            </div>

            <Note>
              Point your AI coding assistant (Claude Code, Cursor, Cline,
              etc.) at the URLs below. The Skill is self-contained —
              every address, every code path, every gotcha lives inside
              it. <Ic>llms.txt</Ic> is the agent's table of contents for
              the broader repo.
            </Note>

            <SubChapter
              num="vi.i"
              title="Agent Skill"
              lede="A single markdown file an LLM can ingest to get
                everything it needs to integrate PUSD: addresses, two
                write paths, every code example, ABI fragments, common
                mistakes."
            />
            <Lead>
              Source of truth for every example you've just read.
              Mirrors chapters i-v above; updated whenever those
              chapters change.
            </Lead>
            <Block lang="url">
              {`https://pusd.push.org/agents/skill/push-pusd/SKILL.md`}
            </Block>
            <p
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 12,
                lineHeight: 1.65,
                color: "var(--c-ink-dim)",
                margin: "8px 0 0",
              }}
            >
              <a
                href="/agents/skill/push-pusd/SKILL.md"
                style={{ color: "var(--c-magenta)" }}
              >
                Open the Skill →
              </a>
            </p>

            <SubChapter
              num="vi.ii"
              title="LLMs.txt"
              lede="A served entry-point map at the site root. Smaller
                than the Skill -> it just tells an agent where the
                Skill, repo, and design docs live. Useful when the
                agent landed on the domain but doesn't yet know what's
                here."
            />
            <Lead>
              One file, one URL. Following the{" "}
              <a
                href="https://llmstxt.org/"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--c-magenta)" }}
              >
                llms.txt convention
              </a>
              , agents will fetch <Ic>/llms.txt</Ic> by default.
            </Lead>
            <Block lang="url">{`https://pusd.push.org/llms.txt`}</Block>
            <p
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 12,
                lineHeight: 1.65,
                color: "var(--c-ink-dim)",
                margin: "8px 0 0",
              }}
            >
              <a
                href="/llms.txt"
                style={{ color: "var(--c-magenta)" }}
              >
                Open LLMs.txt →
              </a>
            </p>

            <SubChapter
              num="vi.iii"
              title="How to use them"
              lede="One-line prompts you can paste into any LLM-backed
                coding tool to get it productive on PUSD instantly."
            />
            <Block lang="prompt">
              {`# Fastest path -- the Skill is self-contained:
"Read https://pusd.push.org/agents/skill/push-pusd/SKILL.md
 and integrate PUSD mint + redeem into my dApp."

# Or start at the entry-point map:
"Read https://pusd.push.org/llms.txt and follow the link
 to the Skill."`}
            </Block>
          </div>
        </div>
      </section>
    </>
  );
}
