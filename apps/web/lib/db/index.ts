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

function tableColumns(sqlite: Database.Database, table: string) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
}

function migrateSchema(sqlite: Database.Database) {
  const projectCols = tableColumns(sqlite, "projects");
  if (!projectCols.some((column) => column.name === "vault_path")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN vault_path TEXT`);
  }

  const jobCols = tableColumns(sqlite, "jobs");
  if (!jobCols.some((column) => column.name === "brief")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN brief TEXT NOT NULL DEFAULT ''`);
  }
  if (!jobCols.some((column) => column.name === "agent_id")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN agent_id TEXT`);
  }
  if (!jobCols.some((column) => column.name === "agent_run_id")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN agent_run_id TEXT`);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'digest',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications(read);
    CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);
  `);
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
      vault_path TEXT,
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
      brief TEXT NOT NULL DEFAULT '',
      artifact_url TEXT,
      agent_id TEXT,
      agent_run_id TEXT,
      interrupt_level TEXT NOT NULL DEFAULT 'digest',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'Command chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'digest',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs(project_id);
    CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
    CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
    CREATE INDEX IF NOT EXISTS conversations_project_id_idx ON conversations(project_id);
    CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications(read);
    CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);
  `);
  migrateSchema(sqlite);
  return sqlite;
}

function getSqlite() {
  if (!globalThis.__jarvisSqlite) {
    globalThis.__jarvisSqlite = createSqlite();
  } else {
    migrateSchema(globalThis.__jarvisSqlite);
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
