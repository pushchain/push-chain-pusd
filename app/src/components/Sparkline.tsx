/**
 * Sparkline — minimal SVG line chart for NAV history (and similar series).
 *
 * Editorial-aesthetic: ink stroke on cream background, no axes, no labels,
 * dot at the latest sample. The y-range is auto-fit to the data with a
 * tiny margin so flat series still render visibly.
 *
 * Responsive: width and height props seed the internal coordinate system
 * (and the viewBox aspect ratio); the rendered SVG fills its container
 * via `width: 100%`. Pass any reasonable `width` × `height` to control
 * the aspect ratio.
 */

import { useRef, useState } from 'react';

type Point = { ts: number; value: number };

type Props = {
  points: readonly Point[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
  /** Optional formatter for the tooltip value line. Defaults to `value.toFixed(6)`. */
  formatValue?: (v: number) => string;
  /** Optional formatter for the tooltip date line. Defaults to localised date. */
  formatDate?: (ts: number) => string;
  /** When set, fixes the rendered SVG height in CSS pixels (and stretches the
   *  viewBox to fill — useful for chart-style placements). When omitted the
   *  SVG keeps its viewBox aspect ratio (default sparkline behaviour). */
  fixedDisplayHeight?: number;
};

const RESPONSIVE_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
  maxWidth: '100%',
};

function defaultDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function Sparkline({
  points,
  width = 280,
  height = 56,
  stroke = 'var(--c-magenta)',
  fill = 'rgba(255, 61, 165, 0.08)',
  ariaLabel = 'sparkline',
  formatValue = (v) => v.toFixed(6),
  formatDate = defaultDate,
  fixedDisplayHeight,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    idx: number;
    cssX: number;
    cssY: number;
  } | null>(null);

  if (points.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={RESPONSIVE_STYLE}
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

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cssX = e.clientX - rect.left;
    // Map CSS x → viewBox x, then find nearest sample.
    const vbX = (cssX / rect.width) * width;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(px(points[i]) - vbX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const p = points[bestIdx];
    const cssXSnap = (px(p) / width) * rect.width;
    const cssYSnap = (py(p) / height) * rect.height;
    setHover({ idx: bestIdx, cssX: cssXSnap, cssY: cssYSnap });
  }

  const hoveredPoint = hover ? points[hover.idx] : null;
  // Tooltip placement — clamp inside the chart so it doesn't clip.
  const tipWidth = 168;
  const tipOffsetY = 14;
  const wrapRect = wrapRef.current?.getBoundingClientRect();
  const wrapW = wrapRect?.width ?? 0;
  const tipLeft =
    hover && wrapW > 0
      ? Math.max(8, Math.min(wrapW - tipWidth - 8, hover.cssX - tipWidth / 2))
      : 0;
  const tipTop = hover ? Math.max(0, hover.cssY - tipOffsetY - 56) : 0;

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      style={{ position: 'relative', width: '100%' }}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={
          fixedDisplayHeight
            ? { display: 'block', width: '100%', height: fixedDisplayHeight }
            : RESPONSIVE_STYLE
        }
      >
        <path d={area} fill={fill} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={px(last)}
          cy={py(last)}
          r={2.4}
          fill={stroke}
          vectorEffect="non-scaling-stroke"
        />
        {hoveredPoint && (
          <>
            <line
              x1={px(hoveredPoint)}
              y1={0}
              x2={px(hoveredPoint)}
              y2={height}
              stroke="var(--c-ink)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={px(hoveredPoint)}
              cy={py(hoveredPoint)}
              r={3.6}
              fill="var(--c-cream)"
              stroke={stroke}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {hoveredPoint && (
        <div
          style={{
            position: 'absolute',
            left: tipLeft,
            top: tipTop,
            width: tipWidth,
            background: 'var(--c-ink)',
            color: 'var(--c-cream)',
            border: 'var(--rule-thin)',
            padding: '8px 12px',
            pointerEvents: 'none',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            lineHeight: 1.5,
            zIndex: 10,
            boxShadow: '4px 4px 0 rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ color: 'var(--c-magenta)', letterSpacing: '0.08em' }}>
            NAV
          </div>
          <div style={{ fontSize: 14, marginTop: 2 }}>
            {formatValue(hoveredPoint.value)}
          </div>
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid rgba(255,255,255,0.18)',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            {formatDate(hoveredPoint.ts)}
          </div>
        </div>
      )}
    </div>
  );
}
