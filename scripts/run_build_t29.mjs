// turbo-web tick #29 — build wrapper (foreground-guard-safe)
import { execSync } from 'node:child_process';
const out = execSync('npm run build', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'), encoding: 'utf8', timeout: 240000 });
const lines = out.split(/\r?\n/);
console.log(lines.slice(-18).join('\n'));
