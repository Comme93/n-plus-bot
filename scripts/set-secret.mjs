import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const botToken = readFileSync('.env', 'utf8').match(/^BOT_TOKEN=(.+)$/m)?.[1]?.trim();
const ghToken = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

process.env.GH_TOKEN = ghToken;
execSync(`gh secret set BOT_TOKEN --body "${botToken}" --repo Comme93/n-plus-bot`, {
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: ghToken },
});
