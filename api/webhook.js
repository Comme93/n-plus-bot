import { handleUpdate, makeApi } from '../lib/telegram.mjs';
import { loadState, saveState } from '../lib/github-store.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('ok');

  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.BOT_TOKEN;
  const gh = process.env.GITHUB_TOKEN;
  if (!token || !gh) return res.status(500).json({ error: 'config' });

  try {
    const api = makeApi(token);
    let { data, sha } = await loadState(gh);
    data = await handleUpdate(data, req.body, api);
    sha = await saveState(gh, data, sha);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok: true });
  }
}
