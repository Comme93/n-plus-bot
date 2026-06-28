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

async function editMsg(api, chatId, messageId, text, reply_markup) {
  const r = await api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup,
  });
  if (!r.ok) {
    await api('sendMessage', { chat_id: chatId, text, reply_markup });
  }
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
    const rows = list.map((r) => [
      { text: `${r.text}, ${r.hours}ч`, callback_data: `edit:${r.id}` },
    ]);
    rows.push([{ text: 'Назад', callback_data: 'rem:menu' }]);
    await editMsg(api, chatId, msgId, 'Список', { inline_keyboard: rows });
    return data;
  }

  if (d.startsWith('edit:')) {
    const remId = d.slice(5);
    const r = data.reminders.find((x) => x.id === remId);
    if (!r) return data;
    await editMsg(api, chatId, msgId, `${r.text}\n${r.hours} ч`, editMenu(remId));
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
      const panel = data.panels[sid(chatId)];
      if (panel?.messageId) {
        await editMsg(api, chatId, panel.messageId, 'Готово', remMenu());
      } else {
        await api('sendMessage', { chat_id: chatId, text: 'Готово', reply_markup: remMenu() });
      }
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

  if (text === 'Напоминания') {
    return openPanel(data, chatId, api);
  }

  if (s?.step === 'new_text') {
    data.sessions[sid(chatId)] = { step: 'new_hours', text };
    await api('sendMessage', {
      chat_id: chatId,
      text: 'Часы',
      reply_markup: hourKeyboard('hour'),
    });
    return data;
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
