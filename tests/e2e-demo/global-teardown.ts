/**
 * Removes the production build the demo tests made. Left in place, it made the next
 * `next dev` (the main e2e suite) hit its memory threshold and restart mid-run.
 */
import fs from 'node:fs';
import path from 'node:path';

export default async function globalTeardown() {
  fs.rmSync(path.resolve(__dirname, '..', '..', '.next'), { recursive: true, force: true });
}
