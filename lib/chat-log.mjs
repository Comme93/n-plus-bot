import { sid } from './ui-state.mjs';

const MAX = 500;

export function ensureBotMsgs(data) {
  if (!data.botMsgs) data.botMsgs = {};
}

export function trackBotMsg(data, chatId, messageId) {
  if (!messageId) return;
  ensureBotMsgs(data);
  const k = sid(chatId);
  const list = data.botMsgs[k] || [];
  if (!list.includes(messageId)) list.push(messageId);
  data.botMsgs[k] = list.length > MAX ? list.slice(-MAX) : list;
}

export function botMsgIds(data, chatId) {
  return data.botMsgs?.[sid(chatId)] || [];
}

export function clearBotMsgs(data, chatId, keepId) {
  ensureBotMsgs(data);
  const k = sid(chatId);
  data.botMsgs[k] = keepId ? [keepId] : [];
}

export function mergeBotMsgs(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = [...new Set([...(out[k] || []), ...(v || [])])].slice(-MAX);
  }
  return out;
}
