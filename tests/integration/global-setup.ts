/** Runs once before the integration tests: a fresh, seeded TEST database. */
import { resetTestDatabase } from '../../scripts/reset-test-db';

export default async function globalSetup() {
  await resetTestDatabase();
}
