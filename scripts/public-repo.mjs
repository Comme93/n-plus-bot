import { execSync } from 'child_process';

const ghToken = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

const res = await fetch('https://api.github.com/repos/Comme93/n-plus-bot', {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ private: false }),
});

console.log('repo public:', res.status, await res.text());
