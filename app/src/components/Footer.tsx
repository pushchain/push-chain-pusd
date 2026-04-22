/**
 * Footer — rule-framed colophon with contract addresses and external links.
 *
 * Addresses come from env vars via contracts/config — never hard-coded.
 */

import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, CHAIN_ID } from '../contracts/config';
import { explorerAddress, truncAddr } from '../lib/format';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__left">
          <div className="meta" style={{ marginBottom: 4 }}>
            PUSD · PUSH CHAIN DONUT TESTNET · CHAIN {CHAIN_ID}
          </div>
          <div className="mono" style={{ fontSize: 11 }}>
            PUSD{' '}
            <a className="link-mono" href={explorerAddress(PUSD_ADDRESS)} target="_blank" rel="noreferrer">
              {truncAddr(PUSD_ADDRESS)}
            </a>
            {'  ·  '}
            MANAGER{' '}
            <a className="link-mono" href={explorerAddress(PUSD_MANAGER_ADDRESS)} target="_blank" rel="noreferrer">
              {truncAddr(PUSD_MANAGER_ADDRESS)}
            </a>
          </div>
        </div>
        <div className="footer__right">
          <a className="link-mono" href="https://donut.push.network" target="_blank" rel="noreferrer">
            EXPLORER ↗
          </a>
          <a className="link-mono" href="https://push.org" target="_blank" rel="noreferrer">
            PUSH ↗
          </a>
          <a className="link-mono" href="https://docs.push.org" target="_blank" rel="noreferrer">
            DOCS ↗
          </a>
        </div>
      </div>
    </footer>
  );
}
