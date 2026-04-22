/**
 * SloganBand — the italic serif strip that reads:
 *
 *   Boring is the feature. · Unit of settlement, not speculation. ·
 *   Backed, not printed. · Preferred, basket, emergency
 *
 * Not editable at runtime — the copy is intentional brand voice.
 * Sits between the ticker and the first editorial section.
 */

const SLOGANS: readonly string[] = [
  'Boring is the feature.',
  'Unit of settlement, not speculation.',
  'Backed, not printed.',
  'Preferred, basket, emergency.',
];

export function SloganBand() {
  return (
    <section className="slogan-band" aria-label="Product principles">
      <div className="container slogan-band__inner">
        {SLOGANS.map((s) => (
          <span key={s} className="slogan-band__item">{s}</span>
        ))}
      </div>
    </section>
  );
}
