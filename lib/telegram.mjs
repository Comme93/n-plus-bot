function hourKeyboard(prefix = 'hour') {
  return {
    inline_keyboard: [
      [1, 2, 4, 6, 12, 24].map((h) => ({ text: `${h}ч`, callback_data: `${prefix}:${h}` })),
    ],
  };
}

function mainKeyboard() {
  return { keyboard: [[{ text: '⏰ Напоминания' }]], resize_keyboard: true };
}

function remMenu() {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать', callback_data: 'rem:create' }],
      [{ text: '📋 Мои', callback_data: 'rem:list' }],
    ],
  };
}

function editMenu(id) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Текст', callback_data: `edittext:${id}` },
        { text: '⏱ Часы', callback_data: `edithours:${id}` },
      ],
      [{ text: '🗑 Удалить', callback_data: `del:${id}` }],
      [{ text: '◀️ Назад', callback_data: 'rem:list' }],
    ],
  };
}

function ensure(data) {
  if (!data.sessions) data.sessions = {};
  if (!data.users) data.users = [];
  if (!data.reminders) data.reminders = [];
}

function mine(data, chatId) {
  return data.reminders.filter((r) => r.chatId === chatId);
}

function rid() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

export async function handleUpdate(data, update, api) {
  ensure(data);
  const cb = update.callback_query;
  const msg = update.message;

  if (cb) {
    return handleCallback(data, cb, api);
  }
  if (msg?.text) {
    return handleMessage(data, msg, api);
  }
  return data;
}

async function handleCallback(data, cb, api) {
  const chatId = cb.message.chat.id;
  const id = cb.id;
  const d = cb.data;

  await api('answerCallbackQuery', { callback_query_id: id });

  if (d === 'rem:menu' || d === 'rem:back') {
    await api('sendMessage', { chat_id: chatId, text: '⏰', reply_markup: remMenu() });
    return data;
  }

  if (d === 'rem:create') {
    data.sessions[chatId] = { step: 'new_text' };
    await api('sendMessage', { chat_id: chatId, text: 'Текст напоминания?' });
    return data;
  }

  if (d === 'rem:list') {
    const list = mine(data, chatId);
    if (!list.length) {
      await api('sendMessage', { chat_id: chatId, text: 'Пусто', reply_markup: remMenu() });
      return data;
    }
    const rows = list.flatMap((r) => [
      [{ text: `✏️ ${r.text} (${r.hours}ч)`, callback_data: `edit:${r.id}` }],
    ]);
    rows.push([{ text: '◀️', callback_data: 'rem:menu' }]);
    await api('sendMessage', { chat_id: chatId, text: '📋', reply_markup: { inline_keyboard: rows } });
    return data;
  }

  if (d.startsWith('edit:')) {
    const remId = d.slice(5);
    const r = data.reminders.find((x) => x.id === remId);
    if (!r) return data;
    await api('sendMessage', {
      chat_id: chatId,
      text: `${r.text}\n${r.hours}ч`,
      reply_markup: editMenu(remId),
    });
    return data;
  }

  if (d.startsWith('del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== d.slice(4));
    await api('sendMessage', { chat_id: chatId, text: '🗑', reply_markup: remMenu() });
    return data;
  }

  if (d.startsWith('edittext:')) {
    data.sessions[chatId] = { step: 'edit_text', id: d.slice(9) };
    await api('sendMessage', { chat_id: chatId, text: 'Новый текст?' });
    return data;
  }

  if (d.startsWith('edithours:')) {
    data.sessions[chatId] = { step: 'edit_hours', id: d.slice(10) };
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Новый интервал?',
      reply_markup: hourKeyboard('sethour'),
    });
    return data;
  }

  if (d.startsWith('hour:')) {
    const hours = parseInt(d.slice(5), 10);
    const s = data.sessions[chatId];
    if (s?.step === 'new_hours' && s.text) {
      data.reminders.push({
        id: rid(),
        chatId,
        text: s.text,
        hours,
        last: Date.now(),
      });
      delete data.sessions[chatId];
      await api('sendMessage', { chat_id: chatId, text: '✅', reply_markup: remMenu() });
    }
    return data;
  }

  if (d.startsWith('sethour:')) {
    const hours = parseInt(d.slice(8), 10);
    const s = data.sessions[chatId];
    if (s?.step === 'edit_hours' && s.id) {
      const r = data.reminders.find((x) => x.id === s.id);
      if (r) r.hours = hours;
      delete data.sessions[chatId];
      await api('sendMessage', { chat_id: chatId, text: '✅', reply_markup: remMenu() });
    }
    return data;
  }

  return data;
}

async function handleMessage(data, msg, api) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (!data.users.includes(chatId)) data.users.push(chatId);

  if (text === '/start') {
    await api('sendMessage', {
      chat_id: chatId,
      text: '\u200B',
      reply_markup: mainKeyboard(),
    });
    return data;
  }

  if (text === '⏰ Напоминания') {
    await api('sendMessage', { chat_id: chatId, text: '⏰', reply_markup: remMenu() });
    return data;
  }

  const s = data.sessions[chatId];
  if (s?.step === 'new_text') {
    data.sessions[chatId] = { step: 'new_hours', text };
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Каждые сколько часов?',
      reply_markup: hourKeyboard('hour'),
    });
    return data;
  }

  if (s?.step === 'edit_text' && s.id) {
    const r = data.reminders.find((x) => x.id === s.id);
    if (r) r.text = text;
    delete data.sessions[chatId];
    await api('sendMessage', { chat_id: chatId, text: '✅', reply_markup: remMenu() });
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
    return res.json();
  };
}

export function makeSend(api) {
  return (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, ...extra });
}
