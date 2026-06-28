import { parseMskTime, parseClock, formatMsk, clockStr, mskParts, mskDayKey } from './time.mjs';

const HOURS = [1, 2, 3, 4, 6, 12, 24];

const PROMPT_NAME = 'Название';
const PROMPT_EDIT = 'Текст';

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
    ],
  };
}

function modeKeyboard(h, mi) {
  const t = clockStr(h, mi);
  return {
    inline_keyboard: [
      [{ text: `Ежедневно ${t}`, callback_data: 'mode:daily' }],
      [{ text: 'Каждые часы', callback_data: 'mode:hours' }],
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

function label(r) {
  if (r.type === 'daily') return `${r.text}, ежедневно ${clockStr(r.hour, r.minute)}`;
  if (r.type === 'once' || r.at) return `${r.text}, ${formatMsk(r.at)}`;
  return `${r.text}, каждые ${r.hours}ч`;
}

function detail(r) {
  if (r.type === 'daily') return `${r.text}\nежедневно ${clockStr(r.hour, r.minute)}`;
  if (r.type === 'once' || r.at) return `${r.text}\n${formatMsk(r.at)}`;
  return `${r.text}\nкаждые ${r.hours} ч`;
}

function clearWait(data, chatId) {
  delete data.sessions[sid(chatId)];
  delete data.pending[sid(chatId)];
}

function getWait(data, chatId) {
  return data.pending[sid(chatId)];
}

async function editMsg(api, chatId, messageId, text, reply_markup) {
  const r = await api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup,
  });
  if (!r.ok) await api('sendMessage', { chat_id: chatId, text, reply_markup });
}

async function done(data, chatId, api) {
  const panel = data.panels[sid(chatId)];
  if (panel?.messageId) {
    await editMsg(api, chatId, panel.messageId, 'Готово', remMenu());
  } else {
    await api('sendMessage', { chat_id: chatId, text: 'Готово', reply_markup: remMenu() });
  }
  return data;
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
  clearWait(data, chatId);
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
  clearWait(data, chatId);
}

function addOnce(data, chatId, text, at) {
  data.reminders.push({ id: rid(), chatId, text, type: 'once', at });
  clearWait(data, chatId);
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

  await api('answerCallbackQuery', { callback_query_id: cb.id });

  if (d === 'rem:menu') {
    await editMsg(api, chatId, msgId, 'Напоминания', remMenu());
    return data;
  }

  if (d === 'rem:create') {
    clearWait(data, chatId);
    data.sessions[sid(chatId)] = { step: 'new_text' };
    await api('sendMessage', { chat_id: chatId, text: PROMPT_NAME });
    return data;
  }

  if (d === 'rem:list') {
    const list = mine(data, chatId);
    if (!list.length) {
      await editMsg(api, chatId, msgId, 'Пусто', remMenu());
      return data;
    }
    const rows = list.map((r) => [{ text: label(r), callback_data: `edit:${r.id}` }]);
    rows.push([{ text: 'Назад', callback_data: 'rem:menu' }]);
    await editMsg(api, chatId, msgId, 'Список', { inline_keyboard: rows });
    return data;
  }

  if (d.startsWith('edit:')) {
    const r = data.reminders.find((x) => x.id === d.slice(5));
    if (!r) return data;
    await editMsg(api, chatId, msgId, detail(r), editMenu(r));
    return data;
  }

  if (d.startsWith('del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== d.slice(4));
    await editMsg(api, chatId, msgId, 'Удалено', remMenu());
    return data;
  }

  if (d.startsWith('edittext:')) {
    data.sessions[sid(chatId)] = { step: 'edit_text', id: d.slice(9) };
    await api('sendMessage', { chat_id: chatId, text: PROMPT_EDIT });
    return data;
  }

  if (d.startsWith('edithours:')) {
    data.sessions[sid(chatId)] = { step: 'edit_hours', id: d.slice(10) };
    await editMsg(api, chatId, msgId, 'Интервал, часы', hoursKeyboard('sethour'));
    return data;
  }

  if (d.startsWith('edittime:')) {
    data.sessions[sid(chatId)] = { step: 'edit_time', id: d.slice(10) };
    await api('sendMessage', { chat_id: chatId, text: 'Время 21:23' });
    return data;
  }

  if (d === 'mode:daily' && w?.text && w.hour != null) {
    addDaily(data, chatId, w.text, w.hour, w.minute);
    return done(data, chatId, api);
  }

  if (d === 'mode:hours' && w?.text) {
    await editMsg(api, chatId, msgId, 'Интервал, часы', hoursKeyboard('hour'));
    return data;
  }

  if (d.startsWith('hour:') && w?.text) {
    addRepeat(data, chatId, w.text, parseInt(d.slice(5), 10));
    return done(data, chatId, api);
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
      await editMsg(api, chatId, msgId, 'Готово', remMenu());
    }
    return data;
  }

  return data;
}

async function openPanel(data, chatId, api) {
  const panel = data.panels[sid(chatId)];
  if (panel?.messageId) {
    const r = await api('editMessageText', {
      chat_id: chatId,
      message_id: panel.messageId,
      text: 'Напоминания',
      reply_markup: remMenu(),
    });
    if (r.ok) return data;
  }
  const r = await api('sendMessage', {
    chat_id: chatId,
    text: 'Напоминания',
    reply_markup: remMenu(),
  });
  if (r.ok) data.panels[sid(chatId)] = { messageId: r.result.message_id };
  return data;
}

async function handleMessage(data, msg, api) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const s = data.sessions[sid(chatId)];
  const w = getWait(data, chatId);

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

  if (s?.step === 'new_text') {
    data.pending[sid(chatId)] = { text, step: 'when' };
    delete data.sessions[sid(chatId)];
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Время\n21:23 — введите\nкнопка — каждые N ч',
      reply_markup: hoursKeyboard('hour'),
    });
    return data;
  }

  if (w?.step === 'when' && w.text) {
    const onceAt = parseMskTime(text);
    if (text.toLowerCase().includes('завтра') && onceAt) {
      addOnce(data, chatId, w.text, onceAt);
      return done(data, chatId, api);
    }

    const clock = parseClock(text);
    if (clock) {
      data.pending[sid(chatId)] = {
        text: w.text,
        step: 'mode',
        hour: clock.h,
        minute: clock.mi,
      };
      await api('sendMessage', {
        chat_id: chatId,
        text: clockStr(clock.h, clock.mi),
        reply_markup: modeKeyboard(clock.h, clock.mi),
      });
      return data;
    }

    await api('sendMessage', { chat_id: chatId, text: 'Формат: 21:23' });
    return data;
  }

  if (s?.step === 'edit_time' && s.id) {
    const clock = parseClock(text);
    if (!clock) {
      await api('sendMessage', { chat_id: chatId, text: 'Формат: 21:23' });
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
    return openPanel(data, chatId, api);
  }

  if (s?.step === 'edit_text' && s.id) {
    const r = data.reminders.find((x) => x.id === s.id);
    if (r) r.text = text;
    delete data.sessions[sid(chatId)];
    return openPanel(data, chatId, api);
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
    if (!json.ok) console.error('[tg]', method, json.description);
    return json;
  };
}

export function makeSend(api) {
  return (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, ...extra });
}
