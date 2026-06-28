import { mergeDayStats } from './stats.mjs';

const REPO = process.env.GITHUB_REPO || 'Comme93/n-plus-bot';
const FILE = 'data.json';

const DEFAULT = () => ({
  users: [],
  seen: [],
  reminders: [],
  sessions: {},
  pending: {},
  panels: {},
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
  const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
  return { data, sha: json.sha };
}

function mergeRemindersFromWorker(freshList, workerList) {
  const workerById = new Map((workerList || []).map((r) => [r.id, r]));
  return (freshList || [])
    .filter((r) => workerById.has(r.id))
    .map((r) => {
      const w = workerById.get(r.id);
      return { ...r, last: w.last, lastDay: w.lastDay };
    });
}

export async function mergeForDaemonSave(token, workerData) {
  const fresh = await loadFromGitHub(token);
  if (!fresh) return { data: workerData, sha: null };

  return {
    data: {
      ...workerData,
      users: [...new Set([...(fresh.data.users || []), ...(workerData.users || [])])],
      sessions: fresh.data.sessions || {},
      pending: fresh.data.pending || {},
      panels: fresh.data.panels || {},
      reminders: mergeRemindersFromWorker(fresh.data.reminders, workerData.reminders),
      lastUpdateId: Math.max(fresh.data.lastUpdateId || 0, workerData.lastUpdateId || 0),
      avitoStats: mergeDayStats(fresh.data.avitoStats, workerData.avitoStats),
    },
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
      data = {
        ...fresh.data,
        ...data,
        users: [...new Set([...(fresh.data.users || []), ...(data.users || [])])],
        sessions: data.sessions ?? fresh.data.sessions,
        pending: data.pending ?? fresh.data.pending,
        panels: data.panels ?? fresh.data.panels,
        reminders: data.reminders ?? fresh.data.reminders,
        seen: data.seen?.length ? data.seen : fresh.data.seen,
        seeded: data.seeded ?? fresh.data.seeded,
        avitoStats: mergeDayStats(fresh.data.avitoStats, data.avitoStats),
        lastUpdateId: Math.max(fresh.data.lastUpdateId || 0, data.lastUpdateId || 0),
      };
      return saveToGitHub(token, data, fresh.sha);
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
  return { data: load(), sha: null };
}

export async function saveState(token, data, sha) {
  if (token) return saveToGitHub(token, data, sha);
  const { save } = await import('./store.mjs');
  save(data);
  return sha;
}
