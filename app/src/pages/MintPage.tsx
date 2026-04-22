/**
 * MintPage — /mint route. Thin wrapper around MintCard.
 */

import { MintCard } from '../components/MintCard';

export default function MintPage() {
  return (
    <section className="section">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <MintCard />
      </div>
    </section>
  );
}
