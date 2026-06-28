import {
  parseMskTime,
  parseClock,
  formatMsk,
  clockStr,
  mskParts,
  mskDayKey,
  onceTodayAt,
  isTodayMsk,
} from './time.mjs';
import { monthChart } from './stats.mjs';

const HOURS = [1, 2, 3, 4, 6, 12, 24];

function hoursKeyboard(prefix = 'hour') {
  return {
    inline_keyboard: [HOURS.map((h) => ({ text: String(h), callback_data: `${prefix}:${h}` }))],
  };
}

function mainKeyboard() {
  return { keyboard: [[{ text: 'Напоминания' }]], resize_keyboard: true };
}

function remMenu() {
  return {
    inline_keyboard: [
      [{ text: 'Создать', callback_data: 'rem:create' }],
      [{ text: 'Список', callback_data: 'rem:list' }],
      [{ text: 'Аналитика', callback_data: 'stats:month' }],
      [{ text: 'Очистить чат', callback_data: 'chat:clear' }],
    ],
  };
}

function modeKeyboard(h, mi) {
  const t = clockStr(h, mi);
  return {
    inline_keyboard: [
      [{ text: `Ежедневно ${t}`, callback_data: 'mode:daily' }],
      [{ text: `Сегодня ${t}`, callback_data: 'mode:today' }],
    ],
  };
}

function editMenu(r) {
  const isDaily = r.type === 'daily';
  const isOnce = r.type === 'once' || r.at;
  return {
    inline_keyboard: [
      [
        { text: 'Текст', callback_data: `edittext:${r.id}` },
        {
          text: isDaily || isOnce ? 'Время' : 'Часы',
          callback_data: isDaily || isOnce ? `edittime:${r.id}` : `edithours:${r.id}`,
        },
      ],
      [{ text: 'Удалить', callback_data: `del:${r.id}` }],
      [{ text: 'Назад', callback_data: 'rem:list' }],
    ],
  };
}

function ensure(data) {
  if (!data.sessions) data.sessions = {};
  if (!data.pending) data.pending = {};
  if (!data.users) data.users = [];
  if (!data.reminders) data.reminders = [];
  if (!data.panels) data.panels = {};
  if (!data.avitoStats) data.avitoStats = {};
}

function mine(data, chatId) {
  return data.reminders.filter((r) => r.chatId === chatId);
}

function rid() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

function sid(chatId) {
  return String(chatId);
}

function clockFromTs(ts) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((x) => x.type === t)?.value;
  return [parseInt(get('hour'), 10), parseInt(get('minute'), 10)];
}

function label(r) {
  if (r.type === 'daily') return `${r.text}, ежедневно ${clockStr(r.hour, r.minute)}`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text}, сегодня ${clockStr(h, mi)}`;
    }
    return `${r.text}, ${formatMsk(r.at)}`;
  }
  return `${r.text}, каждые ${r.hours}ч`;
}

function detail(r) {
  if (r.type === 'daily') return `${r.text}\nежедневно ${clockStr(r.hour, r.minute)}`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text}\nсегодня ${clockStr(h, mi)}`;
    }
    return `${r.text}\n${formatMsk(r.at)}`;
  }
  return `${r.text}\nкаждые ${r.hours} ч`;
}

function clearWait(data, chatId) {
  delete data.sessions[sid(chatId)];
  delete data.pending[sid(chatId)];
}

function getWait(data, chatId) {
  return data.pending[sid(chatId)];
}

function panelMsgId(data, chatId) {
  return data.panels[sid(chatId)]?.messageId;
}

function setPanelMsgId(data, chatId, messageId) {
  data.panels[sid(chatId)] = { messageId };
}

async function panel(data, chatId, api, text, reply_markup, msgId) {
  const id = msgId || panelMsgId(data, chatId);
  if (id) {
    const r = await api('editMessageText', {
      chat_id: chatId,
      message_id: id,
      text,
      reply_markup,
    });
    if (r.ok) {
      setPanelMsgId(data, chatId, id);
      return r;
    }
  }
  const r = await api('sendMessage', { chat_id: chatId, text, reply_markup });
  if (r.ok) setPanelMsgId(data, chatId, r.result.message_id);
  return r;
}

async function delUser(api, msg) {
  await api('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
}

async function purgeChat(api, chatId, aroundId) {
  if (!aroundId) return;
  const from = Math.max(1, aroundId - 120);
  for (let id = from; id <= aroundId + 3; id++) {
    await api('deleteMessage', { chat_id: chatId, message_id: id });
  }
}

function addRepeat(data, chatId, text, hours) {
  data.reminders.push({
    id: rid(),
    chatId,
    text,
    type: 'repeat',
    hours,
    last: Date.now(),
  });
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
  ensure(data);
  if (data.lastUpdateId && update.update_id <= data.lastUpdateId) return data;
  data.lastUpdateId = update.update_id;
  if (update.callback_query) return handleCallback(data, update.callback_query, api);
  if (update.message?.text) return handleMessage(data, update.message, api);
  return data;
}

async function handleCallback(data, cb, api) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const d = cb.data;
  const w = getWait(data, chatId);

  setPanelMsgId(data, chatId, msgId);
  await api('answerCallbackQuery', { callback_query_id: cb.id });

  if (d === 'rem:menu') {
    await panel(data, chatId, api, 'Напоминания', remMenu(), msgId);
    return data;
  }

  if (d === 'rem:create') {
    clearWait(data, chatId);
    data.sessions[sid(chatId)] = { step: 'new_text' };
    await panel(data, chatId, api, 'Название', { inline_keyboard: [] }, msgId);
    return data;
  }

  if (d === 'rem:list') {
    const list = mine(data, chatId);
    if (!list.length) {
      await panel(data, chatId, api, 'Пусто', remMenu(), msgId);
      return data;
    }
    const rows = list.map((r) => [{ text: label(r), callback_data: `edit:${r.id}` }]);
    rows.push([{ text: 'Назад', callback_data: 'rem:menu' }]);
    await panel(data, chatId, api, 'Список', { inline_keyboard: rows }, msgId);
    return data;
  }

  if (d === 'stats:month') {
    const chart = monthChart(data);
    await panel(
      data,
      chatId,
      api,
      chart,
      { inline_keyboard: [[{ text: 'Назад', callback_data: 'rem:menu' }]] },
      msgId,
    );
    return data;
  }

  if (d === 'chat:clear') {
    await purgeChat(api, chatId, msgId);
    await panel(data, chatId, api, 'Напоминания', remMenu());
    return data;
  }

  if (d.startsWith('edit:')) {
    const r = data.reminders.find((x) => x.id === d.slice(5));
    if (!r) return data;
    await panel(data, chatId, api, detail(r), editMenu(r), msgId);
    return data;
  }

  if (d.startsWith('del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== d.slice(4));
    await panel(data, chatId, api, 'Удалено', remMenu(), msgId);
    return data;
  }

  if (d.startsWith('edittext:')) {
    data.sessions[sid(chatId)] = { step: 'edit_text', id: d.slice(9) };
    await panel(data, chatId, api, 'Текст', { inline_keyboard: [] }, msgId);
    return data;
  }

  if (d.startsWith('edithours:')) {
    data.sessions[sid(chatId)] = { step: 'edit_hours', id: d.slice(10) };
    await panel(data, chatId, api, 'Интервал, часы', hoursKeyboard('sethour'), msgId);
    return data;
  }

  if (d.startsWith('edittime:')) {
    data.sessions[sid(chatId)] = { step: 'edit_time', id: d.slice(10) };
    await panel(data, chatId, api, 'Время 21:23', { inline_keyboard: [] }, msgId);
    return data;
  }

  if (d === 'mode:daily' && w?.step === 'mode' && w.text != null) {
    const { text, hour, minute } = w;
    clearWait(data, chatId);
    addDaily(data, chatId, text, hour, minute);
    await panel(data, chatId, api, 'Готово', remMenu(), msgId);
    return data;
  }

  if (d === 'mode:today' && w?.step === 'mode' && w.text != null) {
    const at = onceTodayAt(w.hour, w.minute);
    if (!at) {
      await panel(data, chatId, api, 'Уже прошло', modeKeyboard(w.hour, w.minute), msgId);
      return data;
    }
    const { text, hour, minute } = w;
    clearWait(data, chatId);
    addOnce(data, chatId, text, at);
    await panel(data, chatId, api, 'Готово', remMenu(), msgId);
    return data;
  }

  if (d.startsWith('hour:') && w?.step === 'when' && w.text) {
    clearWait(data, chatId);
    addRepeat(data, chatId, w.text, parseInt(d.slice(5), 10));
    await panel(data, chatId, api, 'Готово', remMenu(), msgId);
    return data;
  }

  if (d.startsWith('sethour:')) {
    const hours = parseInt(d.slice(8), 10);
    const s = data.sessions[sid(chatId)];
    if (s?.step === 'edit_hours' && s.id) {
      const r = data.reminders.find((x) => x.id === s.id);
      if (r) {
        r.hours = hours;
        r.type = 'repeat';
        r.last = Date.now();
        delete r.at;
        delete r.hour;
        delete r.minute;
        delete r.lastDay;
      }
      delete data.sessions[sid(chatId)];
      await panel(data, chatId, api, 'Готово', remMenu(), msgId);
    }
    return data;
  }

  return data;
}

async function openPanel(data, chatId, api) {
  await panel(data, chatId, api, 'Напоминания', remMenu());
  return data;
}

async function handleMessage(data, msg, api) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const s = data.sessions[sid(chatId)];
  const w = getWait(data, chatId);
  const msgId = panelMsgId(data, chatId);

  if (!data.users.includes(chatId)) data.users.push(chatId);

  if (text === '/start') {
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Напоминания',
      reply_markup: mainKeyboard(),
    });
    return openPanel(data, chatId, api);
  }

  if (text === 'Напоминания') return openPanel(data, chatId, api);

  if (w?.step === 'when' && w.text) {
    await delUser(api, msg);

    const onceAt = parseMskTime(text);
    if (text.toLowerCase().includes('завтра') && onceAt) {
      clearWait(data, chatId);
      addOnce(data, chatId, w.text, onceAt);
      await panel(data, chatId, api, 'Готово', remMenu(), msgId);
      return data;
    }

    const clock = parseClock(text);
    if (clock) {
      data.pending[sid(chatId)] = {
        text: w.text,
        step: 'mode',
        hour: clock.h,
        minute: clock.mi,
      };
      await panel(
        data,
        chatId,
        api,
        clockStr(clock.h, clock.mi),
        modeKeyboard(clock.h, clock.mi),
        msgId,
      );
      return data;
    }

    await panel(data, chatId, api, 'Формат: 21:23', hoursKeyboard('hour'), msgId);
    return data;
  }

  if (s?.step === 'new_text') {
    await delUser(api, msg);
    data.pending[sid(chatId)] = { text, step: 'when' };
    delete data.sessions[sid(chatId)];
    await panel(
      data,
      chatId,
      api,
      'Время\n21:23 — введите\nкнопка — каждые N ч',
      hoursKeyboard('hour'),
      msgId,
    );
    return data;
  }

  if (s?.step === 'edit_time' && s.id) {
    await delUser(api, msg);
    const clock = parseClock(text);
    if (!clock) {
      await panel(data, chatId, api, 'Формат: 21:23', { inline_keyboard: [] }, msgId);
      return data;
    }
    const r = data.reminders.find((x) => x.id === s.id);
    if (r) {
      r.type = 'daily';
      r.hour = clock.h;
      r.minute = clock.mi;
      r.lastDay = null;
      delete r.hours;
      delete r.last;
      delete r.at;
    }
    delete data.sessions[sid(chatId)];
    await panel(data, chatId, api, 'Готово', remMenu(), msgId);
    return data;
  }

  if (s?.step === 'edit_text' && s.id) {
    await delUser(api, msg);
    const r = data.reminders.find((x) => x.id === s.id);
    if (r) r.text = text;
    delete data.sessions[sid(chatId)];
    await panel(data, chatId, api, 'Готово', remMenu(), msgId);
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
    if (!json.ok && json.description !== 'Bad Request: message to delete not found') {
      console.error('[tg]', method, json.description);
    }
    return json;
  };
}

export function makeSend(api) {
  return (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, ...extra });
}
