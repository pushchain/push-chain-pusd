/**
 * useCountUp — animate a bigint from 0 to a target on first mount.
 *
 * Used to give stat strips a small "wake up" moment on page load. Runs
 * exactly once per component instance — subsequent target changes snap
 * to the new value without re-animating, so polls don't make the number
 * judder every 12s.
 *
 * Reduced-motion users see the final value immediately.
 *
 * Note: converts bigint → Number during interpolation. Safe for values
 * under 2^53 (~9 quadrillion), which covers PUSD supply at 6dp for any
 * realistic scale.
 */

import { useEffect, useRef, useState } from 'react';

export function useCountUp(target: bigint, durationMs = 900): bigint {
  const [value, setValue] = useState<bigint>(0n);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (target === 0n) return;
    if (animatedRef.current) {
      setValue(target);
      return;
    }
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setValue(target);
      animatedRef.current = true;
      return;
    }

    const start = performance.now();
    const endVal = Number(target);
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = BigInt(Math.floor(endVal * eased));
      setValue(v);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setValue(target);
        animatedRef.current = true;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
