import { Markup } from 'telegraf';

const AVITO_URL =
  'https://www.avito.ru/moskva/vakansii/format_raboty/udalenno-ASgBAgICAUSejBW~lZED/tag/udalennaya-rabota?cd=1&context=H4sIAAAAAAAA_wEmANn_YToxOntzOjE6InkiO3M6MTY6IjcxQ1FBbkNXb0F6SzlVb3kiO32ZrD1SJgAAAA&f=ASgBAgICA0T2DIC6AZTND9Lq9AKejBW~lZED&localPriority=1&s=104';

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

export function parseReminder(text) {
  const m = text.trim().match(/^(\d+)\s*ч(?:ас(?:а|ов)?)?\s+(.+)$/i);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  if (hours < 1 || hours > 168) return null;
  return { hours, text: m[2].trim() };
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
    await send(r.chatId, `⏰ ${r.text}`);
    r.last = now;
    console.log(`[напоминание] ${r.text}`);
  }
  return data;
}

export async function handleTelegramUpdate(data, update, api) {
  const msg = update.message;
  const cb = update.callback_query;

  if (cb?.data?.startsWith('del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== cb.data.slice(4));
    await api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Удалено' });
    await api('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: '🗑 Удалено',
    });
    return data;
  }

  if (!msg?.text) return data;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text === '/start') {
    if (!data.users.includes(chatId)) data.users.push(chatId);
    await api('sendMessage', {
      chat_id: chatId,
      text:
        '✅ Готово!\n\n🔔 Новые вакансии с Авито → «+1»\n\n⏰ Напоминание:\n4ч купить наушники\n\n/list — список',
      reply_markup: Markup.keyboard([['📋 Мои напоминания']]).resize().reply_markup,
    });
    return data;
  }

  if (text === '/list' || text === '📋 Мои напоминания') {
    const mine = data.reminders.filter((r) => r.chatId === chatId);
    if (!mine.length) {
      await api('sendMessage', {
        chat_id: chatId,
        text: 'Пока пусто.\n\nПример: 4ч купить наушники',
      });
      return data;
    }
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Тапни чтобы удалить:',
      reply_markup: {
        inline_keyboard: mine.map((r) => [
          { text: `❌ ${r.hours}ч — ${r.text}`, callback_data: `del:${r.id}` },
        ]),
      },
    });
    return data;
  }

  const parsed = parseReminder(text);
  if (!parsed) return data;

  if (!data.users.includes(chatId)) data.users.push(chatId);
  data.reminders.push({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    chatId,
    text: parsed.text,
    hours: parsed.hours,
    last: Date.now(),
  });
  await api('sendMessage', { chat_id: chatId, text: `⏰ ${parsed.text}` });
  await api('sendMessage', {
    chat_id: chatId,
    text: `✅ Ок! Каждые ${parsed.hours} ч (МСК): «${parsed.text}»`,
  });
  return data;
}

export async function runBotCycle(data, token) {
  const api = async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const send = (chatId, text) => api('sendMessage', { chat_id: chatId, text });

  const updates = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?offset=${data.updateOffset || 0}&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`
  ).then((r) => r.json());

  if (updates.ok && updates.result?.length) {
    for (const u of updates.result) {
      data = await handleTelegramUpdate(data, u, api);
      data.updateOffset = u.update_id + 1;
    }
  }

  try {
    data = await checkAvito(data, send);
  } catch (e) {
    console.error('[avito]', e.message);
  }
  data = await tickReminders(data, send);
  return data;
}
