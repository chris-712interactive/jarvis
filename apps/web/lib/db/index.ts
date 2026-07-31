import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import * as schema from "./schema";

const dataDir = path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const dbPath = process.env.JARVIS_DB_PATH ?? path.join(dataDir, "jarvis.db");

/**
 * Drizzle's node-sqlite driver calls StatementSync#setReturnArrays (Node 24+).
 * Polyfill on Node 22 so local/dev still works; Railway image uses Node 24.
 */
function patchNodeSqliteStatementApi() {
  const probe = new DatabaseSync(":memory:");
  try {
    const stmt = probe.prepare("select 1 as value");
    const proto = Object.getPrototypeOf(stmt) as {
      setReturnArrays?: (value: boolean) => unknown;
      all: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
    };
    if (typeof proto.setReturnArrays === "function") return;

    const mode = new WeakMap<object, boolean>();
    proto.setReturnArrays = function setReturnArrays(this: object, value: boolean) {
      mode.set(this, Boolean(value));
      return this;
    };

    const originalAll = proto.all;
    proto.all = function all(this: object, ...params: unknown[]) {
      const rows = originalAll.apply(this, params) as unknown;
      if (!mode.get(this) || !Array.isArray(rows)) return rows;
      return rows.map((row) =>
        row && typeof row === "object" ? Object.values(row as object) : row,
      );
    };

    const originalGet = proto.get;
    proto.get = function get(this: object, ...params: unknown[]) {
      const row = originalGet.apply(this, params) as unknown;
      if (!mode.get(this) || !row || typeof row !== "object") return row;
      return Object.values(row as object);
    };
  } finally {
    probe.close();
  }
}

patchNodeSqliteStatementApi();

function ensureDatabaseFile() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

declare global {
  // eslint-disable-next-line no-var
  var __jarvisSqlite: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __jarvisDb: ReturnType<typeof drizzle> | undefined;
}

function tableColumns(sqlite: DatabaseSync, table: string) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
}

function migrateSchema(sqlite: DatabaseSync) {
  const projectCols = tableColumns(sqlite, "projects");
  if (!projectCols.some((column) => column.name === "vault_path")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN vault_path TEXT`);
  }
  if (!projectCols.some((column) => column.name === "ga_property_id")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN ga_property_id TEXT`);
  }
  if (!projectCols.some((column) => column.name === "gsc_site_url")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN gsc_site_url TEXT`);
  }
  if (!projectCols.some((column) => column.name === "production_url")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN production_url TEXT`);
  }
  if (!projectCols.some((column) => column.name === "deploy_host")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN deploy_host TEXT`);
  }
  if (!projectCols.some((column) => column.name === "deploy_project_id")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN deploy_project_id TEXT`);
  }
  if (!projectCols.some((column) => column.name === "deploy_status")) {
    sqlite.exec(
      `ALTER TABLE projects ADD COLUMN deploy_status TEXT NOT NULL DEFAULT 'unknown'`,
    );
  }
  if (!projectCols.some((column) => column.name === "deploy_status_detail")) {
    sqlite.exec(
      `ALTER TABLE projects ADD COLUMN deploy_status_detail TEXT NOT NULL DEFAULT ''`,
    );
  }
  if (!projectCols.some((column) => column.name === "deploy_checked_at")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN deploy_checked_at INTEGER`);
  }
  if (!projectCols.some((column) => column.name === "content_channel")) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN content_channel TEXT`);
  }
  if (!projectCols.some((column) => column.name === "content_brief")) {
    sqlite.exec(
      `ALTER TABLE projects ADD COLUMN content_brief TEXT NOT NULL DEFAULT ''`,
    );
  }
  if (!projectCols.some((column) => column.name === "daily_content")) {
    sqlite.exec(
      `ALTER TABLE projects ADD COLUMN daily_content INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!projectCols.some((column) => column.name === "email_senders")) {
    sqlite.exec(
      `ALTER TABLE projects ADD COLUMN email_senders TEXT NOT NULL DEFAULT ''`,
    );
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
  if (!jobCols.some((column) => column.name === "email_message_id")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN email_message_id TEXT`);
  }
  if (!jobCols.some((column) => column.name === "email_thread_id")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN email_thread_id TEXT`);
  }
  if (!jobCols.some((column) => column.name === "email_from")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN email_from TEXT`);
  }
  if (!jobCols.some((column) => column.name === "email_subject")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN email_subject TEXT`);
  }
  if (!jobCols.some((column) => column.name === "email_reply_draft")) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN email_reply_draft TEXT`);
  }
  if (!jobCols.some((column) => column.name === "email_reply_sent")) {
    sqlite.exec(
      `ALTER TABLE jobs ADD COLUMN email_reply_sent INTEGER NOT NULL DEFAULT 0`,
    );
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
  // Node built-in SQLite — no native addon (avoids better-sqlite3 segfaults on Railway).
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
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
      ga_property_id TEXT,
      gsc_site_url TEXT,
      production_url TEXT,
      deploy_host TEXT,
      deploy_project_id TEXT,
      deploy_status TEXT NOT NULL DEFAULT 'unknown',
      deploy_status_detail TEXT NOT NULL DEFAULT '',
      deploy_checked_at INTEGER,
      content_channel TEXT,
      content_brief TEXT NOT NULL DEFAULT '',
      daily_content INTEGER NOT NULL DEFAULT 0,
      email_senders TEXT NOT NULL DEFAULT '',
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
      email_message_id TEXT,
      email_thread_id TEXT,
      email_from TEXT,
      email_subject TEXT,
      email_reply_draft TEXT,
      email_reply_sent INTEGER NOT NULL DEFAULT 0,
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
    globalThis.__jarvisDb = drizzle({ client: getSqlite() });
  }
  return globalThis.__jarvisDb;
}

export { schema };
