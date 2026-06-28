import { execSync } from 'child_process';
import { runBotCycle } from '../lib/core.mjs';
import { loadState, saveState } from '../lib/github-store.mjs';

const token = process.env.BOT_TOKEN;
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error('BOT_TOKEN missing');
  process.exit(1);
}

const RUN_MS = Number(process.env.DAEMON_MS || 5.4 * 3_600_000); // ~5.4 ч
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 15_000);

await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`)
  .then((r) => r.json())
  .then((j) => console.log('[webhook]', j.ok ? 'deleted' : j));

let { data, sha } = await loadState(ghToken);
const end = Date.now() + RUN_MS;
let saves = 0;

console.log('[daemon] start', new Date().toISOString(), 'users:', data.users.length);

while (Date.now() < end) {
  try {
    data = await runBotCycle(data, token);
    if (ghToken) {
      sha = await saveState(ghToken, data, sha);
      saves++;
    }
  } catch (e) {
    console.error('[tick]', e.message);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

console.log('[daemon] done, saves:', saves);

if (process.env.GITHUB_ACTIONS && ghToken) {
  execSync('gh workflow run "bot 24/7" --ref main', {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: ghToken },
  });
}
