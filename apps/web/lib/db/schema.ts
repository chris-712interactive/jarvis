import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projectStatuses = ["active", "paused", "archived"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const jobStatuses = [
  "queued",
  "running",
  "needs_you",
  "done",
  "failed",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobKinds = ["code", "research", "ops", "message"] as const;
export type JobKind = (typeof jobKinds)[number];

export const interruptLevels = ["silent", "digest", "nudge", "interrupt"] as const;
export type InterruptLevel = (typeof interruptLevels)[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  goal: text("goal").notNull().default(""),
  status: text("status").$type<ProjectStatus>().notNull().default("active"),
  repoUrl: text("repo_url"),
  notes: text("notes").notNull().default(""),
  needsYou: text("needs_you"),
  interruptLevel: text("interrupt_level")
    .$type<InterruptLevel>()
    .notNull()
    .default("digest"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").$type<JobKind>().notNull().default("ops"),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  summary: text("summary").notNull().default(""),
  artifactUrl: text("artifact_url"),
  interruptLevel: text("interrupt_level")
    .$type<InterruptLevel>()
    .notNull()
    .default("digest"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
