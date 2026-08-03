import { generateText } from "ai";
import { nanoid } from "nanoid";

import { isVisualContentChannel } from "@/lib/content/channels";
import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import {
  generatePostImage,
  isImageGenConfigured,
  OpenAiImageError,
} from "@/lib/openai/images";
import type { Job, JobKind, Project } from "@/lib/db/schema";
import {
  contentMediaPathFromNote,
  contentNotePath,
  VaultError,
  writeVaultBinary,
  writeVaultNote,
} from "@/lib/vault/notes";

export type ContentPackResult =
  | {
      ok: true;
      path: string;
      title: string;
      mediaPath: string | null;
      contentCaption: string | null;
      mediaToken: string | null;
    }
  | { ok: false; reason: string };

function extractSection(markdown: string, heading: string): string | null {
  const pattern = new RegExp(
    `##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const match = markdown.match(pattern);
  if (!match) return null;
  return match[1].trim() || null;
}

function stubMessageMarkdown(job: Job, project: Project) {
  const channel = project.contentChannel?.trim() || "content";
  return [
    `# ${job.title}`,
    "",
    `> Lane: **${project.name}** · Channel: **${channel}** · Job \`${job.id}\``,
    "",
    "## Ready to post",
    "",
    job.brief.trim() || "(no brief — set OPENAI_API_KEY for a drafted post)",
    "",
    "## Image direction",
    "",
    "(set OPENAI_API_KEY to generate a visual)",
    "",
    "## Checklist",
    "",
    "- [ ] Copy caption + image into the channel",
    "- [ ] Post",
    "- [ ] Approve/Resolve this job in Jarvis",
    "",
    "---",
    `_Drafted by Jarvis · ${new Date().toISOString()}_`,
    "",
  ].join("\n");
}

function buildMessagePrompt(job: Job, project: Project, visual: boolean) {
  const channel = project.contentChannel?.trim() || "community";
  const lines = [
    `You are drafting a ready-to-publish ${channel} post for lane "${project.name}".`,
    project.goal?.trim() ? `Lane goal: ${project.goal.trim()}` : null,
    project.contentBrief?.trim()
      ? `Standing content brief:\n${project.contentBrief.trim()}`
      : null,
    `Job title: ${job.title}`,
    `Operator brief:`,
    job.brief.trim() || job.title,
    "",
    "Requirements:",
    "- Start with a single # heading (post title)",
    "- Then a ## Ready to post section containing the exact caption/copy to paste into the channel",
    "- Keep the post concise and on-brand; no hashtag spam (3–8 relevant hashtags max if useful)",
    "- Do not invent metrics, quotes, or external facts",
  ];

  if (visual) {
    lines.push(
      "- Then a ## Image direction section: one vivid visual brief for a square Instagram feed image (subject, lighting, composition, mood). No logos, no watermarks, no unreadable text overlays, no real celebrity likenesses.",
      "- End with a short ## Checklist (copy caption+image, post, approve in Jarvis)",
    );
  } else {
    lines.push(
      "- End with a short ## Checklist (copy, post, approve in Jarvis)",
    );
  }

  lines.push("- Output markdown only");
  return lines.filter(Boolean).join("\n");
}

async function draftMessageBody(job: Job, project: Project, visual: boolean) {
  if (!isChatConfigured()) {
    return stubMessageMarkdown(job, project);
  }

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.7,
      prompt: buildMessagePrompt(job, project, visual),
    });
    const body = text.trim();
    if (!body) return stubMessageMarkdown(job, project);
    return body;
  } catch (error) {
    console.error("[content-pack] draft generation failed", error);
    return stubMessageMarkdown(job, project);
  }
}

/**
 * Write a message-job content pack (markdown note + optional generated image).
 */
export async function writeMessageContentPack(
  job: Job,
  project: Project,
): Promise<ContentPackResult> {
  if (!project.vaultPath) {
    return {
      ok: false,
      reason: `Project "${project.name}" has no vault path configured.`,
    };
  }

  const channel = project.contentChannel?.trim() || "channel";
  const visual = isVisualContentChannel(channel);
  const notePath = contentNotePath(channel, job.title);
  const mediaPath = visual ? contentMediaPathFromNote(notePath) : null;

  try {
    let body = await draftMessageBody(job, project, visual);
    const caption =
      extractSection(body, "Ready to post") ||
      extractSection(body, "Caption") ||
      null;

    let wroteMedia: string | null = null;
    let mediaToken: string | null = null;
    let imageNote = "";

    if (visual && mediaPath && isImageGenConfigured()) {
      const direction =
        extractSection(body, "Image direction") ||
        extractSection(body, "Visual") ||
        caption ||
        job.title;
      const imagePrompt = [
        `Create a polished square social media image for an Instagram feed post.`,
        `Brand / lane: ${project.name}.`,
        project.goal?.trim() ? `Goal context: ${project.goal.trim()}` : null,
        `Visual direction: ${direction}`,
        `Style: clean, high-quality, scroll-stopping, no watermarks, minimal or no text in the image.`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const image = await generatePostImage({ prompt: imagePrompt });
        const written = writeVaultBinary(project.vaultPath, mediaPath, image.bytes, {
          overwrite: true,
        });
        wroteMedia = written.path;
        mediaToken = nanoid(24);
        const fileName = written.path.split("/").pop() || "post.png";
        imageNote = [
          "",
          "## Visual",
          "",
          `![Post visual](${fileName})`,
          "",
          `_Generated with ${image.model}. Open this note in Obsidian (same folder) to copy the image + caption together._`,
        ].join("\n");
      } catch (error) {
        const message =
          error instanceof OpenAiImageError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Image generation failed";
        console.error("[content-pack] image generation failed", error);
        imageNote = [
          "",
          "## Visual",
          "",
          `_Image generation failed: ${message}. Caption is still ready to copy._`,
        ].join("\n");
      }
    } else if (visual) {
      imageNote = [
        "",
        "## Visual",
        "",
        "_No image generated (set OPENAI_API_KEY to enable)._",
      ].join("\n");
    }

    if (imageNote && !/##\s+Visual\b/i.test(body)) {
      // Insert visual before checklist when possible.
      if (/##\s+Checklist\b/i.test(body)) {
        body = body.replace(/##\s+Checklist\b/i, `${imageNote.trim()}\n\n## Checklist`);
      } else {
        body = `${body.trim()}\n\n${imageNote.trim()}\n`;
      }
    }

    const stamped = `${body.trim()}\n\n---\n_Written by Jarvis job runner (chat model${wroteMedia ? " + image" : ""}) · ${new Date().toISOString()}_\n`;
    const note = writeVaultNote(project.vaultPath, notePath, stamped, {
      overwrite: true,
    });

    return {
      ok: true,
      path: note.path,
      title: note.title,
      mediaPath: wroteMedia,
      contentCaption: caption,
      mediaToken: wroteMedia ? mediaToken : null,
    };
  } catch (error) {
    const message =
      error instanceof VaultError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Vault write failed";
    return { ok: false, reason: message };
  }
}

export function isMessageJob(job: Pick<Job, "kind">) {
  return (job.kind as JobKind) === "message";
}
