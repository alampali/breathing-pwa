// The moment a session completes.
//
// Deliberately not confetti. Confetti is loud, fast and congratulatory, which is
// the opposite of how the end of a breathing session feels. This is a bloom
// outward from the breath circle: a soft flash of light at the centre, rings
// expanding and thinning like ripples, and motes drifting up and fading, all in
// the app's own palette. It runs about five seconds under the closing bowl
// strike and asks for no response.

const RING_COUNT = 5;
const RING_LIFE = 2600;      // ms for a ring to expand and vanish
const RING_STAGGER = 260;
const MOTE_COUNT = 90;
const MOTE_LIFE = 4200;
const TOTAL = 5200;

const TINTS = [
  [158, 232, 255],   // --accent
  [199, 255, 216],   // --accent2
  [255, 255, 255],
];

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.className = 'celebrate-layer';
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { canvas, ctx };
}

function makeMotes(originX, originY, spread) {
  return Array.from({ length: MOTE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * spread;   // even area coverage
    return {
      x: originX + Math.cos(angle) * distance,
      y: originY + Math.sin(angle) * distance * 0.6,
      radius: 1.8 + Math.random() * 4.2,
      rise: 90 + Math.random() * 240,                     // px travelled upward
      sway: 14 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
      delay: Math.random() * 1100,
      life: MOTE_LIFE * (0.55 + Math.random() * 0.45),
      tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    };
  });
}

/**
 * @param {Element} anchor element to bloom from — the breath circle.
 */
export function celebrate(anchor) {
  if (!document.body || typeof requestAnimationFrame !== 'function') return;

  const box = anchor?.getBoundingClientRect();
  const centreX = box && box.width ? box.left + box.width / 2 : NaN;
  const centreY = box && box.height ? box.top + box.height / 2 : NaN;

  // Scrolling down to another tab mid-session leaves the breath circle above the
  // viewport, and blooming from its real position would paint entirely
  // off-screen. Fall back to the middle of the screen whenever it is not in view.
  const onScreen = Number.isFinite(centreX) && Number.isFinite(centreY)
    && centreX >= 0 && centreX <= window.innerWidth
    && centreY >= 0 && centreY <= window.innerHeight;

  const originX = onScreen ? centreX : window.innerWidth / 2;
  const originY = onScreen ? centreY : window.innerHeight / 2;
  const baseRadius = box && box.width ? box.width / 2 : 90;

  const { canvas, ctx } = makeCanvas();

  // A single slow halo, no drifting particles, when motion is unwelcome.
  const reduced = prefersReducedMotion();
  const motes = reduced ? [] : makeMotes(originX, originY, baseRadius * 0.72);
  const rings = reduced ? 1 : RING_COUNT;

  const started = performance.now();
  let frame = null;
  let done = false;

  function cleanup() {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    canvas.remove();
  }

  function draw(now) {
    const elapsed = now - started;
    if (elapsed >= TOTAL) return cleanup();

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Additive blending: overlapping light accumulates instead of painting over
    // itself, which is what makes this read as glow rather than as flat circles.
    ctx.globalCompositeOperation = 'lighter';

    // The flash. Swells fast, fades slowly, and carries most of the impact.
    const flashT = elapsed / (reduced ? 2200 : 1800);
    if (flashT < 1) {
      const swell = flashT < 0.18 ? flashT / 0.18 : 1 - (flashT - 0.18) / 0.82;
      const radius = baseRadius * (1.1 + easeOut(flashT) * 1.9);
      const glow = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
      const peak = Math.max(0, swell) * (reduced ? 0.28 : 0.66);
      glow.addColorStop(0, `rgba(226, 250, 255, ${peak.toFixed(3)})`);
      glow.addColorStop(0.45, `rgba(158, 232, 255, ${(peak * 0.42).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(158, 232, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(originX, originY, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < rings; i += 1) {
      const t = (elapsed - i * RING_STAGGER) / RING_LIFE;
      if (t <= 0 || t >= 1) continue;
      const radius = baseRadius * (0.8 + easeOut(t) * 3.6);
      const alpha = (1 - t) * (reduced ? 0.3 : 0.75);
      const [r, g, b] = TINTS[i % TINTS.length];
      ctx.beginPath();
      ctx.arc(originX, originY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.8, 4.5 * (1 - t));
      ctx.shadowBlur = 18 * (1 - t);
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.9).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    motes.forEach((mote) => {
      const t = (elapsed - mote.delay) / mote.life;
      if (t <= 0 || t >= 1) return;
      // Fade in over the first fifth, then out across the rest.
      const alpha = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
      const x = mote.x + Math.sin(mote.phase + t * Math.PI * 2) * mote.sway;
      const y = mote.y - easeOut(t) * mote.rise;
      const [r, g, b] = mote.tint;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha).toFixed(3)})`;
      ctx.shadowBlur = 12;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha * 0.8).toFixed(3)})`;
      ctx.fill();
    });

    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
    frame = requestAnimationFrame(draw);
  }

  frame = requestAnimationFrame(draw);
  // Animation frames stop in a hidden tab; make sure the canvas still goes away.
  setTimeout(cleanup, TOTAL + 1200);
}
