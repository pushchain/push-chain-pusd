#!/usr/bin/env node
/**
 * Agent-docs drift check.
 *
 * The Skill + llms.txt are the agent-facing entry points for PUSD / PUSD+.
 * They hardcode deployment facts (proxy addresses, chain id, RPC, reserve
 * tokens, fee caps, entrypoint signatures). This script asserts those facts
 * still agree with the repo's COMMITTED ground truth, so a contract redeploy
 * or signature change that isn't mirrored into the docs fails CI:
 *
 *   - contracts/deployed.txt            → current proxy addresses / chain / RPC
 *                                         (newest deployment is at the top;
 *                                          first VITE_* match = live values)
 *   - app/src/contracts/PUSDManager.json (committed ABI) → entrypoint sigs
 *   - contracts/script/AddSupportedTokens.s.sol → reserve set + namespaces
 *   - contracts/src/PUSDManager.sol     → fee/haircut caps
 *   - contracts/script/DeployBase.s.sol → base-fee default
 *
 * app/.env / app/.env.local are gitignored (absent in CI); when present they
 * are cross-checked against deployed.txt as a bonus. It also asserts the
 * public/ and dist/ copies are byte-identical.
 *
 * Exit 0 = no drift. Exit 1 = drift (prints every mismatch). Wire into CI.
 *
 *   node app/scripts/check-agent-docs-drift.mjs
 *   (or: yarn --cwd app check:agent-docs)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // app/scripts
const APP = resolve(here, '..'); // app
const ROOT = resolve(APP, '..'); // repo root

const P = {
  deployed: resolve(ROOT, 'contracts/deployed.txt'),
  env: resolve(APP, '.env'),
  envLocal: resolve(APP, '.env.local'),
  skill: resolve(APP, 'public/agents/skill/push-pusd/SKILL.md'),
  skillDist: resolve(APP, 'dist/agents/skill/push-pusd/SKILL.md'),
  llms: resolve(APP, 'public/llms.txt'),
  llmsDist: resolve(APP, 'dist/llms.txt'),
  abi: resolve(APP, 'src/contracts/PUSDManager.json'),
  addTokens: resolve(ROOT, 'contracts/script/AddSupportedTokens.s.sol'),
  deployBase: resolve(ROOT, 'contracts/script/DeployBase.s.sol'),
  managerSol: resolve(ROOT, 'contracts/src/PUSDManager.sol'),
};

const errors = [];
const fail = (m) => errors.push(m);
const read = (p) => readFileSync(p, 'utf8');
const lc = (s) => s.toLowerCase();
const ADDR = /0x[0-9a-fA-F]{40}/g;
/** First `KEY=value` (multiline, optional indent). deployed.txt lists the
 *  newest deployment first, so the first hit is the live value. */
const firstVar = (text, k) => (text.match(new RegExp(`^\\s*${k}=(.+)$`, 'm')) || [])[1]?.trim();

// ---------------------------------------------------------------------------
// 0. public/ ↔ dist/ parity
// ---------------------------------------------------------------------------
if (existsSync(P.skillDist) && read(P.skill) !== read(P.skillDist)) {
  fail('SKILL.md: public/ and dist/ copies differ — re-sync (vite build, or cp).');
}
if (existsSync(P.llmsDist) && read(P.llms) !== read(P.llmsDist)) {
  fail('llms.txt: public/ and dist/ copies differ — re-sync (vite build, or cp).');
}

const skill = read(P.skill);
const llms = read(P.llms);
const deployed = read(P.deployed);

// ---------------------------------------------------------------------------
// 1. Proxy addresses + chain/RPC — deployed.txt is truth; SKILL frontmatter,
//    SKILL table, and llms.txt table must all agree with it.
// ---------------------------------------------------------------------------
const PROXIES = [
  { label: 'PUSD', env: 'VITE_PUSD_ADDRESS', fm: 'pusd' },
  { label: 'PUSDManager', env: 'VITE_PUSD_MANAGER_ADDRESS', fm: 'pusd_manager' },
  { label: 'PUSDPlusVault', env: 'VITE_PUSD_PLUS_ADDRESS', fm: 'pusd_plus_vault' },
  { label: 'InsuranceFund', env: 'VITE_INSURANCE_FUND_ADDRESS', fm: 'insurance_fund' },
];

for (const { label, env: ev, fm } of PROXIES) {
  const truth = firstVar(deployed, ev);
  if (!truth) { fail(`${ev}: not found in contracts/deployed.txt`); continue; }

  // SKILL frontmatter:  pusd: '0x..'
  const fmVal = (skill.match(new RegExp(`${fm}:\\s*'(0x[0-9a-fA-F]{40})'`)) || [])[1];
  if (!fmVal) fail(`${label}: missing from SKILL frontmatter (key ${fm})`);
  else if (lc(fmVal) !== lc(truth)) fail(`${label}: SKILL frontmatter ${fmVal} != deployed.txt ${truth}`);

  // Markdown table cell:  | PUSD  | `0x..` |   (the `\\s*\\|` after the label
  // stops "PUSD" from matching "PUSDManager"/"PUSDPlusVault").
  const cell = new RegExp(`\\|\\s*${label}\\s*\\|\\s*\`(0x[0-9a-fA-F]{40})\``, 'g');
  for (const [src, text] of [['SKILL', skill], ['llms', llms]]) {
    const hits = [...text.matchAll(cell)].map((m) => m[1]);
    if (!hits.length) fail(`${label}: no address-table row found in ${src}`);
    for (const h of hits) if (lc(h) !== lc(truth)) fail(`${label}: ${src} table ${h} != deployed.txt ${truth}`);
  }

  // Bonus: if the gitignored env files are present locally, they must agree.
  for (const f of [P.env, P.envLocal]) {
    if (!existsSync(f)) continue;
    const v = firstVar(read(f), ev);
    if (v && lc(v) !== lc(truth)) fail(`${label}: ${f.replace(ROOT + '/', '')} ${v} != deployed.txt ${truth}`);
  }
}

// chain id / rpc in SKILL frontmatter + llms vs deployed.txt
const chainId = firstVar(deployed, 'VITE_CHAIN_ID');
if (chainId && !new RegExp(`chain_id:\\s*${chainId}\\b`).test(skill)) fail(`chain_id ${chainId} not in SKILL frontmatter`);
if (chainId && !skill.includes(chainId)) fail(`chain id ${chainId} not in SKILL body`);
const rpc = firstVar(deployed, 'VITE_RPC_URL');
if (rpc && !skill.includes(rpc)) fail(`RPC ${rpc} not in SKILL`);
if (rpc && !llms.includes(rpc)) fail(`RPC ${rpc} not in llms.txt`);

// ---------------------------------------------------------------------------
// 2. Reserve token set + on-chain chainNamespace strings.
// ---------------------------------------------------------------------------
const reserveRows = [...read(P.addTokens).matchAll(
  /addSupportedToken\(\s*(0x[0-9a-fA-F]{40})\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/g,
)];
const reserveSet = new Set(reserveRows.map((m) => lc(m[1])));
const namespaceSet = new Set(reserveRows.map((m) => m[3]));

// Pull addresses from the SKILL "Reserve tokens" table only.
const reserveSection = (skill.match(/### Reserve tokens[\s\S]*?(?:\n---|\n## )/) || [])[0] || '';
const skillReserveSet = new Set((reserveSection.match(ADDR) || []).map(lc));

if (!reserveSet.size) fail('No addSupportedToken rows parsed from AddSupportedTokens.s.sol');
for (const a of reserveSet) if (!skillReserveSet.has(a)) fail(`Reserve ${a} on-chain but missing from SKILL reserve table`);
for (const a of skillReserveSet) if (!reserveSet.has(a)) fail(`Reserve ${a} in SKILL table but not in AddSupportedTokens.s.sol`);
for (const ns of namespaceSet) if (!skill.includes(ns)) fail(`chainNamespace "${ns}" on-chain but not documented in SKILL`);

// ---------------------------------------------------------------------------
// 3. Entrypoint signatures — committed ABI must match the canonical set, and
//    each must be named in the SKILL.
// ---------------------------------------------------------------------------
const abiRaw = JSON.parse(read(P.abi));
const abi = Array.isArray(abiRaw) ? abiRaw : abiRaw.abi;
const EXPECTED = {
  deposit: 'address,uint256,address',
  redeem: 'uint256,address,bool,address',
  depositToPlus: 'address,uint256,address',
  redeemFromPlus: 'uint256,address,bool,address',
};
for (const [name, sig] of Object.entries(EXPECTED)) {
  const fn = abi.find((x) => x.type === 'function' && x.name === name);
  if (!fn) { fail(`ABI: function ${name} missing from PUSDManager.json`); continue; }
  const got = fn.inputs.map((i) => i.type).join(',');
  if (got !== sig) fail(`ABI: ${name}(${got}) != expected (${sig})`);
  if (!new RegExp(`\\b${name}\\(`).test(skill)) fail(`SKILL: entrypoint ${name}( not documented`);
}

// ---------------------------------------------------------------------------
// 4. Fee config — deploy default + Solidity caps must be reflected in SKILL.
// ---------------------------------------------------------------------------
const baseFee = (read(P.deployBase).match(/setBaseFee\((\d+)\)/) || [])[1];
if (baseFee && !new RegExp(`${baseFee}\\s*bps`).test(skill)) fail(`Base fee default ${baseFee} bps not stated in SKILL`);

const managerSol = read(P.managerSol);
const cap = (re, what) => {
  const v = (managerSol.match(re) || [])[1];
  if (v && !new RegExp(`${v}\\s*bps`).test(skill)) fail(`${what} cap ${v} bps not stated in SKILL`);
};
cap(/newBaseFee <= (\d+)/, 'base fee');
cap(/newMax <= (\d+)/, 'preferred fee');
cap(/newBps <= (\d+)[^\n]*haircut/i, 'haircut'); // setSurplusHaircutBps: require(newBps <= 1000 ...)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (errors.length) {
  console.error(`\n✗ agent-docs drift: ${errors.length} issue(s)\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}
console.log('✓ agent-docs in sync with deployed.txt, ABI, reserve set, and fee caps');
