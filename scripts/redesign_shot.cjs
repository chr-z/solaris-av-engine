// Captura headless (--disable-gpu) das telas pro comparativo MVP vs v3.
const { execFile } = require('child_process');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const BASE = 'http://localhost:4173';

const shots = [
  { name: 'r1_tokens_login', url: `${BASE}/#/login` },
  { name: 'r1_tokens_workspace', url: `${BASE}/#/analise` },
];

let done = 0;
for (const s of shots) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--window-size=1600,900',
    '--hide-scrollbars',
    '--virtual-time-budget=8000',
    `--screenshot=${path.join(OUT, `${s.name}.png`)}`,
    s.url,
  ];
  execFile(CHROME, args, (err, _so, se) => {
    console.log(s.name, err ? `ERRO: ${se.split('\n')[0]}` : 'ok');
    if (++done === shots.length) process.exit(0);
  });
}
