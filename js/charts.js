// Small SVG charts, built with DOM calls rather than markup strings so nothing
// from a session record is ever interpolated into parsed markup.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

/* -------------------------------------------------------------- pace chart */

const PACE_W = 300;
const PACE_H = 96;
const PACE_PAD = { top: 10, right: 6, bottom: 16, left: 6 };

/**
 * Breaths per minute over time. Higher pace sits higher on the chart, so a line
 * that falls to the right is a practice settling into slower breathing.
 */
export function paceChart(series) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${PACE_W} ${PACE_H}`,
    class: 'chart pace-chart',
    preserveAspectRatio: 'none',
    role: 'img',
  });

  const title = svgEl('title');
  title.textContent = 'Average breathing pace per day, in breaths per minute';
  svg.appendChild(title);

  if (series.length === 0) return svg;

  const values = series.flatMap((point) => [point.bpm, point.rolling ?? point.bpm]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A flat line would otherwise divide by zero; give it a band to sit inside.
  const pad = rawMax - rawMin < 0.4 ? 0.4 : (rawMax - rawMin) * 0.2;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const plotW = PACE_W - PACE_PAD.left - PACE_PAD.right;
  const plotH = PACE_H - PACE_PAD.top - PACE_PAD.bottom;
  const x = (i) => PACE_PAD.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = (bpm) => PACE_PAD.top + plotH - ((bpm - min) / (max - min)) * plotH;

  const path = (pick) => series
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(point)).toFixed(1)}`)
    .join(' ');

  const rawLine = path((point) => point.bpm);
  const smoothLine = path((point) => point.rolling ?? point.bpm);
  const points = series.map((point, i) => [x(i), y(point.rolling ?? point.bpm)]);
  const line = smoothLine;

  const gradientId = 'paceFill';
  const defs = svgEl('defs');
  const gradient = svgEl('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.appendChild(svgEl('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '.35' }));
  gradient.appendChild(svgEl('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }));
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const base = PACE_PAD.top + plotH;
  svg.appendChild(svgEl('path', {
    d: `${line} L${points.at(-1)[0].toFixed(1)},${base} L${points[0][0].toFixed(1)},${base} Z`,
    fill: `url(#${gradientId})`,
    stroke: 'none',
  }));
  // The day-by-day figure stays visible but recedes: it is honest about how
  // variable the practice actually is without competing with the trend.
  svg.appendChild(svgEl('path', {
    d: rawLine,
    fill: 'none',
    stroke: 'var(--accent)',
    'stroke-width': 1,
    'stroke-opacity': .28,
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  svg.appendChild(svgEl('path', {
    d: smoothLine,
    fill: 'none',
    stroke: 'var(--accent)',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  // Only the most recent point is marked; the rest is shape, not data to read.
  const [lastX, lastY] = points.at(-1);
  svg.appendChild(svgEl('circle', { cx: lastX, cy: lastY, r: 3.5, fill: 'var(--accent)' }));

  return svg;
}

/* ----------------------------------------------------------------- heatmap */

const CELL = 12;
const GAP = 3;

/** GitHub-style grid: one column per week, one row per weekday. */
export function heatmapGrid(columns) {
  const width = columns.length * (CELL + GAP) - GAP;
  const height = 7 * (CELL + GAP) - GAP;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart heatmap',
    role: 'img',
  });

  const title = svgEl('title');
  title.textContent = 'Practice minutes per day over the last 13 weeks';
  svg.appendChild(title);

  columns.forEach((column, weekIndex) => {
    column.forEach((day, weekdayIndex) => {
      if (day.future) return;
      const cell = svgEl('rect', {
        x: weekIndex * (CELL + GAP),
        y: weekdayIndex * (CELL + GAP),
        width: CELL,
        height: CELL,
        rx: 3,
        class: `cell level-${day.level}`,
      });
      const label = svgEl('title');
      const when = day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      label.textContent = day.minutes > 0 ? `${when} — ${day.minutes} min` : `${when} — no practice`;
      cell.appendChild(label);
      svg.appendChild(cell);
    });
  });

  return svg;
}
