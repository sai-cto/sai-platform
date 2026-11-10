/**
 * The list of business modules. Adding a module = adding one import and one entry here.
 * See docs/MODULE_GUIDE.md.
 */
import type { ModuleManifest } from '@/core/modules/contract';
import { hhmcModule } from './hhmc/manifest';
import { sareModule } from './sare/manifest';
import { brssModule } from './brss/manifest';
import { cornModule } from './corn/manifest';
import { cfrModule } from './cfr/manifest';
import { tutModule } from './tut/manifest';
import { cbbModule } from './cbb/manifest';
import { brmModule } from './brm/manifest';
import { cpModule } from './cp/manifest';

export const MODULES: ModuleManifest[] = [
  hhmcModule,
  sareModule,
  brssModule,
  cornModule,
  cfrModule,
  tutModule,
  cbbModule,
  brmModule,
  cpModule,
];
