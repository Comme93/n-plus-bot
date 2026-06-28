export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function clockStr(h, mi) {
  return `${pad2(h)}:${pad2(mi)}`;
}

export function parseClock(input) {
  const m = input.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

export function mskDayKey() {
  const p = mskParts();
  return `${p.y}-${pad2(p.mo + 1)}-${pad2(p.d)}`;
}

export function mskParts() {
  const s = new Date().toLocaleString('en-CA', { timeZone: 'Europe/Moscow', hour12: false });
  const [date, time] = s.split(', ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return { y, mo: mo - 1, d, h, mi };
}

export function mskToTs(y, mo, d, h, mi) {
  return Date.UTC(y, mo, d, h - 3, mi);
}

export function parseMskTime(input) {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  let addDay = 0;

  if (s.startsWith('завтра ')) {
    addDay = 1;
    s = s.slice(7);
  } else if (s.startsWith('сегодня ')) {
    s = s.slice(8);
  }

  const m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;

  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;

  const p = mskParts();
  let ts = mskToTs(p.y, p.mo, p.d + addDay, h, mi);

  if (addDay === 0 && !input.toLowerCase().includes('завтра') && ts <= Date.now()) {
    ts = mskToTs(p.y, p.mo, p.d + 1, h, mi);
  }

  return ts;
}

export function onceTodayAt(h, mi) {
  const p = mskParts();
  const ts = mskToTs(p.y, p.mo, p.d, h, mi);
  if (ts <= Date.now()) return null;
  return ts;
}

export function isTodayMsk(ts) {
  const p = mskParts();
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((x) => x.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}` === mskDayKey();
}

export function formatMsk(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
