const r = require(require('path').join(process.cwd(), 'lh-final.json'));
const a = r.audits;
console.log('--- unminified ---');
((a['unminified-javascript'].details || {}).items || []).forEach(i => console.log(i.url, i.wastedBytes));
console.log('--- unused top ---');
((a['unused-javascript'].details || {}).items || []).slice(0, 6).forEach(i => console.log(i.url, i.wastedBytes));
console.log('--- console errors ---');
(((a['errors-in-console'].details || {}).items) || []).forEach(i => console.log(JSON.stringify(i).slice(0, 400)));
