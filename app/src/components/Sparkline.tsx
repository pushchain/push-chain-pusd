/**
 * Sparkline — minimal SVG line chart for NAV history (and similar series).
 *
 * Editorial-aesthetic: ink stroke on cream background, no axes, no labels,
 * dot at the latest sample. The y-range is auto-fit to the data with a
 * tiny margin so flat series still render visibly.
 */

type Point = { ts: number; value: number };

type Props = {
  points: readonly Point[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
};

export function Sparkline({
  points,
  width = 280,
  height = 56,
  stroke = 'var(--c-magenta)',
  fill = 'rgba(255, 61, 165, 0.08)',
  ariaLabel = 'sparkline',
}: Props) {
  if (points.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--c-ink-mute)"
          strokeDasharray="2 4"
        />
      </svg>
    );
  }

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = maxX - minX || 1;
  // Pad y-range so a perfectly flat series still draws a visible line.
  const yPad = Math.max(0.0001, (maxY - minY) * 0.15);
  const yLo = minY - yPad;
  const yHi = maxY + yPad;
  const yRange = yHi - yLo || 1;

  const px = (p: Point) => ((p.ts - minX) / xRange) * width;
  const py = (p: Point) => height - ((p.value - yLo) / yRange) * height;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p).toFixed(2)} ${py(p).toFixed(2)}`)
    .join(' ');

  // Closed area for fill — line down to baseline at the right, baseline back to start, close.
  const area = `${path} L ${px(points[points.length - 1]).toFixed(2)} ${height} L ${px(points[0]).toFixed(2)} ${height} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
    >
      <path d={area} fill={fill} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={px(last)} cy={py(last)} r={2.4} fill={stroke} />
    </svg>
  );
}
