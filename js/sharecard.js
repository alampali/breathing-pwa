// A summary card people can send each other.
//
// Rendered to a canvas on the device and handed to the system share sheet as an
// image. No server, no account, nothing uploaded — the data leaves only if the
// person deliberately sends the picture, which keeps the same promise as the
// CSV export.

import { lifetimeBreaths, dayKey } from './insights.js';

const W = 1080;
const H = 1350;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Totals for the last `days` days, ending today. */
export function summarise(sessions, days = 7) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  const recent = sessions.filter((s) => new Date(s.start) >= cutoff);
  const minutes = recent.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const byPattern = new Map();
  recent.forEach((s) => {
    const name = s.patternName || 'Unknown';
    byPattern.set(name, (byPattern.get(name) || 0) + (Number(s.minutes) || 0));
  });

  return {
    days,
    sessions: recent.length,
    minutes: Math.round(minutes),
    breaths: lifetimeBreaths(recent),
    daysPractised: new Set(recent.map((s) => dayKey(s.start))).size,
    topPatterns: [...byPattern.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

export function renderCard(summary) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
  bg.addColorStop(0, '#071521');
  bg.addColorStop(0.55, '#123f52');
  bg.addColorStop(1, '#0f6b68');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The same soft orbs as the app background, so the card feels like the app.
  [[0.16, 0.14, 330, 'rgba(142,230,255,.20)'],
   [0.86, 0.82, 300, 'rgba(183,255,212,.16)'],
   [0.72, 0.22, 200, 'rgba(255,255,255,.08)']].forEach(([fx, fy, r, colour]) => {
    const glow = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, r);
    glow.addColorStop(0, colour);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  });

  const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = 'rgba(207,231,239,.9)';
  ctx.font = `500 34px ${sans}`;
  ctx.fillText(`LAST ${summary.days} DAYS`, 96, 150);

  ctx.fillStyle = '#f7fbff';
  ctx.font = `700 86px ${sans}`;
  ctx.fillText('Calm Breathing', 96, 250);

  // The headline number is breaths: a real unit, and one that only goes up.
  ctx.fillStyle = '#9ee8ff';
  ctx.font = `700 210px ${sans}`;
  ctx.fillText(summary.breaths.toLocaleString(), 96, 500);

  ctx.fillStyle = '#f7fbff';
  ctx.font = `500 48px ${sans}`;
  ctx.fillText(summary.breaths === 1 ? 'guided breath' : 'guided breaths', 96, 572);

  const tiles = [
    ['Minutes', String(summary.minutes)],
    ['Sessions', String(summary.sessions)],
    ['Days', String(summary.daysPractised)],
  ];
  const tileW = (W - 96 * 2 - 32 * 2) / 3;
  tiles.forEach(([label, value], i) => {
    const x = 96 + i * (tileW + 32);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    roundRect(ctx, x, 648, tileW, 190, 32);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(191,233,239,.95)';
    ctx.font = `600 26px ${sans}`;
    ctx.fillText(label.toUpperCase(), x + 30, 706);
    ctx.fillStyle = '#f7fbff';
    ctx.font = `700 72px ${sans}`;
    ctx.fillText(value, x + 30, 792);
  });

  if (summary.topPatterns.length) {
    ctx.fillStyle = 'rgba(191,233,239,.95)';
    ctx.font = `600 28px ${sans}`;
    ctx.fillText('MOSTLY', 96, 906);

    let y = 968;
    const longest = summary.topPatterns[0][1] || 1;
    summary.topPatterns.forEach(([name, minutes]) => {
      ctx.fillStyle = '#f7fbff';
      ctx.font = `600 38px ${sans}`;
      ctx.fillText(name, 96, y);

      ctx.fillStyle = 'rgba(207,231,239,.8)';
      ctx.font = `500 32px ${sans}`;
      const mins = `${Math.round(minutes)} min`;
      ctx.fillText(mins, W - 96 - ctx.measureText(mins).width, y);

      // A quiet bar under each name, in proportion to time spent.
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      roundRect(ctx, 96, y + 18, W - 192, 10, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(158,232,255,.75)';
      roundRect(ctx, 96, y + 18, (W - 192) * (minutes / longest), 10, 5);
      ctx.fill();
      y += 94;
    });
  }

  ctx.fillStyle = 'rgba(184,219,227,.75)';
  ctx.font = `500 30px ${sans}`;
  ctx.fillText('Breathe with me', 96, H - 62);

  return canvas;
}

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Shares the card, falling back to a download where the share sheet cannot take
 * files — which is most desktop browsers.
 *
 * @returns {Promise<'shared'|'downloaded'|'cancelled'|'failed'>}
 */
export async function shareCard(summary) {
  const canvas = renderCard(summary);
  const blob = await toBlob(canvas);
  if (!blob) return 'failed';

  const file = new File([blob], 'calm-breathing.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Calm Breathing' });
      return 'shared';
    } catch (error) {
      // Dismissing the sheet rejects with AbortError; that is not a failure.
      return error?.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'calm-breathing.png';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 0);
  return 'downloaded';
}
