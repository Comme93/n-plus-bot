import {
  parseClock,
  formatMsk,
  clockStr,
  mskParts,
  mskDayKey,
  onceTodayAt,
  isTodayMsk,
} from './time.mjs';
import { statsSummary, reportMonth, reportYear, reportAll, statsKeyboard } from './stats.mjs';
import { ensureUi, getUi, setUi, clearUi, panelId, setPanel } from './ui-state.mjs';

const HOURS = [1, 2, 3, 4, 6, 12, 24];

const MENU = () => ({
  inline_keyboard: [
    [
      { text: 'Создать', callback_data: 'm:create' },
      { text: 'Список', callback_data: 'm:list' },
    ],
    [
      { text: 'Аналитика', callback_data: 'm:stats' },
      { text: 'Очистить', callback_data: 'm:clear' },
    ],
  ],
});

function hoursRow(prefix) {
  return { inline_keyboard: [HOURS.map((h) => ({ text: String(h), callback_data: `${prefix}:${h}` }))] };
}

function pickRow(h, mi) {
  const t = clockStr(h, mi);
  return {
    inline_keyboard: [
      [{ text: `Ежедневно ${t}`, callback_data: 'p:daily' }],
      [{ text: `Сегодня ${t}`, callback_data: 'p:today' }],
      [{ text: 'Отмена', callback_data: 'm:home' }],
    ],
  };
}

function editRow(r) {
  const timed = r.type === 'daily' || r.type === 'once' || r.at;
  return {
    inline_keyboard: [
      [
        { text: 'Текст', callback_data: `e:text:${r.id}` },
        { text: timed ? 'Время' : 'Часы', callback_data: timed ? `e:time:${r.id}` : `e:hours:${r.id}` },
      ],
      [{ text: 'Удалить', callback_data: `e:del:${r.id}` }],
      [{ text: 'Назад', callback_data: 'm:list' }],
    ],
  };
}

function rid() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

function mine(data, chatId) {
  return data.reminders.filter((r) => r.chatId === chatId);
}

function clockFromTs(ts) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const g = (t) => parts.find((x) => x.type === t)?.value;
  return [parseInt(g('hour'), 10), parseInt(g('minute'), 10)];
}

function short(r) {
  if (r.type === 'daily') return `${r.text} · ${clockStr(r.hour, r.minute)} · день`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text} · ${clockStr(h, mi)} · сегодня`;
    }
    return `${r.text} · ${formatMsk(r.at)}`;
  }
  return `${r.text} · ${r.hours}ч`;
}

function body(r) {
  if (r.type === 'daily') return `${r.text}\n${clockStr(r.hour, r.minute)} · каждый день`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text}\n${clockStr(h, mi)} · сегодня`;
    }
    return `${r.text}\n${formatMsk(r.at)}`;
  }
  return `${r.text}\nкаждые ${r.hours} ч`;
}

async function call(api, method, body) {
  const json = await api(method, body);
  return json;
}

function editOk(r) {
  return r.ok || r.description?.includes('message is not modified');
}

function editGone(r) {
  const d = r.description || '';
  return d.includes('message to edit not found') || d.includes("message can't be edited");
}

async function show(data, chatId, api, text, markup, forceId) {
  const id = forceId || panelId(data, chatId);
  if (id) {
    const r = await call(api, 'editMessageText', {
      chat_id: chatId,
      message_id: id,
      text,
      reply_markup: markup,
    });
    if (editOk(r)) {
      setPanel(data, chatId, id);
      return id;
    }
    if (!editGone(r)) {
      setPanel(data, chatId, id);
      return id;
    }
  }
  const r = await call(api, 'sendMessage', { chat_id: chatId, text, reply_markup: markup });
  if (r.ok) setPanel(data, chatId, r.result.message_id);
  return r.ok ? r.result.message_id : null;
}

async function delMsg(api, chatId, messageId) {
  if (!messageId) return;
  await call(api, 'deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function purge(api, chatId, keepId) {
  if (!keepId) return;
  const tasks = [];
  for (let id = keepId - 100; id < keepId; id++) {
    if (id > 0) tasks.push(delMsg(api, chatId, id));
  }
  for (let id = keepId + 1; id <= keepId + 40; id++) {
    tasks.push(delMsg(api, chatId, id));
  }
  await Promise.allSettled(tasks);
}

function addRepeat(data, chatId, text, hours) {
  data.reminders.push({ id: rid(), chatId, text, type: 'repeat', hours, last: Date.now() });
}

function addDaily(data, chatId, text, h, mi) {
  const p = mskParts();
  const today = mskDayKey();
  const past = p.h > h || (p.h === h && p.mi >= mi);
  data.reminders.push({
    id: rid(),
    chatId,
    text,
    type: 'daily',
    hour: h,
    minute: mi,
    lastDay: past ? today : null,
  });
}

function addOnce(data, chatId, text, at) {
  data.reminders.push({ id: rid(), chatId, text, type: 'once', at });
}

export async function handleUpdate(data, update, api) {
  ensureUi(data);
  if (update.callback_query) return onCb(data, update.callback_query, api);
  if (update.message?.text) return onText(data, update.message, api);
  return data;
}

async function onCb(data, cb, api) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const d = cb.data;
  const ui = getUi(data, chatId);

  setPanel(data, chatId, msgId);
  await call(api, 'answerCallbackQuery', { callback_query_id: cb.id });

  if (d === 'm:home') {
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    await show(data, chatId, api, 'Напоминания', MENU(), msgId);
    return data;
  }

  if (d === 'm:create') {
    setUi(data, chatId, { step: 'name', panel: msgId, draft: {} });
    await show(data, chatId, api, 'Название', { inline_keyboard: [[{ text: 'Отмена', callback_data: 'm:home' }]] }, msgId);
    return data;
  }

  if (d === 'm:list') {
    const list = mine(data, chatId);
    if (!list.length) {
      await show(data, chatId, api, 'Список пуст', MENU(), msgId);
      return data;
    }
    const rows = list.map((r) => [{ text: short(r), callback_data: `e:open:${r.id}` }]);
    rows.push([{ text: 'Назад', callback_data: 'm:home' }]);
    await show(data, chatId, api, 'Список', { inline_keyboard: rows }, msgId);
    return data;
  }

  if (d === 'm:stats') {
    await show(data, chatId, api, statsSummary(data), statsKeyboard(), msgId);
    return data;
  }

  if (d === 'm:stats:m') {
    await show(data, chatId, api, reportMonth(data), statsKeyboard(), msgId);
    return data;
  }

  if (d === 'm:stats:y') {
    await show(data, chatId, api, reportYear(data), statsKeyboard(), msgId);
    return data;
  }

  if (d === 'm:stats:a') {
    await show(data, chatId, api, reportAll(data), statsKeyboard(), msgId);
    return data;
  }

  if (d === 'm:clear') {
    await purge(api, chatId, msgId);
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    await call(api, 'editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: '—',
      reply_markup: { inline_keyboard: [] },
    });
    await show(data, chatId, api, 'Напоминания', MENU(), msgId);
    return data;
  }

  if (d.startsWith('e:open:')) {
    const r = data.reminders.find((x) => x.id === d.slice(7));
    if (!r) return data;
    await show(data, chatId, api, body(r), editRow(r), msgId);
    return data;
  }

  if (d.startsWith('e:del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== d.slice(6));
    await show(data, chatId, api, 'Удалено', MENU(), msgId);
    return data;
  }

  if (d.startsWith('e:text:')) {
    setUi(data, chatId, { step: 'edit_name', editId: d.slice(7), panel: msgId });
    await show(data, chatId, api, 'Новый текст', { inline_keyboard: [[{ text: 'Отмена', callback_data: `e:open:${d.slice(7)}` }]] }, msgId);
    return data;
  }

  if (d.startsWith('e:time:')) {
    setUi(data, chatId, { step: 'edit_time', editId: d.slice(7), panel: msgId });
    await show(data, chatId, api, 'Время 21:23', { inline_keyboard: [[{ text: 'Отмена', callback_data: `e:open:${d.slice(7)}` }]] }, msgId);
    return data;
  }

  if (d.startsWith('e:hours:')) {
    setUi(data, chatId, { step: 'edit_hours', editId: d.slice(8), panel: msgId });
    await show(data, chatId, api, 'Интервал', hoursRow('s'), msgId);
    return data;
  }

  if (d === 'p:daily' && ui?.step === 'pick' && ui.draft?.text) {
    const { text, h, mi } = ui.draft;
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    addDaily(data, chatId, text, h, mi);
    await show(data, chatId, api, 'Сохранено', MENU(), msgId);
    return data;
  }

  if (d === 'p:today' && ui?.step === 'pick' && ui.draft?.text) {
    const { text, h, mi } = ui.draft;
    const at = onceTodayAt(h, mi);
    if (!at) {
      await show(data, chatId, api, `${clockStr(h, mi)}\nуже прошло`, pickRow(h, mi), msgId);
      return data;
    }
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    addOnce(data, chatId, text, at);
    await show(data, chatId, api, 'Сохранено', MENU(), msgId);
    return data;
  }

  if (d.startsWith('h:') && ui?.step === 'when' && ui.draft?.text) {
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    addRepeat(data, chatId, ui.draft.text, parseInt(d.slice(2), 10));
    await show(data, chatId, api, 'Сохранено', MENU(), msgId);
    return data;
  }

  if (d.startsWith('s:')) {
    const ui2 = getUi(data, chatId);
    if (ui2?.step !== 'edit_hours' || !ui2.editId) return data;
    const r = data.reminders.find((x) => x.id === ui2.editId);
    if (r) {
      r.hours = parseInt(d.slice(2), 10);
      r.type = 'repeat';
      r.last = Date.now();
      delete r.at;
      delete r.hour;
      delete r.minute;
      delete r.lastDay;
    }
    clearUi(data, chatId);
    setPanel(data, chatId, msgId);
    await show(data, chatId, api, 'Сохранено', MENU(), msgId);
    return data;
  }

  return data;
}

async function onText(data, msg, api) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const ui = getUi(data, chatId);
  const pid = panelId(data, chatId);

  if (!data.users.includes(chatId)) data.users.push(chatId);

  if (text === '/start' || text === 'Напоминания') {
    await delMsg(api, chatId, msg.message_id);
    clearUi(data, chatId);
    await show(data, chatId, api, 'Напоминания', MENU(), pid);
    return data;
  }

  if (!ui?.step) return data;

  await delMsg(api, chatId, msg.message_id);

  if (ui.step === 'name') {
    setUi(data, chatId, { step: 'when', draft: { text } });
    await show(
      data,
      chatId,
      api,
      `${text}\n\nВремя 21:23\nили интервал`,
      hoursRow('h'),
      pid,
    );
    return data;
  }

  if (ui.step === 'when' && ui.draft?.text) {
    const clock = parseClock(text);
    if (!clock) {
      await show(data, chatId, api, 'Формат 21:23', hoursRow('h'), pid);
      return data;
    }
    setUi(data, chatId, { step: 'pick', draft: { text: ui.draft.text, h: clock.h, mi: clock.mi } });
    await show(data, chatId, api, `${ui.draft.text}\n${clockStr(clock.h, clock.mi)}`, pickRow(clock.h, clock.mi), pid);
    return data;
  }

  if (ui.step === 'edit_name' && ui.editId) {
    const r = data.reminders.find((x) => x.id === ui.editId);
    if (r) r.text = text;
    clearUi(data, chatId);
    await show(data, chatId, api, 'Сохранено', MENU(), pid);
    return data;
  }

  if (ui.step === 'edit_time' && ui.editId) {
    const clock = parseClock(text);
    if (!clock) {
      await show(data, chatId, api, 'Формат 21:23', { inline_keyboard: [[{ text: 'Отмена', callback_data: `e:open:${ui.editId}` }]] }, pid);
      return data;
    }
    const r = data.reminders.find((x) => x.id === ui.editId);
    if (r) {
      r.type = 'daily';
      r.hour = clock.h;
      r.minute = clock.mi;
      r.lastDay = null;
      delete r.hours;
      delete r.last;
      delete r.at;
    }
    clearUi(data, chatId);
    await show(data, chatId, api, 'Сохранено', MENU(), pid);
    return data;
  }

  return data;
}

export function makeApi(token) {
  return async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const ign = ['message to delete not found', 'message is not modified', "message can't be deleted"];
    if (!json.ok && !ign.some((s) => json.description?.includes(s))) {
      console.error('[tg]', method, json.description);
    }
    return json;
  };
}

export function makeSend(api) {
  return (chatId, text) => api('sendMessage', { chat_id: chatId, text });
}
