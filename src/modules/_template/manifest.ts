/**
 * TEMPLATE — copy this folder to src/modules/<key>/ to start a module. See docs/MODULE_GUIDE.md.
 *
 * The manifest is the whole contract between a module and the platform. The console, Data
 * tab, permissions, test mode and dashboards are all driven by it.
 */
import { z } from 'zod';
import { defineModule } from '@/core/modules/contract';
import { createdCount, lastDays } from '@/core/analytics/analytics';
import { itemEntity } from './entities';
import { ItemsPage } from './pages/items-page';
import { P, permissions } from './permissions';
import { seedDemoData } from './seed';

export const templateModule = defineModule({
  // Must equal the slug of the business this module serves.
  key: 'template',
  name: 'Template module',
  version: '0.1.0',
  status: 'in_development', // 'scaffold' | 'in_development' | 'live'
  description: 'A minimal working module to copy from.',
  plannedScope: ['Items'],

  permissions,
  entities: [itemEntity], // every table, parents before children

  portals: {
    staff: {
      nav: [{ label: 'Items', path: '' }],
      routes: [{ path: '', title: 'Items', permission: P.itemsRead, component: ItemsPage }],
    },
    // customer: { nav: [...], routes: [...] },   // add when the module gets a customer portal
    // field:    { nav: [...], routes: [...] },   // add when the module gets a field portal
  },

  // Key numbers on the business's Overview tab.
  widgets: [
    {
      key: 'items-this-month',
      label: 'Items added · last 30 days',
      permission: P.itemsRead,
      load: async (s) => ({ value: String(await createdCount(s, itemEntity, lastDays(30))) }),
    },
  ],

  // The module's main unit of work, counted on the executive dashboard.
  workItem: { label: 'Items', entityKey: itemEntity.key },

  // Settings the tech team can change in the console's Settings tab.
  settings: {
    schema: z.object({ taxPercent: z.number().min(0).max(100) }),
    defaults: { taxPercent: 8 },
    fields: [
      { key: 'taxPercent', label: 'Tax (%)', type: 'number', help: 'Applied to every sale.' },
    ],
  },

  seedDemoData,
});
