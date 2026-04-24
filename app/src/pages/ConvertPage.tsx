/**
 * ConvertPage — /convert/:mode route.
 *
 * Renders the ConvertPanel in advanced mode with `mode` pinned by the URL.
 * Both sub-routes share this component so the tab switch inside the panel
 * just updates the URL; the content transitions without a full remount.
 */

import { useParams } from 'react-router-dom';
import { ConvertPanel } from '../components/ConvertPanel';

export default function ConvertPage() {
  const { mode } = useParams<{ mode: string }>();
  const initialMode = mode === 'redeem' ? 'redeem' : 'mint';
  return (
    <div className="container">
      <section className="section">
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <ConvertPanel initialMode={initialMode} advanced />
        </div>
      </section>
    </div>
  );
}
