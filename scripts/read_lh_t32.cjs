const r1 = require('./lh-report-r1.json');
const r2 = require('./lh-report-r2.json');
for (const [n, r] of [['R1', r1], ['R2', r2]]) {
  const c = r.categories;
  console.log(
    n,
    'P' + Math.round(c.performance.score * 100),
    'A' + Math.round(c.accessibility.score * 100),
    'BP' + Math.round(c['best-practices'].score * 100)
  );
  const a = r.audits;
  console.log('  FCP', a['first-contentful-paint'].displayValue,
    '| LCP', a['largest-contentful-paint'].displayValue,
    '| CLS', a['cumulative-layout-shift'].displayValue,
    '| TBT', a['total-blocking-time'].displayValue);
}
