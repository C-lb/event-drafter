import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type DB = BetterSQLite3Database<typeof schema>;

let _db: DB | null = null;
let _sqlite: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.VIP_DB_PATH ?? resolve(process.cwd(), 'data/app.db');
}

export function getDb(): DB {
  if (_db) return _db;
  const path = getDbPath();
  mkdirSync(dirname(path), { recursive: true });
  _sqlite = new Database(path);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
