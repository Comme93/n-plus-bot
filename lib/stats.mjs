import { mskParts, mskDayKey, pad2 } from './time.mjs';

const MO = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function sanitizeStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) {
    if (!DAY_KEY.test(k)) continue;
    const n = num(v);
    if (n > 0 && n <= 999) out[k] = n;
  }
  return out;
}

export function bumpAvito(data, count) {
  if (!data.avitoStats) data.avitoStats = {};
  const day = mskDayKey();
  data.avitoStats[day] = num(data.avitoStats[day]) + num(count);
}

/** При слиянии состояния — max, не сумма (иначе счётчик удваивался каждые 5 сек). */
export function mergeDayStats(a, b) {
  const out = sanitizeStats(a);
  for (const [k, v] of Object.entries(sanitizeStats(b))) {
    out[k] = Math.max(num(out[k]), num(v));
  }
  return out;
}

function total(stats) {
  return Object.values(sanitizeStats(stats)).reduce((s, n) => s + n, 0);
}

function monthSum(stats, y, mo) {
  const p = `${y}-${pad2(mo)}`;
  let s = 0;
  for (const [k, v] of Object.entries(sanitizeStats(stats))) {
    if (k.startsWith(p + '-')) s += v;
  }
  return s;
}

function yearSum(stats, y) {
  let s = 0;
  for (const [k, v] of Object.entries(sanitizeStats(stats))) {
    if (k.startsWith(`${y}-`)) s += v;
  }
  return s;
}

export function statsSummary(data) {
  const stats = sanitizeStats(data.avitoStats);
  const p = mskParts();
  const all = total(stats);
  const year = yearSum(stats, p.y);
  const month = monthSum(stats, p.y, p.mo + 1);
  return `+1\n\nмесяц ${month}\nгод ${year}\nвсего ${all}`;
}

export function reportMonth(data) {
  const stats = sanitizeStats(data.avitoStats);
  const p = mskParts();
  const y = p.y;
  const mo = p.mo + 1;
  const sum = monthSum(stats, y, mo);
  const days = new Date(y, mo, 0).getDate();

  const rows = [];
  for (let d = days; d >= 1; d--) {
    const n = stats[`${y}-${pad2(mo)}-${pad2(d)}`] || 0;
    if (n) rows.push(`${pad2(d)}.${pad2(mo)} — ${n}`);
  }

  const body = rows.length ? rows.slice(0, 15).join('\n') : 'нет записей';
  return `+1 · ${MO[mo - 1]} ${y}\n\nвсего ${sum}\n\n${body}`;
}

export function reportYear(data) {
  const stats = sanitizeStats(data.avitoStats);
  const p = mskParts();
  const y = p.y;
  const sum = yearSum(stats, y);

  const rows = [];
  for (let m = 12; m >= 1; m--) {
    const n = monthSum(stats, y, m);
    if (n) rows.push(`${MO[m - 1]} — ${n}`);
  }

  const body = rows.length ? rows.join('\n') : 'нет записей';
  return `+1 · ${y}\n\nвсего ${sum}\n\n${body}`;
}

export function reportAll(data) {
  const stats = sanitizeStats(data.avitoStats);
  const all = total(stats);
  if (!all) return '+1 · всё время\n\nвсего 0';

  const byYear = {};
  for (const [k, v] of Object.entries(stats)) {
    const yr = k.slice(0, 4);
    byYear[yr] = (byYear[yr] || 0) + v;
  }

  const rows = Object.keys(byYear)
    .sort((a, b) => b.localeCompare(a))
    .map((yr) => `${yr} — ${byYear[yr]}`);

  return `+1 · всё время\n\nвсего ${all}\n\n${rows.join('\n')}`;
}

export function statsKeyboard(back = 'm:home') {
  return {
    inline_keyboard: [
      [
        { text: 'Месяц', callback_data: 'm:stats:m' },
        { text: 'Год', callback_data: 'm:stats:y' },
      ],
      [{ text: 'Всё время', callback_data: 'm:stats:a' }],
      [{ text: 'Назад', callback_data: back }],
    ],
  };
}
