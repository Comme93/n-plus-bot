export function ensureDrafts(data) {
  if (!data.drafts) data.drafts = {};
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function putDraft(data, chatId, fields) {
  ensureDrafts(data);
  const id = newId();
  data.drafts[id] = { ...fields, chatId, at: Date.now() };
  pruneDrafts(data);
  return id;
}

function sameChat(a, b) {
  return String(a) === String(b);
}

export function getDraft(data, id, chatId) {
  const d = data.drafts?.[id];
  if (!d || !sameChat(d.chatId, chatId)) return null;
  return d;
}

export function takeDraft(data, id, chatId) {
  const d = getDraft(data, id, chatId);
  if (d) delete data.drafts[id];
  return d;
}

export function patchDraft(data, id, chatId, fields) {
  const d = getDraft(data, id, chatId);
  if (!d) return false;
  Object.assign(d, fields);
  return true;
}

function pruneDrafts(data) {
  const cut = Date.now() - 3_600_000;
  for (const [k, v] of Object.entries(data.drafts)) {
    if (v.at < cut) delete data.drafts[k];
  }
}

export function mergeDrafts(base, overlay) {
  return { ...(base || {}), ...(overlay || {}) };
}
