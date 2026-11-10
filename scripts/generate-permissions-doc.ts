/** Rewrites docs/PERMISSIONS.md from the permission matrix:  npm run docs:permissions */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/env';
import { renderPermissionsDoc } from './lib/permissions-doc';

fs.writeFileSync(path.join(ROOT, 'docs', 'PERMISSIONS.md'), renderPermissionsDoc());
console.log('Wrote docs/PERMISSIONS.md');
