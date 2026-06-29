import { handleUpdate, makeApi, registerBot } from '../lib/telegram.mjs';
import { loadState, saveState, mergeBeforeSave } from '../lib/github-store.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const token = process.env.BOT_TOKEN;
    if (token) await registerBot(makeApi(token)).catch(() => {});
    return res.status(200).send('ok');
  }
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.BOT_TOKEN;
  const gh = process.env.GITHUB_TOKEN;
  if (!token || !gh) return res.status(500).json({ error: 'config' });

  const api = makeApi(token);
  const update = req.body;

  try {
    for (let i = 0; i < 5; i++) {
      const { data: loaded, sha: loadedSha } = await loadState(gh);
      let data = loaded;
      let sha = loadedSha;

      if (data.lastUpdateId && update.update_id <= data.lastUpdateId) {
        return res.status(200).json({ ok: true, skip: true });
      }

      const prevId = data.lastUpdateId;
      data = await handleUpdate(data, update, api);
      data.lastUpdateId = update.update_id;

      const merged = await mergeBeforeSave(gh, data);
      data = merged.data;
      sha = merged.sha;

      try {
        sha = await saveState(gh, data, sha);
        break;
      } catch (e) {
        data.lastUpdateId = prevId;
        if (i === 4 || !String(e.message).includes('409')) throw e;
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok: true });
  }
}
