import { execSync } from 'child_process';

const ghToken = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

process.env.GH_TOKEN = ghToken;
execSync('gh workflow run bot.yml --repo Comme93/n-plus-bot', { stdio: 'inherit' });
