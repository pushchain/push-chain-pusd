/**
 * RedeemPage — /redeem route. Thin wrapper around RedeemCard.
 *
 * Now owns its own container since App.tsx no longer wraps routes.
 */

import { RedeemCard } from '../components/RedeemCard';

export default function RedeemPage() {
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <RedeemCard />
        </div>
      </section>
    </div>
  );
}
