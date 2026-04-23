/**
 * MintPage — /mint route.
 *
 * Renders the unified ConvertPanel with the Mint tab active and the
 * advanced recipient override + Push-chain route toggle surfaced.
 */

import { ConvertPanel } from '../components/ConvertPanel';

export default function MintPage() {
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <ConvertPanel initialMode="mint" advanced />
        </div>
      </section>
    </div>
  );
}
