import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb, closeDb } from './db.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(): void {
  const db = getDb();
  const migrationsFolder = resolve(__dirname, '../drizzle');
  migrate(db, { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runMigrations();
    console.log('migrations applied');
  } finally {
    closeDb();
  }
}
