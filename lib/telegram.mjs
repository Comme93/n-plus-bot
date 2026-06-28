const PROMPT_NAME = 'Название';
const PROMPT_EDIT = 'Текст';

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

function editMenu(id) {
  return {
    inline_keyboard: [
      [
        { text: 'Текст', callback_data: `edittext:${id}` },
        { text: 'Часы', callback_data: `edithours:${id}` },
      ],
      [{ text: 'Удалить', callback_data: `del:${id}` }],
      [{ text: 'Назад', callback_data: 'rem:list' }],
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

function sid(chatId) {
  return String(chatId);
}

export async function handleUpdate(data, update, api) {
  ensure(data);
  if (update.callback_query) return handleCallback(data, update.callback_query, api);
  if (update.message?.text) return handleMessage(data, update.message, api);
  return data;
}

async function handleCallback(data, cb, api) {
  const chatId = cb.message.chat.id;
  const d = cb.data;

  await api('answerCallbackQuery', { callback_query_id: cb.id });

  if (d === 'rem:menu') {
    await api('sendMessage', { chat_id: chatId, text: '—', reply_markup: remMenu() });
    return data;
  }

  if (d === 'rem:create') {
    await api('sendMessage', {
      chat_id: chatId,
      text: PROMPT_NAME,
      reply_markup: { force_reply: true, input_field_placeholder: 'купить наушники' },
    });
    return data;
  }

  if (d === 'rem:list') {
    const list = mine(data, chatId);
    if (!list.length) {
      await api('sendMessage', { chat_id: chatId, text: 'Пусто', reply_markup: remMenu() });
      return data;
    }
    const rows = list.map((r) => [
      { text: `${r.text}, ${r.hours}ч`, callback_data: `edit:${r.id}` },
    ]);
    rows.push([{ text: 'Назад', callback_data: 'rem:menu' }]);
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Список',
      reply_markup: { inline_keyboard: rows },
    });
    return data;
  }

  if (d.startsWith('edit:')) {
    const remId = d.slice(5);
    const r = data.reminders.find((x) => x.id === remId);
    if (!r) return data;
    await api('sendMessage', {
      chat_id: chatId,
      text: `${r.text}\n${r.hours} ч`,
      reply_markup: editMenu(remId),
    });
    return data;
  }

  if (d.startsWith('del:')) {
    data.reminders = data.reminders.filter((r) => r.id !== d.slice(4));
    await api('sendMessage', { chat_id: chatId, text: 'Удалено', reply_markup: remMenu() });
    return data;
  }

  if (d.startsWith('edittext:')) {
    await api('sendMessage', {
      chat_id: chatId,
      text: PROMPT_EDIT,
      reply_markup: { force_reply: true },
    });
    data.sessions[sid(chatId)] = { step: 'edit_text', id: d.slice(9) };
    return data;
  }

  if (d.startsWith('edithours:')) {
    data.sessions[sid(chatId)] = { step: 'edit_hours', id: d.slice(10) };
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Часы',
      reply_markup: hourKeyboard('sethour'),
    });
    return data;
  }

  if (d.startsWith('hour:')) {
    const hours = parseInt(d.slice(5), 10);
    const s = data.sessions[sid(chatId)];
    if (s?.step === 'new_hours' && s.text) {
      data.reminders.push({
        id: rid(),
        chatId,
        text: s.text,
        hours,
        last: Date.now(),
      });
      delete data.sessions[sid(chatId)];
      await api('sendMessage', { chat_id: chatId, text: 'Готово', reply_markup: remMenu() });
    }
    return data;
  }

  if (d.startsWith('sethour:')) {
    const hours = parseInt(d.slice(8), 10);
    const s = data.sessions[sid(chatId)];
    if (s?.step === 'edit_hours' && s.id) {
      const r = data.reminders.find((x) => x.id === s.id);
      if (r) r.hours = hours;
      delete data.sessions[sid(chatId)];
      await api('sendMessage', { chat_id: chatId, text: 'Готово', reply_markup: remMenu() });
    }
    return data;
  }

  return data;
}

async function handleMessage(data, msg, api) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const replyTo = msg.reply_to_message?.text;

  if (!data.users.includes(chatId)) data.users.push(chatId);

  if (replyTo === PROMPT_NAME) {
    data.sessions[sid(chatId)] = { step: 'new_hours', text };
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Часы',
      reply_markup: hourKeyboard('hour'),
    });
    return data;
  }

  if (replyTo === PROMPT_EDIT) {
    const s = data.sessions[sid(chatId)];
    if (s?.step === 'edit_text' && s.id) {
      const r = data.reminders.find((x) => x.id === s.id);
      if (r) r.text = text;
      delete data.sessions[sid(chatId)];
      await api('sendMessage', { chat_id: chatId, text: 'Готово', reply_markup: remMenu() });
    }
    return data;
  }

  if (text === '/start') {
    await api('sendMessage', {
      chat_id: chatId,
      text: '.',
      reply_markup: mainKeyboard(),
    });
    return data;
  }

  if (text === 'Напоминания') {
    await api('sendMessage', { chat_id: chatId, text: '—', reply_markup: remMenu() });
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
    if (!json.ok) console.error('[tg]', method, json.description);
    return json;
  };
}

export function makeSend(api) {
  return (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, ...extra });
}
