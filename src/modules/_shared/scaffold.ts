import { defineModule, type ModuleManifest } from '@/core/modules/contract';
import { NotBuiltYet } from './not-built-yet';

/**
 * A module that is registered but not built yet. It has no tables, permissions or screens of
 * its own; its staff portal is one page saying what is planned. When the real module is
 * built, replace the scaffoldModule() call in its manifest with a full defineModule().
 */
export function scaffoldModule(input: {
  key: string;
  name: string;
  description: string;
  plannedScope: string[];
}): ModuleManifest {
  return defineModule({
    key: input.key,
    name: input.name,
    version: '0.0.0',
    status: 'scaffold',
    description: input.description,
    plannedScope: input.plannedScope,
    permissions: [],
    entities: [],
    portals: {
      staff: {
        nav: [],
        routes: [
          {
            path: '',
            title: 'Not built yet',
            permission: 'business.app.use',
            component: NotBuiltYet,
          },
        ],
      },
    },
    widgets: [],
  });
}
