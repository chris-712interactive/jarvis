import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const dataDir = path.join(process.cwd(), "data");
const dbPath = process.env.JARVIS_DB_PATH ?? path.join(dataDir, "jarvis.db");

function ensureDatabaseFile() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

declare global {
  var __jarvisSqlite: Database.Database | undefined;
  var __jarvisDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function createSqlite() {
  ensureDatabaseFile();
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      goal TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      repo_url TEXT,
      notes TEXT NOT NULL DEFAULT '',
      needs_you TEXT,
      interrupt_level TEXT NOT NULL DEFAULT 'digest',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'ops',
      status TEXT NOT NULL DEFAULT 'queued',
      summary TEXT NOT NULL DEFAULT '',
      artifact_url TEXT,
      interrupt_level TEXT NOT NULL DEFAULT 'digest',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs(project_id);
    CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
    CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
  `);
  return sqlite;
}

function getSqlite() {
  if (!globalThis.__jarvisSqlite) {
    globalThis.__jarvisSqlite = createSqlite();
  }
  return globalThis.__jarvisSqlite;
}

export function getDb() {
  if (!globalThis.__jarvisDb) {
    globalThis.__jarvisDb = drizzle(getSqlite(), { schema });
  }
  return globalThis.__jarvisDb;
}

export { schema };
