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

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(2000).optional().default(""),
  status: z.enum(projectStatuses).optional().default("active"),
  repoUrl: optionalUrl,
  notes: z.string().trim().max(8000).optional().default(""),
  needsYou: optionalText,
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
  artifactUrl: optionalUrl,
  interruptLevel: z.enum(interruptLevels).optional().default("digest"),
});
