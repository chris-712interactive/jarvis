import { z } from "zod";
import {
  interruptLevels,
  jobKinds,
  jobStatuses,
  projectStatuses,
} from "@/lib/db/schema";

const optionalUrl = z
  .union([z.string().url(), z.literal(""), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === "" || value === null) return null;
    return value;
  });

const optionalText = z
  .union([z.string(), z.literal(""), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === "" || value === null) return null;
    return value.trim();
  });

const optionalBool = z
  .union([
    z.boolean(),
    z.literal("true"),
    z.literal("false"),
    z.literal("1"),
    z.literal("0"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === "" || value === null) return false;
    if (value === true || value === "true" || value === "1") return true;
    return false;
  });

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(2000).optional().default(""),
  status: z.enum(projectStatuses).optional().default("active"),
  repoUrl: optionalUrl,
  notes: z.string().trim().max(8000).optional().default(""),
  vaultPath: optionalText,
  needsYou: optionalText,
  gaPropertyId: optionalText,
  contentChannel: optionalText,
  contentBrief: z.string().trim().max(4000).optional().default(""),
  dailyContent: optionalBool,
  interruptLevel: z.enum(interruptLevels).optional().default("digest"),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  name: z.string().trim().min(1).max(120).optional(),
});

export const createJobSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(jobKinds).optional().default("ops"),
  status: z.enum(jobStatuses).optional().default("queued"),
  summary: z.string().trim().max(2000).optional().default(""),
  brief: z.string().trim().max(8000).optional().default(""),
  artifactUrl: optionalUrl,
  interruptLevel: z.enum(interruptLevels).optional().default("digest"),
});

export const updateJobSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(jobKinds).optional(),
  status: z.enum(jobStatuses).optional(),
  summary: z.string().trim().max(2000).optional(),
  brief: z.string().trim().max(8000).optional(),
  artifactUrl: optionalUrl,
  interruptLevel: z.enum(interruptLevels).optional(),
});

export const updateNotificationSchema = z.object({
  read: z.boolean(),
});
