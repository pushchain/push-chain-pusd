/**
 * AsciiWave — full-bleed ASCII density wave band.
 *
 * Three overlapping sine waves create an organic interference pattern.
 * Characters cycle through a sparse→dense ramp; the word "PUSD" is
 * pre-rendered on an off-screen canvas and sampled per-cell so that
 * the text emerges from the noise in magenta at density peaks.
 *
 * Inspiration: ASCII motion graphics where varying symbol density and
 * contrast produce fluid, hypnotic movement (per the art-direction brief).
 */

import { type ReactNode, useEffect, useRef } from 'react';

// Sparse → dense character ramp. Each char represents a visual "weight".
const RAMP = ' ·:;÷+×xX$▒▓█';

export function AsciiWave({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cell geometry — tuned for IBM Plex Mono at 13px
    const CW = 11; // cell width  (px)
    const CH = 18; // cell height (px)
    const FS = 13; // font size   (px)

    let cols = 0;
    let rows = 0;
    let raf: number;
    let t = 0;

    // Off-screen mask data: white pixels = PUSD text area
    let maskPixels: Uint8ClampedArray | null = null;
    let maskW = 0;
    let maskH = 0;

    const buildMask = (w: number, h: number) => {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;

      offCtx.fillStyle = '#000';
      offCtx.fillRect(0, 0, w, h);

      // Fit "PUSD" to ~60 % of band height, centred
      const fs = Math.min(h * 0.60, w * 0.20);
      offCtx.font = `700 ${fs}px "Fraunces", serif`;
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';
      offCtx.fillStyle = '#fff';
      offCtx.fillText('PUSD', w / 2, h / 2);

      const d = offCtx.getImageData(0, 0, w, h);
      maskPixels = d.data;
      maskW = w;
      maskH = h;
    };

    // Sample mask brightness at a given grid cell (0 = background, 1 = text)
    const getMask = (col: number, row: number): number => {
      if (!maskPixels) return 0;
      const x = Math.min(maskW - 1, Math.floor(col * CW + CW / 2));
      const y = Math.min(maskH - 1, Math.floor(row * CH + CH / 2));
      return maskPixels[(y * maskW + x) * 4] / 255;
    };

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      cols = Math.ceil(width / CW) + 1;
      rows = Math.ceil(height / CH) + 1;
      canvas.width = cols * CW;
      canvas.height = rows * CH;
      buildMask(canvas.width, canvas.height);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FS}px "IBM Plex Mono", monospace`;
      ctx.textBaseline = 'top';

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const mask = getMask(c, r);

          // Three overlapping sine waves — interference makes the pattern
          // feel organic rather than mechanical
          const a = Math.sin(c * 0.13 - t * 1.05 + r * 0.20);
          const b = Math.sin(c * 0.07 + t * 0.62 - r * 0.17);
          const e = Math.sin((c + r * 0.6) * 0.09 - t * 0.85);

          // Normalise to [0, 1]
          let v = (a + b + e + 3) / 6;

          // Inside PUSD mask: floor the density so the letters are always
          // denser than the surrounding field, regardless of wave phase
          if (mask > 0.4) {
            v = Math.min(1, v * 0.35 + 0.62 + mask * 0.18);
          }

          const idx = Math.floor(v * (RAMP.length - 1));
          const ch = RAMP[idx];

          // Colour: magenta at dense mask pixels, ink everywhere else
          if (mask > 0.4 && v > 0.70) {
            ctx.fillStyle = `rgba(221,68,185,${(0.45 + v * 0.55).toFixed(2)})`;
          } else if (mask > 0.4) {
            ctx.fillStyle = `rgba(15,13,10,${(0.25 + v * 0.65).toFixed(2)})`;
          } else {
            // Background field: very sparse so the PUSD text pops
            ctx.fillStyle = `rgba(15,13,10,${(0.03 + v * 0.38).toFixed(2)})`;
          }

          ctx.fillText(ch, c * CW, r * CH);
        }
      }

      t += 0.011; // ~60 fps continuous loop
      raf = requestAnimationFrame(draw);
    };

    // Wait for fonts before measuring and building the mask
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
  }, []);

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
