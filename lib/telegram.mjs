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
import { trackBotMsg, botMsgIds, clearBotMsgs } from './chat-log.mjs';
import { putDraft, patchDraft, takeDraft, getDraft } from './drafts.mjs';

const HOURS = [1, 2, 3, 4, 6, 12, 24];

function kb(rows, back) {
  const r = rows.map((row) => [...row]);
  if (back && !r.flat().some((b) => b.text === 'Назад')) {
    r.push([{ text: 'Назад', callback_data: back }]);
  }
  return { inline_keyboard: r };
}

const MENU = () =>
  kb(
    [
      [
        { text: 'Создать', callback_data: 'm:create' },
        { text: 'Список', callback_data: 'm:list' },
      ],
      [
        { text: 'Аналитика', callback_data: 'm:stats' },
        { text: 'Очистить', callback_data: 'm:clear' },
      ],
    ],
    null,
  );

function hoursRow(draftId, back = 'b:name') {
  return kb(
    [HOURS.map((h) => ({ text: String(h), callback_data: `hr:${draftId}:${h}` }))],
    back,
  );
}

function pickRow(h, mi, draftId, back = 'b:when') {
  const t = clockStr(h, mi);
  return kb(
    [
      [{ text: `Ежедневно ${t}`, callback_data: `pd:${draftId}` }],
      [{ text: `Сегодня ${t}`, callback_data: `pt:${draftId}` }],
    ],
    back,
  );
}

function editRow(r) {
  const timed = r.type === 'daily' || r.type === 'once' || r.at;
  return kb(
    [
      [
        { text: 'Текст', callback_data: `e:text:${r.id}` },
        { text: timed ? 'Время' : 'Часы', callback_data: timed ? `e:time:${r.id}` : `e:hours:${r.id}` },
      ],
      [{ text: 'Удалить', callback_data: `e:del:${r.id}` }],
    ],
    'm:list',
  );
}

function editHoursRow(editId) {
  return kb(
    [HOURS.map((h) => ({ text: String(h), callback_data: `s:${h}` }))],
    `e:open:${editId}`,
  );
}

function rid() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

function fixBack(data, chatId, draftId) {
  const draft = getDraft(data, draftId, chatId);
  if (draft?.h != null) return 'b:pick';
  return 'b:when';
}

function pastMsg(h, mi) {
  return `${clockStr(h, mi)}\nуже прошло\n\nвведите новое время`;
}

async function goFixTime(data, chatId, api, draftId, h, mi, pid, retry) {
  patchDraft(data, draftId, chatId, { h, mi });
  setUi(data, chatId, { step: 'fix_time', draftId, panel: pid, retry: retry || null });
  await show(data, chatId, api, pastMsg(h, mi), kb([], fixBack(data, chatId, draftId)), pid);
}

function sameChat(a, b) {
  return String(a) === String(b);
}

function healUi(data, chatId) {
  const ui = getUi(data, chatId);
  if (!ui?.step) return;
  if (['when', 'pick', 'fix_time'].includes(ui.step)) {
    if (!ui.draftId || !getDraft(data, ui.draftId, chatId)) clearUi(data, chatId);
  }
}

function mine(data, chatId) {
  const now = Date.now();
  return data.reminders.filter((r) => {
    if (!sameChat(r.chatId, chatId)) return false;
    if ((r.type === 'once' || r.at) && r.at <= now) return false;
    return true;
  });
}

function pruneFired(data) {
  const now = Date.now();
  data.reminders = data.reminders.filter((r) => {
    if ((r.type === 'once' || r.at) && r.at <= now) return false;
    return true;
  });
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
  if (r.type === 'daily') return `${r.text} · ${clockStr(r.hour, r.minute)} · ежедневно`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text} · ${clockStr(h, mi)} · сегодня`;
    }
    return `${r.text} · ${formatMsk(r.at)} · раз`;
  }
  return `${r.text} · каждые ${r.hours}ч`;
}

function body(r) {
  if (r.type === 'daily') {
    return `${r.text}\n${clockStr(r.hour, r.minute)} · ежедневно\nостаётся в списке`;
  }
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `${r.text}\n${clockStr(h, mi)} · сегодня\nпропадёт после срабатывания`;
    }
    return `${r.text}\n${formatMsk(r.at)} · раз`;
  }
  return `${r.text}\nкаждые ${r.hours} ч`;
}

function savedMsg(r) {
  if (!r) return 'Сохранено';
  if (r.type === 'daily') return `Сохранено\n${r.text} · ${clockStr(r.hour, r.minute)} · ежедневно`;
  if (r.type === 'once' || r.at) {
    if (isTodayMsk(r.at)) {
      const [h, mi] = clockFromTs(r.at);
      return `Сохранено\n${r.text} · ${clockStr(h, mi)} · сегодня`;
    }
  }
  if (r.type === 'repeat' || r.hours) return `Сохранено\n${r.text} · каждые ${r.hours}ч`;
  return 'Сохранено';
}

async function call(api, method, body) {
  const json = await api(method, body);
  return json;
}

function editOk(r) {
  return r.ok || r.description?.includes('message is not modified');
}

const TEXT_STEPS = new Set(['name', 'when', 'fix_time', 'edit_name', 'edit_time']);

async function reshowStep(data, chatId, api, ui, pid) {
  if (ui.step === 'pick' && ui.draftId) {
    const draft = getDraft(data, ui.draftId, chatId);
    if (!draft?.text || draft.h == null) {
      clearUi(data, chatId);
      await show(data, chatId, api, 'Напоминания', MENU(), pid);
      return;
    }
    await show(
      data,
      chatId,
      api,
      `${draft.text}\n${clockStr(draft.h, draft.mi)}`,
      pickRow(draft.h, draft.mi, ui.draftId),
      pid,
    );
    return;
  }
  if (ui.step === 'edit_hours' && ui.editId) {
    await show(data, chatId, api, 'Интервал', editHoursRow(ui.editId), pid);
    return;
  }
  clearUi(data, chatId);
  await show(data, chatId, api, 'Напоминания', MENU(), pid);
}

function isStart(text) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  return cmd === '/start' || cmd.startsWith('/start@');
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
      trackBotMsg(data, chatId, id);
      return id;
    }
  }
  const r = await call(api, 'sendMessage', { chat_id: chatId, text, reply_markup: markup });
  if (r.ok) {
    setPanel(data, chatId, r.result.message_id);
    trackBotMsg(data, chatId, r.result.message_id);
  }
  return r.ok ? r.result.message_id : null;
}

async function delMsg(api, chatId, messageId) {
  if (!messageId) return;
  await call(api, 'deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function purge(api, data, chatId, keepId) {
  if (!keepId) return;
  const tracked = botMsgIds(data, chatId).filter((id) => id !== keepId);
  const range = [];
  for (let id = keepId - 300; id < keepId; id++) {
    if (id > 0) range.push(id);
  }
  for (let id = keepId + 1; id <= keepId + 800; id++) {
    range.push(id);
  }
  const ids = [...new Set([...tracked, ...range])];
  await Promise.allSettled(ids.map((id) => delMsg(api, chatId, id)));
  clearBotMsgs(data, chatId, keepId);
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
  const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
  if (chatId) healUi(data, chatId);
  pruneFired(data);
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

  if (d === 'b:name') {
    clearUi(data, chatId);
    setUi(data, chatId, { step: 'name', panel: msgId });
    await show(data, chatId, api, 'Название', kb([], 'm:home'), msgId);
    return data;
  }

  if (d === 'b:when') {
    const draftId = getUi(data, chatId)?.draftId;
    const draft = draftId ? getDraft(data, draftId, chatId) : null;
    if (!draft?.text) {
      clearUi(data, chatId);
      await show(data, chatId, api, 'Напоминания', MENU(), msgId);
      return data;
    }
    setUi(data, chatId, { step: 'when', draftId, panel: msgId });
    await show(
      data,
      chatId,
      api,
      `${draft.text}\n\nВремя 21:23\nили интервал`,
      hoursRow(draftId, 'b:name'),
      msgId,
    );
    return data;
  }

  if (d === 'b:pick') {
    const draftId = getUi(data, chatId)?.draftId;
    const draft = draftId ? getDraft(data, draftId, chatId) : null;
    if (!draft?.text || draft.h == null) {
      if (!draft?.text) {
        clearUi(data, chatId);
        await show(data, chatId, api, 'Напоминания', MENU(), msgId);
        return data;
      }
      setUi(data, chatId, { step: 'when', draftId, panel: msgId });
      await show(
        data,
        chatId,
        api,
        `${draft.text}\n\nВремя 21:23\nили интервал`,
        hoursRow(draftId, 'b:name'),
        msgId,
      );
      return data;
    }
    setUi(data, chatId, { step: 'pick', draftId, panel: msgId });
    await show(
      data,
      chatId,
      api,
      `${draft.text}\n${clockStr(draft.h, draft.mi)}`,
      pickRow(draft.h, draft.mi, draftId, 'b:when'),
      msgId,
    );
    return data;
  }

  if (d === 'm:create') {
    setUi(data, chatId, { step: 'name', panel: msgId, draft: {} });
    await show(data, chatId, api, 'Название', kb([], 'm:home'), msgId);
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
    await show(data, chatId, api, reportMonth(data), statsKeyboard('m:stats'), msgId);
    return data;
  }

  if (d === 'm:stats:y') {
    await show(data, chatId, api, reportYear(data), statsKeyboard('m:stats'), msgId);
    return data;
  }

  if (d === 'm:stats:a') {
    await show(data, chatId, api, reportAll(data), statsKeyboard('m:stats'), msgId);
    return data;
  }

  if (d === 'm:clear') {
    await purge(api, data, chatId, msgId);
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
    const id = d.slice(6);
    data.reminders = data.reminders.filter((r) => r.id !== id);
    await show(data, chatId, api, 'Удалено', MENU(), msgId);
    return data;
  }

  if (d.startsWith('e:text:')) {
    const id = d.slice(7);
    setUi(data, chatId, { step: 'edit_name', editId: id, panel: msgId });
    await show(data, chatId, api, 'Новый текст', kb([], `e:open:${id}`), msgId);
    return data;
  }

  if (d.startsWith('e:time:')) {
    const id = d.slice(7);
    setUi(data, chatId, { step: 'edit_time', editId: id, panel: msgId });
    await show(data, chatId, api, 'Время 21:23', kb([], `e:open:${id}`), msgId);
    return data;
  }

  if (d.startsWith('e:hours:')) {
    const id = d.slice(8);
    setUi(data, chatId, { step: 'edit_hours', editId: id, panel: msgId });
    await show(data, chatId, api, 'Интервал', editHoursRow(id), msgId);
    return data;
  }

  if (d.startsWith('pd:')) {
    const draft = takeDraft(data, d.slice(3), chatId);
    if (!draft?.text || draft.h == null) {
      await show(data, chatId, api, 'Сессия истекла', MENU(), msgId);
      return data;
    }
    clearUi(data, chatId);
    addDaily(data, chatId, draft.text, draft.h, draft.mi);
    const created = data.reminders[data.reminders.length - 1];
    await show(data, chatId, api, savedMsg(created), MENU(), msgId);
    return data;
  }

  if (d.startsWith('pt:')) {
    const id = d.slice(3);
    const draft = getDraft(data, id, chatId);
    if (!draft?.text || draft.h == null) {
      await show(data, chatId, api, 'Сессия истекла', MENU(), msgId);
      return data;
    }
    const at = onceTodayAt(draft.h, draft.mi);
    if (!at) {
      await goFixTime(data, chatId, api, id, draft.h, draft.mi, msgId, 'today');
      return data;
    }
    takeDraft(data, id, chatId);
    clearUi(data, chatId);
    addOnce(data, chatId, draft.text, at);
    const created = data.reminders[data.reminders.length - 1];
    await show(data, chatId, api, savedMsg(created), MENU(), msgId);
    return data;
  }

  if (d.startsWith('hr:')) {
    const [, draftId, hours] = d.split(':');
    const draft = takeDraft(data, draftId, chatId);
    if (!draft?.text) {
      await show(data, chatId, api, 'Сессия истекла', MENU(), msgId);
      return data;
    }
    clearUi(data, chatId);
    addRepeat(data, chatId, draft.text, parseInt(hours, 10));
    const created = data.reminders[data.reminders.length - 1];
    await show(data, chatId, api, savedMsg(created) || 'Сохранено', MENU(), msgId);
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
  const pid = panelId(data, chatId) || ui?.panel;

  if (!data.users.includes(chatId)) data.users.push(chatId);

  if (isStart(text) || text === 'Напоминания') {
    await delMsg(api, chatId, msg.message_id);
    clearUi(data, chatId);
    await show(data, chatId, api, 'Напоминания', MENU(), null);
    return data;
  }

  if (!ui?.step) {
    await delMsg(api, chatId, msg.message_id);
    await show(data, chatId, api, 'Напоминания', MENU(), pid || null);
    return data;
  }

  if (!TEXT_STEPS.has(ui.step)) {
    await delMsg(api, chatId, msg.message_id);
    await reshowStep(data, chatId, api, ui, pid);
    return data;
  }

  await delMsg(api, chatId, msg.message_id);

  if (ui.step === 'name') {
    const draftId = putDraft(data, chatId, { text });
    setUi(data, chatId, { step: 'when', draftId, panel: pid });
    await show(
      data,
      chatId,
      api,
      `${text}\n\nВремя 21:23\nили интервал`,
      hoursRow(draftId),
      pid,
    );
    return data;
  }

  if (ui.step === 'when' && ui.draftId) {
    const clock = parseClock(text);
    if (!clock) {
      await show(data, chatId, api, 'Формат 21:23', hoursRow(ui.draftId), pid);
      return data;
    }
    if (!patchDraft(data, ui.draftId, chatId, { h: clock.h, mi: clock.mi })) {
      await show(data, chatId, api, 'Сессия истекла', MENU(), pid);
      return data;
    }
    const draft = data.drafts[ui.draftId];

    if (!onceTodayAt(clock.h, clock.mi)) {
      await goFixTime(data, chatId, api, ui.draftId, clock.h, clock.mi, pid);
      return data;
    }

    setUi(data, chatId, { step: 'pick', draftId: ui.draftId, panel: pid });
    await show(
      data,
      chatId,
      api,
      `${draft.text}\n${clockStr(clock.h, clock.mi)}`,
      pickRow(clock.h, clock.mi, ui.draftId),
      pid,
    );
    return data;
  }

  if (ui.step === 'fix_time' && ui.draftId) {
    const draft = getDraft(data, ui.draftId, chatId);
    if (!draft?.text) {
      await show(data, chatId, api, 'Сессия истекла', MENU(), pid);
      return data;
    }
    const clock = parseClock(text);
    if (!clock) {
      await show(data, chatId, api, `${pastMsg(draft.h, draft.mi)}\n\nформат 21:23`, kb([], fixBack(data, chatId, ui.draftId)), pid);
      return data;
    }
    patchDraft(data, ui.draftId, chatId, { h: clock.h, mi: clock.mi });

    if (ui.retry === 'today') {
      const at = onceTodayAt(clock.h, clock.mi);
      if (!at) {
        await goFixTime(data, chatId, api, ui.draftId, clock.h, clock.mi, pid, 'today');
        return data;
      }
      takeDraft(data, ui.draftId, chatId);
      clearUi(data, chatId);
      addOnce(data, chatId, draft.text, at);
      const created = data.reminders[data.reminders.length - 1];
      await show(data, chatId, api, savedMsg(created), MENU(), pid);
      return data;
    }

    setUi(data, chatId, { step: 'pick', draftId: ui.draftId, panel: pid });
    await show(
      data,
      chatId,
      api,
      `${draft.text}\n${clockStr(clock.h, clock.mi)}`,
      pickRow(clock.h, clock.mi, ui.draftId),
      pid,
    );
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
      await show(data, chatId, api, 'Формат 21:23', kb([], `e:open:${ui.editId}`), pid);
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

export function makeSend(api, data) {
  return async (chatId, text) => {
    const r = await api('sendMessage', { chat_id: chatId, text });
    if (r.ok && data) trackBotMsg(data, chatId, r.result.message_id);
    return r;
  };
}

export async function registerBot(api) {
  await api('setMyCommands', { commands: [{ command: 'start', description: 'Меню' }] });
  await api('setChatMenuButton', { menu_button: { type: 'commands' } });
}
