/**
 * Footer — editorial colophon.
 *
 * Layout (from the mockup):
 *   [ PushUSD logo + tagline prose ] | [ PROTOCOL links ] | [ ELSEWHERE links ]
 *   --- rule ---
 *   © MMXXVI · Push USD · All serifs intentional.   | PUSD addr · PUSDManager addr
 *
 * Addresses come exclusively from env via contracts/config.
 */

import {
  INSURANCE_FUND_ADDRESS,
  PUSD_ADDRESS,
  PUSD_MANAGER_ADDRESS,
  PUSD_PLUS_ADDRESS,
} from '../contracts/config';
import { explorerAddress, truncAddr } from '../lib/format';
import { AsciiWave } from './AsciiWave';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <div className="footer__logo">
              Push<em>USD</em>
            </div>
            <p className="footer__prose">
              A universal dollar for applications that don&rsquo;t care which chain their
              users walk in from. Issued on Push Chain. Redeemable against a basket.
              Upgrade-gated, emergency-aware, audit-first.
            </p>
          </div>

          <div className="footer__cols">
            <div>
              <div className="footer__col-label">Protocol</div>
              <ul className="footer__links">
                <li><a href="/reserves">Reserves</a></li>
                <li><a href="/activity">Activity</a></li>
                <li><a href="/docs">Docs</a></li>
              </ul>
            </div>

            <div>
              <div className="footer__col-label">Elsewhere</div>
              <ul className="footer__links">
                <li>
                  <a href="https://github.com/pushchain/push-chain-pusd" target="_blank" rel="noreferrer">
                    GitHub ↗
                  </a>
                </li>
                <li>
                  <a href="https://donut.push.network" target="_blank" rel="noreferrer">
                    Explorer ↗
                  </a>
                </li>
                <li>
                  <a href="https://push.org" target="_blank" rel="noreferrer">
                    Push ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer__row">
          <span>
            &copy; MMXX{yearRoman(year - 2020)} · Push USD · <em>All serifs intentional.</em>
          </span>
          <span className="footer__addrs">
            <span className="footer__addrs-row">
              PUSD{' '}
              <a
                className="link-mono"
                href={explorerAddress(PUSD_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                {truncAddr(PUSD_ADDRESS)}
              </a>
              {'   ·   '}
              PUSDManager{' '}
              <a
                className="link-mono"
                href={explorerAddress(PUSD_MANAGER_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                {truncAddr(PUSD_MANAGER_ADDRESS)}
              </a>
            </span>
            {(PUSD_PLUS_ADDRESS || INSURANCE_FUND_ADDRESS) && (
              <span className="footer__addrs-row">
                {PUSD_PLUS_ADDRESS && (
                  <>
                    PUSDPlusVault{' '}
                    <a
                      className="link-mono"
                      href={explorerAddress(PUSD_PLUS_ADDRESS)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {truncAddr(PUSD_PLUS_ADDRESS)}
                    </a>
                  </>
                )}
                {INSURANCE_FUND_ADDRESS && (
                  <>
                    {'   ·   '}
                    InsuranceFund{' '}
                    <a
                      className="link-mono"
                      href={explorerAddress(INSURANCE_FUND_ADDRESS)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {truncAddr(INSURANCE_FUND_ADDRESS)}
                    </a>
                  </>
                )}
              </span>
            )}
          </span>
        </div>
      </div>

      <AsciiWave />
    </footer>
  );
}

/** Small roman-numeral helper so MMXXVI stays brand-correct for years. */
function yearRoman(offset: number): string {
  // offset = years since 2020 — we only need the last two-ish digits in roman.
  const values: Array<[number, string]> = [
    [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = Math.max(0, Math.floor(offset));
  let out = '';
  for (const [v, s] of values) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out || '0';
}
