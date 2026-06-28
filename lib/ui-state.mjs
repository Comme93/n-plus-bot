export function ensureUi(data) {
  if (!data.ui) data.ui = {};
  if (!data.users) data.users = [];
  if (!data.reminders) data.reminders = [];
  if (!data.avitoStats) data.avitoStats = {};
}

export function sid(chatId) {
  return String(chatId);
}

export function getUi(data, chatId) {
  return data.ui[sid(chatId)];
}

export function setUi(data, chatId, patch) {
  const k = sid(chatId);
  data.ui[k] = { ...(data.ui[k] || {}), ...patch };
}

export function clearUi(data, chatId) {
  delete data.ui[sid(chatId)];
}

export function panelId(data, chatId) {
  return data.ui[sid(chatId)]?.panel;
}

export function setPanel(data, chatId, messageId) {
  setUi(data, chatId, { panel: messageId });
}

export function mergeUi(base, overlay) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(overlay || {})) {
    if (v && typeof v === 'object') out[k] = { ...(out[k] || {}), ...v };
  }
  return out;
}
