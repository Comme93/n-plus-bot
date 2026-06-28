import { parseMskTime, formatMsk } from './time.mjs';

const PROMPT_NAME = 'Название';
const PROMPT_EDIT = 'Текст';
const PROMPT_TIME = 'Время МСК';

function whenKeyboard() {
  return {
    inline_keyboard: [
      [1, 2, 4, 6, 12, 24].map((h) => ({ text: String(h), callback_data: `hour:${h}` })),
    ],
  };
}

async function addOnce(data, chatId, text, at, api) {
  data.reminders.push({ id: rid(), chatId, text, type: 'once', at });
  clearWait(data, chatId);
  return done(data, chatId, api);
}

function clearWait(data, chatId) {
  delete data.sessions[sid(chatId)];
  if (data.pending) delete data.pending[sid(chatId)];
}

function getWait(data, chatId) {
  return data.pending?.[sid(chatId)] || data.sessions[sid(chatId)];
}

function hourKeyboard(prefix = 'hour') {
  return {
    inline_keyboard: [
      [1, 2, 4, 6, 12, 24].map((h) => ({ text: String(h), callback_data: `${prefix}:${h}` })),
    ],
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

function editMenu(r) {
  const isOnce = r.type === 'once' || r.at;
  return {
    inline_keyboard: [
      [
        { text: 'Текст', callback_data: `edittext:${r.id}` },
        { text: isOnce ? 'Время' : 'Часы', callback_data: isOnce ? `edittime:${r.id}` : `edithours:${r.id}` },
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
  if (r.type === 'once' || r.at) return `${r.text}, ${formatMsk(r.at)}`;
  return `${r.text}, ${r.hours}ч`;
}

function detail(r) {
  if (r.type === 'once' || r.at) return `${r.text}\n${formatMsk(r.at)}`;
  return `${r.text}\n${r.hours} ч`;
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

  await api('answerCallbackQuery', { callback_query_id: cb.id });

  if (d === 'rem:menu') {
    await editMsg(api, chatId, msgId, 'Напоминания', remMenu());
    return data;
  }

  if (d === 'rem:create') {
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
    await editMsg(api, chatId, msgId, 'Часы', hourKeyboard('sethour'));
    return data;
  }

  if (d.startsWith('edittime:')) {
    data.sessions[sid(chatId)] = { step: 'edit_time', id: d.slice(10) };
    await api('sendMessage', { chat_id: chatId, text: PROMPT_TIME });
    return data;
  }

  if (d.startsWith('hour:')) {
    const hours = parseInt(d.slice(5), 10);
    const w = getWait(data, chatId);
    if (w?.text) {
      data.reminders.push({
        id: rid(),
        chatId,
        text: w.text,
        type: 'repeat',
        hours,
        last: Date.now(),
      });
      clearWait(data, chatId);
      return done(data, chatId, api);
    }
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
        delete r.at;
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
      text: `Когда · ${text}\n20:30 — время, кнопка — часы`,
      reply_markup: whenKeyboard(),
    });
    return data;
  }

  const w = getWait(data, chatId);
  if (w?.text && (w.step === 'when' || s?.step === 'new_when')) {
    const at = parseMskTime(text);
    if (at) return addOnce(data, chatId, w.text, at, api);
    await api('sendMessage', { chat_id: chatId, text: '20:30 или завтра 20:30' });
    return data;
  }

  const reply = msg.reply_to_message?.text || '';
  if (reply.startsWith('Когда · ')) {
    const name = reply.split('\n')[0].replace('Когда · ', '');
    const at = parseMskTime(text);
    if (at) return addOnce(data, chatId, name, at, api);
  }

  if (s?.step === 'new_time' && s.text) {
    const at = parseMskTime(text);
    if (!at) {
      await api('sendMessage', { chat_id: chatId, text: '20:30 или завтра 20:30' });
      return data;
    }
    return addOnce(data, chatId, s.text, at, api);
  }

  if (msg.reply_to_message?.text === PROMPT_TIME && s?.text) {
    const at = parseMskTime(text);
    if (at) return addOnce(data, chatId, s.text, at, api);
  }

  if (s?.step === 'edit_time' && s.id) {
    const at = parseMskTime(text);
    if (!at) {
      await api('sendMessage', { chat_id: chatId, text: '20:30 или завтра 20:30' });
      return data;
    }
    const r = data.reminders.find((x) => x.id === s.id);
    if (r) {
      r.at = at;
      r.type = 'once';
      delete r.hours;
      delete r.last;
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
