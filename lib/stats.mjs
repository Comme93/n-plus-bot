import { mskParts, mskDayKey, pad2 } from './time.mjs';

export function bumpAvito(data, count) {
  if (!data.avitoStats) data.avitoStats = {};
  const day = mskDayKey();
  data.avitoStats[day] = (data.avitoStats[day] || 0) + count;
}

export function mergeDayStats(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

export function monthChart(data) {
  const p = mskParts();
  const year = p.y;
  const month = p.mo + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const stats = data.avitoStats || {};
  const today = Number(pad2(p.d));

  let max = 1;
  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad2(month)}-${pad2(d)}`;
    const n = stats[key] || 0;
    if (n > max) max = n;
    rows.push({ d, n });
  }

  const lines = [`Avito +1`, `${pad2(month)} / ${year}`, ''];
  for (const { d, n } of rows) {
    const len = n ? Math.max(1, Math.round((n / max) * 10)) : 0;
    const bar = (n ? '█' : '·').repeat(len || 1);
    const mark = d === today ? '>' : ' ';
    lines.push(`${mark}${pad2(d)} ${bar} ${n}`);
  }
  const total = rows.reduce((s, r) => s + r.n, 0);
  lines.push('', `итого ${total}`);
  return lines.join('\n');
}
