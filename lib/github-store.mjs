import { mergeDayStats, sanitizeStats } from './stats.mjs';
import { mergeUi } from './ui-state.mjs';
import { mergeDrafts } from './drafts.mjs';
import { mergeBotMsgs } from './chat-log.mjs';

const REPO = process.env.GITHUB_REPO || 'Comme93/n-plus-bot';
const FILE = 'data.json';

const DEFAULT = () => ({
  users: [],
  seen: [],
  reminders: [],
  ui: {},
  drafts: {},
  botMsgs: {},
  avitoStats: {},
  seeded: false,
  lastUpdateId: 0,
});

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function loadFromGitHub(token) {
  if (!token) return null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    headers: headers(token),
  });
  if (res.status === 404) return { data: DEFAULT(), sha: null };
  if (!res.ok) throw new Error(`GitHub load ${res.status}`);
  const json = await res.json();
  const raw = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
  return { data: normalize(raw), sha: json.sha };
}

function normalize(data) {
  if (!data.ui) {
    data.ui = {};
    for (const [k, v] of Object.entries(data.sessions || {})) {
      if (v.step === 'new_text') data.ui[k] = { step: 'name', panel: data.panels?.[k]?.messageId };
      else if (v.step === 'edit_text') data.ui[k] = { step: 'edit_name', editId: v.id, panel: data.panels?.[k]?.messageId };
      else if (v.step === 'edit_time') data.ui[k] = { step: 'edit_time', editId: v.id, panel: data.panels?.[k]?.messageId };
      else if (v.step === 'edit_hours') data.ui[k] = { step: 'edit_hours', editId: v.id, panel: data.panels?.[k]?.messageId };
    }
    for (const [k, v] of Object.entries(data.pending || {})) {
      const ui = data.ui[k] || { panel: data.panels?.[k]?.messageId };
      if (v.step === 'when') {
        ui.step = 'when';
        ui.draft = { text: v.text };
      } else if (v.step === 'mode') {
        ui.step = 'pick';
        ui.draft = { text: v.text, h: v.hour, mi: v.minute };
      }
      data.ui[k] = ui;
    }
    for (const [k, v] of Object.entries(data.panels || {})) {
      if (!data.ui[k]) data.ui[k] = {};
      if (v.messageId) data.ui[k].panel = v.messageId;
    }
  }
  delete data.sessions;
  delete data.pending;
  delete data.panels;
  if (!data.avitoStats) data.avitoStats = {};
  if (!data.drafts) data.drafts = {};
  if (!data.botMsgs) data.botMsgs = {};
  data.avitoStats = sanitizeStats(data.avitoStats);
  return data;
}

export function unionReminders(a, b) {
  const map = new Map();
  for (const r of a || []) map.set(r.id, { ...r });
  for (const r of b || []) {
    const prev = map.get(r.id);
    map.set(
      r.id,
      prev
        ? { ...prev, ...r, last: r.last ?? prev.last, lastDay: r.lastDay ?? prev.lastDay }
        : { ...r },
    );
  }
  return [...map.values()];
}

export function mergeRemindersForDaemon(freshList, workerList) {
  const workerById = new Map((workerList || []).map((r) => [r.id, r]));
  const now = Date.now();

  return (freshList || [])
    .filter((r) => {
      const once = r.type === 'once' || r.at;
      if (once && r.at <= now && !workerById.has(r.id)) return false;
      return true;
    })
    .map((r) => {
      const w = workerById.get(r.id);
      if (!w) return r;
      return { ...r, last: w.last, lastDay: w.lastDay };
    });
}

export function mergeState(incoming, fresh) {
  const inWin = (incoming.lastUpdateId || 0) >= (fresh.lastUpdateId || 0);
  const ui = inWin ? mergeUi(fresh.ui, incoming.ui) : mergeUi(incoming.ui, fresh.ui);
  const reminders = unionReminders(fresh.reminders, incoming.reminders);
  return {
    users: [...new Set([...(fresh.users || []), ...(incoming.users || [])])],
    seen: [...new Set([...(fresh.seen || []), ...(incoming.seen || [])])].slice(0, 500),
    seeded: incoming.seeded || fresh.seeded,
    reminders: mergeRemindersForDaemon(reminders, inWin ? incoming.reminders : fresh.reminders),
    ui,
    drafts: mergeDrafts(fresh.drafts, incoming.drafts),
    botMsgs: mergeBotMsgs(fresh.botMsgs, incoming.botMsgs),
    avitoStats: mergeDayStats(fresh.avitoStats, incoming.avitoStats),
    lastUpdateId: Math.max(fresh.lastUpdateId || 0, incoming.lastUpdateId || 0),
  };
}

export async function mergeBeforeSave(token, incoming) {
  const fresh = await loadFromGitHub(token);
  if (!fresh) return { data: incoming, sha: null };
  return { data: mergeState(incoming, fresh.data), sha: fresh.sha };
}

export async function mergeForDaemonSave(token, workerData) {
  const fresh = await loadFromGitHub(token);
  if (!fresh) return { data: workerData, sha: null };
  return {
    data: mergeState(workerData, fresh.data),
    sha: fresh.sha,
  };
}

export async function saveToGitHub(token, data, sha) {
  const body = {
    message: 'bot state',
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 409 && sha) {
      const fresh = await loadFromGitHub(token);
      return saveToGitHub(token, mergeState(data, fresh.data), fresh.sha);
    }
    throw new Error(`GitHub save ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.content?.sha ?? sha;
}

export async function loadState(token) {
  const remote = await loadFromGitHub(token);
  if (remote) return remote;
  const { load } = await import('./store.mjs');
  return { data: normalize(load()), sha: null };
}

export async function saveState(token, data, sha) {
  if (token) return saveToGitHub(token, data, sha);
  const { save } = await import('./store.mjs');
  save(data);
  return sha;
}
