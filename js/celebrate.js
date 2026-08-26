// The moment a session completes.
//
// Deliberately not confetti. Confetti is loud, fast and congratulatory, which is
// the opposite of how the end of a breathing session feels. This is a slow bloom
// outward from the breath circle: a few rings expanding and thinning like
// ripples, and soft motes drifting up and fading, in the app's own palette.
// It takes about three seconds and asks for no response.

const RING_COUNT = 3;
const RING_LIFE = 2400;      // ms for a ring to expand and vanish
const RING_STAGGER = 320;
const MOTE_COUNT = 34;
const MOTE_LIFE = 3200;
const TOTAL = 3600;

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
      radius: 1.2 + Math.random() * 2.6,
      rise: 26 + Math.random() * 62,                      // px travelled upward
      sway: 8 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
      delay: Math.random() * 900,
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

    for (let i = 0; i < rings; i += 1) {
      const t = (elapsed - i * RING_STAGGER) / RING_LIFE;
      if (t <= 0 || t >= 1) continue;
      const radius = baseRadius * (0.82 + easeOut(t) * 2.6);
      const alpha = (1 - t) * (reduced ? 0.22 : 0.42);
      const [r, g, b] = TINTS[i % TINTS.length];
      ctx.beginPath();
      ctx.arc(originX, originY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, 2.4 * (1 - t));
      ctx.stroke();
    }

    motes.forEach((mote) => {
      const t = (elapsed - mote.delay) / mote.life;
      if (t <= 0 || t >= 1) return;
      // Fade in over the first fifth, then out across the rest.
      const alpha = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 0.85;
      const x = mote.x + Math.sin(mote.phase + t * Math.PI * 2) * mote.sway;
      const y = mote.y - easeOut(t) * mote.rise;
      const [r, g, b] = mote.tint;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha).toFixed(3)})`;
      ctx.fill();
    });

    frame = requestAnimationFrame(draw);
  }

  frame = requestAnimationFrame(draw);
  // Animation frames stop in a hidden tab; make sure the canvas still goes away.
  setTimeout(cleanup, TOTAL + 1200);
}
