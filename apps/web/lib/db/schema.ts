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
  vaultPath: text("vault_path"),
  needsYou: text("needs_you"),
  gaPropertyId: text("ga_property_id"),
  contentChannel: text("content_channel"),
  contentBrief: text("content_brief").notNull().default(""),
  dailyContent: integer("daily_content", { mode: "boolean" })
    .notNull()
    .default(false),
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
  brief: text("brief").notNull().default(""),
  artifactUrl: text("artifact_url"),
  agentId: text("agent_id"),
  agentRunId: text("agent_run_id"),
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

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default("Command chat"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system">().notNull(),
  content: text("content").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  level: text("level").$type<InterruptLevel>().notNull().default("digest"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type Notification = typeof notifications.$inferSelect;
