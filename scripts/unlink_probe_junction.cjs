// Remove junction node_modules do probe SEM apagar o alvo, depois o worktree sai via git.
const fs = require('fs');
const link = 'C:/Yui/data/saas/solaris-mvp-probe/node_modules';
try { fs.unlinkSync(link); console.log('junction removida'); }
catch (e) { console.log('junction:', e.code); }
