import { AsciiWave, type AsciiMode } from '../components/AsciiWave';

const MODES: { mode: AsciiMode; label: string }[] = [
  { mode: 'shimmer',   label: '1. Shimmer — chromatic holographic sheen sweeping across PUSD (ANIMATED)' },
  { mode: 'spin',      label: '2. Spin — the light source orbits, rotating the extrusion direction (ANIMATED)' },
  { mode: 'parallax',  label: '3. Parallax — four depth layers, each drifting at its own speed (ANIMATED)' },
  { mode: 'pulse',     label: '4. Pulse — extrusion depth breathes in and out (ANIMATED)' },
  { mode: 'wobble',    label: '5. Wobble — letters undulate through the wave field (ANIMATED)' },
  { mode: 'neon',      label: '6. Neon — hollow glowing tube outlines with extruded sides' },
  { mode: 'isometric', label: '7. Isometric — three faces: front, top, side' },
  { mode: 'block',     label: '8. Block Extrusion — classic 3D shadow going lower-right (legibility fixed)' },
  { mode: 'anaglyph',  label: '9. Anaglyph — red / cyan 3D-glasses split' },
];

export default function StyleDemoPage() {
  return (
    <div style={{ background: '#f5f2ec' }}>
      {MODES.map(({ mode, label }) => (
        <div key={mode}>
          <div style={{ padding: '12px 24px', fontFamily: 'monospace', fontSize: 11, opacity: 0.55 }}>
            {label}
          </div>
          <AsciiWave mode={mode} />
        </div>
      ))}
    </div>
  );
}
