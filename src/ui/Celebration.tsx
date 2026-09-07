import { useEffect, useMemo, useRef, useState } from 'react';
import { audio, cueForTier } from '../game/audio';

export interface CelebrationData {
  tier: 1 | 2 | 3;
  /** Named skill the player just demonstrated — informational, not praise. */
  skill: string;
  /** One line of competence feedback. */
  detail: string;
  xp: number;
  /** e.g. "3 clean solves in a row". Empty when there is no streak. */
  streak?: string;
  /** Evidence unlocked, if any. */
  evidence?: string;
  /** Where the gate opened. */
  nextHint?: string;
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: 'SOLVED',
  2: 'FIRST TRY',
  3: 'CLEAN SOLVE',
};

/**
 * Duration is tiered per the research: short and intense beats long and
 * mediocre (peak-end rule), and anything over ~2s must be skippable.
 */
const TIER_MS: Record<1 | 2 | 3, number> = { 1: 1400, 2: 1900, 3: 2600 };

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  colour: string;
  size: number;
}

const COLOURS = ['#4fe6e6', '#f7c948', '#e451c8', '#5fd97a', '#f6f6ff'];

/** Chunky pixel confetti on a canvas — cheap, and it matches the 8-bit art. */
function Confetti({ count, reduced }: { count: number; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = (canvas.width = canvas.offsetWidth);
    const h = (canvas.height = canvas.offsetHeight);

    const bits: Particle[] = Array.from({ length: count }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.5,
      y: h * 0.45,
      vx: (Math.random() - 0.5) * (reduced ? 1.5 : 7),
      vy: -Math.random() * (reduced ? 2 : 8) - 2,
      life: 1,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      size: 3 + Math.floor(Math.random() * 4),
    }));

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const b of bits) {
        b.vy += 0.34 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= 0.012 * dt;
        if (b.life <= 0) continue;
        alive = true;
        ctx.globalAlpha = Math.max(0, Math.min(1, b.life));
        ctx.fillStyle = b.colour;
        // integer coords keep the confetti pixel-crisp
        ctx.fillRect(Math.round(b.x), Math.round(b.y), b.size, b.size);
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count, reduced]);

  return <canvas className="confetti" ref={ref} aria-hidden="true" />;
}

export function Celebration({ data, onDone }: { data: CelebrationData; onDone: () => void }) {
  const reduced = useMemo(prefersReducedMotion, []);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    audio.play(cueForTier(data.tier));
  }, [data]);

  useEffect(() => {
    const total = reduced ? 1200 : TIER_MS[data.tier];
    const out = setTimeout(() => setLeaving(true), total - 220);
    const done = setTimeout(onDone, total);
    // skippable: any key or click dismisses immediately
    const skip = () => {
      clearTimeout(out);
      clearTimeout(done);
      onDone();
    };
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('mousedown', skip, { once: true });
    return () => {
      clearTimeout(out);
      clearTimeout(done);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('mousedown', skip);
    };
  }, [data, onDone, reduced]);

  const particles = data.tier === 3 ? 46 : data.tier === 2 ? 26 : 14;

  return (
    <div className={`celebrate tier-${data.tier} ${leaving ? 'out' : ''} ${reduced ? 'calm' : ''}`}>
      {/* Not mounted at all under reduced motion. Slowing the confetti to six
          drifting particles still puts moving objects on screen, which is what
          the Options screen promises not to do. The card itself carries the
          reward, so nothing informational is lost. */}
      {data.tier >= 2 && !reduced && <Confetti count={particles} reduced={false} />}

      <div className="celebrate-card" role="status" aria-live="polite">
        <div className="stamp">{TIER_LABEL[data.tier]}</div>

        <p className="skill-line">
          <span className="skill-tag">SKILL</span> {data.skill}
        </p>
        <p className="skill-detail">{data.detail}</p>

        <div className="xp-row">
          <span className="xp-pop">+{data.xp} XP</span>
          {data.streak && <span className="streak-pop">{data.streak}</span>}
        </div>

        {data.evidence && <p className="celebrate-evidence">Evidence filed — {data.evidence}</p>}
        {data.nextHint && <p className="celebrate-next">{data.nextHint}</p>}

        <p className="celebrate-skip">press any key</p>
      </div>
    </div>
  );
}
