/**
 * RedeemPage — /redeem route.
 *
 * Renders the unified ConvertPanel with the Redeem tab active and the
 * advanced recipient + basket mode + cross-chain payout controls surfaced.
 */

import { ConvertPanel } from '../components/ConvertPanel';

export default function RedeemPage() {
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <ConvertPanel initialMode="redeem" advanced />
        </div>
      </section>
    </div>
  );
}
