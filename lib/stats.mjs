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

function total(stats) {
  return Object.values(stats).reduce((s, n) => s + n, 0);
}

function monthSum(stats, y, mo) {
  const p = `${y}-${pad2(mo)}`;
  let s = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (k.startsWith(p + '-')) s += v;
  }
  return s;
}

function yearSum(stats, y) {
  let s = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (k.startsWith(`${y}-`)) s += v;
  }
  return s;
}

function cell(n, max) {
  if (!n) return '·';
  const r = max ? n / max : 0;
  if (r >= 0.66) return '█';
  if (r >= 0.33) return '▓';
  return '░';
}

function rowNums(from, to, today) {
  let s = '';
  for (let d = from; d <= to; d++) {
    const mark = d === today ? '›' : ' ';
    s += mark + pad2(d) + ' ';
  }
  return s.trimEnd();
}

function rowBars(stats, y, mo, from, to, max) {
  let s = '';
  for (let d = from; d <= to; d++) {
    const n = stats[`${y}-${pad2(mo)}-${pad2(d)}`] || 0;
    s += cell(n, max) + '  ';
  }
  return s.trimEnd();
}

export function statsSummary(data) {
  const stats = data.avitoStats || {};
  const p = mskParts();
  const all = total(stats);
  const year = yearSum(stats, p.y);
  const month = monthSum(stats, p.y, p.mo + 1);
  return `+1\n\nмесяц ${month}\nгод ${year}\nвсего ${all}`;
}

export function reportMonth(data) {
  const stats = data.avitoStats || {};
  const p = mskParts();
  const y = p.y;
  const mo = p.mo + 1;
  const days = new Date(y, mo, 0).getDate();
  const today = p.d;

  let max = 1;
  for (let d = 1; d <= days; d++) {
    const n = stats[`${y}-${pad2(mo)}-${pad2(d)}`] || 0;
    if (n > max) max = n;
  }

  const sum = monthSum(stats, y, mo);
  const mid = Math.min(15, days);
  const head = `+1 · ${pad2(mo)}.${y} · ${sum}`;

  const a = `${rowNums(1, mid, today)}\n${rowBars(stats, y, mo, 1, mid, max)}`;
  if (days <= 15) return `${head}\n\n${a}`;

  const b = `${rowNums(16, days, today)}\n${rowBars(stats, y, mo, 16, days, max)}`;
  return `${head}\n\n${a}\n\n${b}`;
}

export function reportYear(data) {
  const stats = data.avitoStats || {};
  const p = mskParts();
  const y = p.y;
  const cur = p.mo + 1;

  let max = 1;
  const vals = [];
  for (let m = 1; m <= 12; m++) {
    const n = monthSum(stats, y, m);
    vals.push(n);
    if (n > max) max = n;
  }

  const sum = yearSum(stats, y);
  let nums = '';
  let bars = '';
  for (let m = 1; m <= 12; m++) {
    const mark = m === cur ? '›' : ' ';
    nums += `${mark}${pad2(m)} `;
    bars += `${cell(vals[m - 1], max)}  `;
  }

  return `+1 · ${y} · ${sum}\n\n${nums.trimEnd()}\n${bars.trimEnd()}`;
}

export function reportAll(data) {
  const stats = data.avitoStats || {};
  const all = total(stats);
  if (!all) return '+1 · всё время\n\n0';

  const byYear = {};
  for (const [k, v] of Object.entries(stats)) {
    const y = k.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + v;
  }

  const years = Object.keys(byYear).sort();
  const max = Math.max(...Object.values(byYear), 1);

  const lines = years.map((y) => {
    const n = byYear[y];
    const len = Math.max(1, Math.round((n / max) * 10));
    return `${y} ${'█'.repeat(len)} ${n}`;
  });

  return `+1 · всё время · ${all}\n\n${lines.join('\n')}`;
}

export function statsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Месяц', callback_data: 'm:stats:m' },
        { text: 'Год', callback_data: 'm:stats:y' },
      ],
      [{ text: 'Всё время', callback_data: 'm:stats:a' }],
      [{ text: 'Назад', callback_data: 'm:home' }],
    ],
  };
}
