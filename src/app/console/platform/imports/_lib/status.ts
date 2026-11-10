import type { BadgeTone } from '@/ui/badge';

/** How each import status is shown. */
export const IMPORT_STATUS: Record<string, [string, BadgeTone]> = {
  uploaded: ['Uploaded', 'neutral'],
  dry_run_ok: ['Check passed', 'blue'],
  dry_run_failed: ['Check failed', 'red'],
  imported: ['Imported', 'green'],
  failed: ['Failed', 'red'],
};
