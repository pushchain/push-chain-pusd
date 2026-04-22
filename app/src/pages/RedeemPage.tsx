/**
 * RedeemPage — /redeem route. Thin wrapper around RedeemCard.
 */

import { RedeemCard } from '../components/RedeemCard';

export default function RedeemPage() {
  return (
    <section className="section">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <RedeemCard />
      </div>
    </section>
  );
}
