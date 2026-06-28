import { execSync } from 'child_process';
import { runWorker } from '../lib/worker.mjs';
import { loadState, saveState, mergeEphemeral } from '../lib/github-store.mjs';

const token = process.env.BOT_TOKEN;
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token || !ghToken) process.exit(1);

const RUN_MS = Number(process.env.DAEMON_MS || 5.4 * 3_600_000);

const end = Date.now() + RUN_MS;
console.log('[avito] start');

while (Date.now() < end) {
  try {
    let { data, sha } = await loadState(ghToken);
    data = await runWorker(data, token);
    const merged = await mergeEphemeral(ghToken, data);
    data = merged.data;
    if (merged.sha) sha = merged.sha;
    sha = await saveState(ghToken, data, sha);
  } catch (e) {
    console.error('[avito]', e.message);
  }
  await new Promise((r) => setTimeout(r, 5000));
}

if (process.env.GITHUB_ACTIONS) {
  execSync('gh workflow run "bot 24/7" --ref main', {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: ghToken },
  });
}
