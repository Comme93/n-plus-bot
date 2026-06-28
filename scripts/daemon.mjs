import { execSync } from 'child_process';
import { handleUpdate, makeApi } from '../lib/telegram.mjs';
import { runWorker } from '../lib/worker.mjs';
import { loadState, saveState } from '../lib/github-store.mjs';

const token = process.env.BOT_TOKEN;
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token || !ghToken) {
  console.error('BOT_TOKEN or GITHUB_TOKEN missing');
  process.exit(1);
}

const RUN_MS = Number(process.env.DAEMON_MS || 5.4 * 3_600_000);
const TICK_MS = 2000;

const wh = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).then((r) => r.json());
console.log('[webhook] off', wh.ok);

const api = makeApi(token);
let { data, sha } = await loadState(ghToken);
const end = Date.now() + RUN_MS;
let n = 0;

console.log('[bot] start', data.users?.length, 'users');

while (Date.now() < end) {
  try {
    const updates = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${data.updateOffset || 0}&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`
    ).then((r) => r.json());

    if (updates.ok && updates.result?.length) {
      for (const u of updates.result) {
        data = await handleUpdate(data, u, api);
        data.updateOffset = u.update_id + 1;
      }
      sha = await saveState(ghToken, data, sha);
    }

    if (n % 3 === 0) {
      data = await runWorker(data, token);
      sha = await saveState(ghToken, data, sha);
    }
  } catch (e) {
    console.error('[tick]', e.message);
  }

  n++;
  await new Promise((r) => setTimeout(r, TICK_MS));
}

console.log('[bot] done');

if (process.env.GITHUB_ACTIONS) {
  execSync('gh workflow run "bot 24/7" --ref main', {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: ghToken },
  });
}
