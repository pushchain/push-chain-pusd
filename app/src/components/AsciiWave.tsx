import { type ReactNode, useEffect, useRef } from 'react';

const RAMP = ' ·:;÷+×xX$▒▓█';

export type AsciiMode =
  | 'block' | 'isometric' | 'anaglyph'
  | 'pulse' | 'spin' | 'shimmer' | 'parallax' | 'wobble' | 'neon';

export function AsciiWave({ children, mode = 'wobble' }: { children?: ReactNode; mode?: AsciiMode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CW = 11;
    const CH = 18;
    const FS = 13;

    let cols = 0;
    let rows = 0;
    let raf: number;
    let t = 0;

    // Single base mask: white pixels = PUSD shape, built once per resize.
    let shapePixels: Uint8ClampedArray | null = null;
    let shapeW = 0;
    let shapeH = 0;

    const buildShape = (w: number, h: number) => {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;
      offCtx.fillStyle = '#000';
      offCtx.fillRect(0, 0, w, h);
      const fs = Math.min(h * 0.60, w * 0.20);
      offCtx.font = `700 ${fs}px "Fraunces", serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';
      offCtx.fillStyle = '#fff';
      offCtx.fillText('PUSD', w / 2, h / 2);
      shapePixels = offCtx.getImageData(0, 0, w, h).data;
      shapeW = w;
      shapeH = h;
    };

    // Sample the shape at a pixel (x, y) — true if inside a letter stroke.
    const hasShape = (px: number, py: number): boolean => {
      if (!shapePixels) return false;
      const x = px | 0;
      const y = py | 0;
      if (x < 0 || y < 0 || x >= shapeW || y >= shapeH) return false;
      return shapePixels[(y * shapeW + x) * 4] > 100;
    };

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      cols = Math.ceil(width / CW) + 1;
      rows = Math.ceil(height / CH) + 1;
      canvas.width = cols * CW;
      canvas.height = rows * CH;
      buildShape(canvas.width, canvas.height);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FS}px "IBM Plex Mono", monospace`;
      ctx.textBaseline = 'top';

      const DX = CW * 3;
      const DY = CH * 2;
      const STEPS = 10;

      // Per-frame animated parameters
      const pulseF = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.35));
      const spinA = t * 0.30;
      const spinDx = Math.cos(spinA) * DX;
      const spinDy = Math.sin(spinA) * DY * 0.7;

      const pLayers = mode === 'parallax'
        ? [
            { dx: 0,          driftX: 0,                               dy: 0,          col: 'rgba(221,68,185,',  chr: '█' },
            { dx: CW * 1.5,   driftX: Math.sin(t * 0.40) * CW * 2,     dy: CH * 0.8,   col: 'rgba(175,45,135,',  chr: '▓' },
            { dx: CW * 3,     driftX: Math.sin(t * 0.60 + 1) * CW * 3, dy: CH * 1.7,   col: 'rgba(115,25,88,',   chr: '▒' },
            { dx: CW * 4.5,   driftX: Math.sin(t * 0.80 + 2) * CW * 5, dy: CH * 2.6,   col: 'rgba(65,15,52,',    chr: '░' },
          ]
        : [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = c * CW + CW / 2;
          const py = r * CH + CH / 2;

          const wa = Math.sin(c * 0.13 - t * 1.05 + r * 0.20);
          const wb = Math.sin(c * 0.07 + t * 0.62 - r * 0.17);
          const we = Math.sin((c + r * 0.6) * 0.09 - t * 0.85);
          const wave = (wa + wb + we + 3) / 6;

          // Default: background field character
          let ch = RAMP[Math.floor(wave * (RAMP.length - 1))];
          let fill = `rgba(15,13,10,${(0.03 + wave * 0.38).toFixed(2)})`;

          if (mode === 'block') {
            if (hasShape(px, py)) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.70 + wave * 0.30).toFixed(2)})`;
            } else {
              for (let k = 1; k <= STEPS; k++) {
                const f = k / STEPS;
                if (hasShape(px - DX * f, py - DY * f)) {
                  const v = Math.min(1, 0.45 + wave * 0.35 + (1 - f) * 0.20);
                  ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                  fill = `rgba(130,22,98,${(0.35 + (1 - f) * 0.40 + wave * 0.10).toFixed(2)})`;
                  break;
                }
              }
            }

          } else if (mode === 'pulse') {
            if (hasShape(px, py)) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.70 + pulseF * 0.25 + wave * 0.05).toFixed(2)})`;
            } else {
              const maxX = DX * pulseF;
              const maxY = DY * pulseF;
              const steps = Math.max(2, Math.round(STEPS * pulseF));
              for (let k = 1; k <= steps; k++) {
                const f = k / steps;
                if (hasShape(px - maxX * f, py - maxY * f)) {
                  const v = Math.min(1, 0.45 + wave * 0.30 + (1 - f) * 0.20);
                  ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                  fill = `rgba(130,22,98,${(0.35 + (1 - f) * 0.40 * pulseF + wave * 0.10).toFixed(2)})`;
                  break;
                }
              }
            }

          } else if (mode === 'spin') {
            if (hasShape(px, py)) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.70 + wave * 0.30).toFixed(2)})`;
            } else {
              for (let k = 1; k <= STEPS; k++) {
                const f = k / STEPS;
                if (hasShape(px - spinDx * f, py - spinDy * f)) {
                  const v = Math.min(1, 0.45 + wave * 0.35 + (1 - f) * 0.20);
                  ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                  // Hue shifts with spin angle — the "light" seems to orbit
                  const rr = 130 + Math.floor(Math.cos(spinA) * 55);
                  const bb = 98 + Math.floor(Math.sin(spinA) * 55);
                  fill = `rgba(${rr},22,${bb},${(0.35 + (1 - f) * 0.40 + wave * 0.10).toFixed(2)})`;
                  break;
                }
              }
            }

          } else if (mode === 'shimmer') {
            if (hasShape(px, py)) {
              ch = '█';
              // Holographic sheen sweeping across columns
              const phase = c * 0.14 + t * 1.8;
              const hue = 290 + 55 * Math.sin(phase);
              const light = 55 + 10 * Math.sin(phase + r * 0.2);
              fill = `hsl(${hue.toFixed(0)}, 88%, ${light.toFixed(0)}%)`;
            } else {
              for (let k = 1; k <= 6; k++) {
                const f = k / 6;
                if (hasShape(px - CW * 2 * f, py - CH * 1 * f)) {
                  ch = RAMP[Math.min(RAMP.length - 1, Math.floor((0.32 + wave * 0.30) * (RAMP.length - 1)))];
                  fill = `rgba(95,40,95,${(0.25 + (1 - f) * 0.25).toFixed(2)})`;
                  break;
                }
              }
            }

          } else if (mode === 'parallax') {
            for (const layer of pLayers) {
              if (hasShape(px - (layer.dx + layer.driftX), py - layer.dy)) {
                ch = layer.chr;
                fill = `${layer.col}${(0.60 + wave * 0.35).toFixed(2)})`;
                break;
              }
            }

          } else if (mode === 'wobble') {
            // Wave-warped 3D: sampling coordinates wobble in time
            const warpX = Math.sin(r * 0.28 + t * 1.4) * CW * 1.8;
            const warpY = Math.sin(c * 0.22 + t * 1.1) * CH * 0.7;
            if (hasShape(px + warpX, py + warpY)) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.70 + wave * 0.30).toFixed(2)})`;
            } else {
              for (let k = 1; k <= STEPS; k++) {
                const f = k / STEPS;
                if (hasShape(px + warpX - DX * f, py + warpY - DY * f)) {
                  const v = Math.min(1, 0.45 + wave * 0.35 + (1 - f) * 0.20);
                  ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                  fill = `rgba(130,22,98,${(0.35 + (1 - f) * 0.40 + wave * 0.10).toFixed(2)})`;
                  break;
                }
              }
            }

          } else if (mode === 'neon') {
            const ow = 5; // outline width in pixels
            const inside = hasShape(px, py);
            if (inside) {
              // Outline detection: neighbour just outside shape?
              const onEdge =
                !hasShape(px - ow, py) || !hasShape(px + ow, py) ||
                !hasShape(px, py - ow) || !hasShape(px, py + ow);
              if (onEdge) {
                ch = '█';
                const glow = 0.75 + 0.25 * Math.sin(t * 2.5 + c * 0.12 + r * 0.2);
                fill = `rgba(240,100,210,${glow.toFixed(2)})`;
              } else {
                // Hollow interior
                ch = ' ';
                fill = 'rgba(0,0,0,0)';
              }
            } else {
              // Extruded outline (tube sides)
              for (let k = 1; k <= 6; k++) {
                const f = k / 6;
                const ex = px - CW * 2 * f;
                const ey = py - CH * 1 * f;
                if (hasShape(ex, ey)) {
                  const isEdge =
                    !hasShape(ex - ow, ey) || !hasShape(ex + ow, ey) ||
                    !hasShape(ex, ey - ow) || !hasShape(ex, ey + ow);
                  if (isEdge) {
                    ch = '▓';
                    fill = `rgba(140,40,120,${(0.30 + (1 - f) * 0.35 + wave * 0.10).toFixed(2)})`;
                    break;
                  }
                }
              }
            }

          } else if (mode === 'isometric') {
            if (hasShape(px, py)) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.70 + wave * 0.30).toFixed(2)})`;
            } else {
              let hit = false;
              // Top face: shape lies below-and-right of this cell
              for (let k = 1; k <= 8; k++) {
                const f = k / 8;
                if (hasShape(px - CW * 3 * f, py + CH * 1.5 * f)) {
                  const v = Math.min(1, 0.48 + wave * 0.30 + (1 - f) * 0.15);
                  ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                  fill = `rgba(245,150,220,${(0.55 + (1 - f) * 0.30 + wave * 0.10).toFixed(2)})`;
                  hit = true;
                  break;
                }
              }
              if (!hit) {
                // Side face: shape lies above-and-right
                for (let k = 1; k <= 8; k++) {
                  const f = k / 8;
                  if (hasShape(px - CW * 3 * f, py - CH * 1.5 * f)) {
                    const v = Math.min(1, 0.42 + wave * 0.30 + (1 - f) * 0.20);
                    ch = RAMP[Math.floor(v * (RAMP.length - 1))];
                    fill = `rgba(90,10,65,${(0.55 + (1 - f) * 0.30 + wave * 0.10).toFixed(2)})`;
                    break;
                  }
                }
              }
            }

          } else if (mode === 'anaglyph') {
            const s = CW * 3;
            const red = hasShape(px - s, py);
            const cyan = hasShape(px + s, py);
            if (red && cyan) {
              ch = '█';
              fill = `rgba(221,68,185,${(0.80 + wave * 0.20).toFixed(2)})`;
            } else if (red) {
              ch = '█';
              fill = `rgba(220,30,30,${(0.60 + wave * 0.30).toFixed(2)})`;
            } else if (cyan) {
              ch = '█';
              fill = `rgba(0,200,200,${(0.60 + wave * 0.30).toFixed(2)})`;
            }
          }

          ctx.fillStyle = fill;
          ctx.fillText(ch, c * CW, r * CH);
        }
      }

      t += 0.011;
      raf = requestAnimationFrame(draw);
    };

    const init = async () => {
      await document.fonts.ready;
      resize();
      draw();
    };

    const ro = new ResizeObserver(() => { resize(); });
    ro.observe(container);
    init();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode]);

  return (
    <section className="ascii-wave" ref={containerRef}>
      <canvas ref={canvasRef} className="ascii-wave__canvas" aria-hidden="true" />
      {children && (
        <div className="ascii-wave__colophon">
          {children}
        </div>
      )}
    </section>
  );
}
