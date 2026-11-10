/**
 * PROVES the architecture lint rules really reject what they are meant to reject, in every
 * import form (alias, relative, with extension, dynamic). If someone loosens
 * eslint.config.mjs by accident, this fails.
 */
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function problems(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const FORBIDDEN_OUTSIDE_CORE = [
  `import { getDb } from '@/core/db/client';`,
  `import { getDb } from '../../core/db/client';`,
  `import { getDb } from '@/core/db/client.js';`,
  `import { getDb } from '@/core/db/./client';`,
  `import { txOf } from '@/core/db/scope';`,
  `import { txOf } from '../../core/db/scope';`,
  `import { txOf } from '../../core/db/scope.ts';`,
  `import { users } from '@/core/db/schema';`,
  `import { sessions } from '@/core/db/schema/platform';`,
  `import { sessions } from '../../core/db/schema/platform.js';`,
  `import { systemContext } from '@/core/tenancy/system';`,
  `import postgres from 'postgres';`,
  `const m = await import('@/core/db/schema/platform');`,
  `const m = await import('../../core/db/client');`,
  `const m = require('@/core/tenancy/system');`,
  `const m = await import('postgres');`,
  `const name = 'client'; const m = await import(\`@/core/db/\${name}\`);`,
  `import { getDb } from '@/core/tenancy/../db/client';`,
  `import { sessions } from '@/core/db/schema/./platform';`,
  `import { users } from '@/core/db/schema/';`,
];

// The last one is a folder that does not exist yet: anything new under src/ is covered by default.
describe.each(['src/modules/zz_probe/x.ts', 'src/app/zz_probe/x.ts', 'src/lib/zz_probe/x.ts'])('in %s', (file) => {
  it.each(FORBIDDEN_OUTSIDE_CORE)('rejects: %s', async (code) => {
    expect(await problems(file, `${code}\nexport {};\n`)).not.toEqual([]);
  });

  it('allows what modules and routes are meant to use', async () => {
    const allowed = [
      `import { withScope } from '@/core/db/scope';`,
      `import { customers } from '@/core/db/schema/tenant';`,
      `import { createRecord } from '@/core/records/records';`,
      `import { tenantTable, sameTenant } from '@/core/db/tenant-table';`,
    ].join('\n');
    expect(await problems(file, `${allowed}\nexport {};\n`)).toEqual([]);
  });
});

describe('modules and the core keep their distance', () => {
  it('a module cannot import a route', async () => {
    expect(await problems('src/modules/zz_probe/x.ts', `import { x } from '@/app/_lib/session';\nexport { x };\n`)).not.toEqual([]);
  });

  it.each([`import { x } from '@/modules/brss/manifest';`, `import { x } from '../modules/brss/manifest';`, `import { x } from '../modules/brss';`, `import { cookies } from 'next/headers';`, `import { x } from '@/app/_lib/session';`])(
    'the core rejects: %s',
    async (code) => {
      expect(await problems('src/core/zz_probe.ts', `${code}\nexport {};\n`)).not.toEqual([]);
    },
  );

  it('the core may import the registry list and its own modules folder', async () => {
    const allowed = [`import { MODULES } from '@/modules/registry';`, `import type { EntityDef } from '../modules/contract';`, `import { getModule } from '../modules/registry';`].join('\n');
    expect(await problems('src/core/audit/zz_probe.ts', `${allowed}\nexport {};\n`)).toEqual([]);
  });
});
