/**
 * MintPage — /mint route. Thin wrapper around MintCard.
 *
 * Now owns its own container since App.tsx no longer wraps routes.
 */

import { MintCard } from '../components/MintCard';

export default function MintPage() {
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <MintCard />
        </div>
      </section>
    </div>
  );
}
