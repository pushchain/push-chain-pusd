/**
 * SavePage — /save/:mode route.
 *
 * Renders the SavePanel in advanced mode with `mode` pinned by the URL
 * (`deposit` or `withdraw`). Tab switches inside the panel update the URL
 * via navigate so the deep-link semantics match `/convert`.
 */

import { useParams } from 'react-router-dom';
import { SavePanel } from '../components/SavePanel';

export default function SavePage() {
  const { mode } = useParams<{ mode: string }>();
  const initialMode = mode === 'withdraw' ? 'withdraw' : 'deposit';
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <SavePanel initialMode={initialMode} advanced />
        </div>
      </section>
    </div>
  );
}
