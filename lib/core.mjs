const AVITO_URL =
  'https://www.avito.ru/moskva/vakansii/format_raboty/udalenno-ASgBAgICAUSejBW~lZED/tag/udalennaya-rabota?cd=1&context=H4sIAAAAAAAA_wEmANn_YToxOntzOjE6InkiO3M6MTY6IjcxQ1FBbkNXb0F6SzlVb3kiO32ZrD1SJgAAAA&f=ASgBAgICA0T2DIC6AZTND9Lq9AKejBW~lZED&localPriority=1&s=104';

export { AVITO_URL };

export async function fetchVacancyIds() {
  const res = await fetch(AVITO_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Avito ${res.status}`);
  const html = await res.text();
  return [...new Set([...html.matchAll(/data-item-id="(\d+)"/g)].map((m) => m[1]))];
}

export async function checkAvito(data, send) {
  const ids = await fetchVacancyIds();
  if (!ids.length) return data;

  if (!data.seeded) {
    data.seen = ids;
    data.seeded = true;
    console.log(`[avito] база: ${ids.length}`);
    return data;
  }

  const fresh = ids.filter((id) => !data.seen.includes(id));
  if (!fresh.length) return data;

  data.seen = [...new Set([...fresh, ...data.seen])].slice(0, 500);
  for (const chatId of data.users) {
    for (const _ of fresh) await send(chatId, '+1');
  }
  console.log(`[avito] +${fresh.length}`);
  return data;
}

export async function tickReminders(data, send) {
  const now = Date.now();
  for (const r of data.reminders) {
    if (now - r.last < r.hours * 3_600_000) continue;
    await send(r.chatId, r.text);
    r.last = now;
    console.log(`[напоминание] ${r.text}`);
  }
  return data;
}
