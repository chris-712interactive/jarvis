import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKDOWN_EXT = new Set([".md", ".markdown"]);
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const MAX_DEPTH = 8;
const MAX_FILES = 400;
const MAX_READ_BYTES = 200_000;
const MAX_SEARCH_HITS = 40;
const MAX_SEARCH_SNIPPET = 180;

export class VaultError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "VaultError";
    this.status = status;
  }
}

export type VaultNoteMeta = {
  path: string;
  title: string;
  bytes: number;
  updatedAt: string;
};

export type VaultNote = VaultNoteMeta & {
  content: string;
  truncated: boolean;
};

export type VaultSearchHit = {
  path: string;
  title: string;
  line: number;
  snippet: string;
};

export type VaultStatus = {
  configured: boolean;
  root: string | null;
  exists: boolean;
  readable: boolean;
  noteCount: number | null;
  error: string | null;
};

function expandHome(input: string) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/** Resolve a configured vault path to an absolute directory. */
export function resolveVaultRoot(vaultPath: string | null | undefined): string | null {
  if (!vaultPath?.trim()) return null;
  const expanded = expandHome(vaultPath.trim());
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  // Relative paths are resolved from the Next.js app cwd (apps/web).
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), expanded);
}

function assertInsideVault(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new VaultError("Path escapes vault root", 403);
  }
}

function isMarkdownFile(filePath: string) {
  return MARKDOWN_EXT.has(path.extname(filePath).toLowerCase());
}

function titleFromPath(relativePath: string) {
  const base = path.basename(relativePath, path.extname(relativePath));
  return base.replace(/[-_]+/g, " ").trim() || relativePath;
}

function ensureVaultDir(vaultPath: string | null | undefined): string {
  const root = resolveVaultRoot(vaultPath);
  if (!root) {
    throw new VaultError("No Obsidian vault path configured for this project", 400);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new VaultError(`Vault path not found: ${root}`, 404);
  }

  if (!stat.isDirectory()) {
    throw new VaultError("Vault path must be a directory", 400);
  }

  return root;
}

function walkMarkdown(
  root: string,
  dir: string,
  depth: number,
  out: VaultNoteMeta[],
) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const absolute = path.join(dir, entry.name);
    assertInsideVault(root, absolute);

    if (entry.isDirectory()) {
      walkMarkdown(root, absolute, depth + 1, out);
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(absolute)) continue;

    try {
      const stat = fs.statSync(absolute);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      out.push({
        path: relative,
        title: titleFromPath(relative),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable files
    }
  }
}

export function getVaultStatus(vaultPath: string | null | undefined): VaultStatus {
  const root = resolveVaultRoot(vaultPath);
  if (!root) {
    return {
      configured: false,
      root: null,
      exists: false,
      readable: false,
      noteCount: null,
      error: null,
    };
  }

  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      return {
        configured: true,
        root,
        exists: true,
        readable: false,
        noteCount: null,
        error: "Vault path must be a directory",
      };
    }
    const notes = listVaultNotes(vaultPath);
    return {
      configured: true,
      root,
      exists: true,
      readable: true,
      noteCount: notes.length,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      root,
      exists: false,
      readable: false,
      noteCount: null,
      error: error instanceof Error ? error.message : "Unable to read vault",
    };
  }
}

export function listVaultNotes(vaultPath: string | null | undefined): VaultNoteMeta[] {
  const root = ensureVaultDir(vaultPath);
  const notes: VaultNoteMeta[] = [];
  walkMarkdown(root, root, 0, notes);
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes;
}

export function readVaultNote(
  vaultPath: string | null | undefined,
  relativePath: string,
): VaultNote {
  const root = ensureVaultDir(vaultPath);
  const cleaned = relativePath.replace(/^[/\\]+/, "").trim();
  if (!cleaned) {
    throw new VaultError("Note path is required", 400);
  }

  const absolute = path.resolve(root, cleaned);
  assertInsideVault(root, absolute);

  if (!isMarkdownFile(absolute)) {
    throw new VaultError("Only markdown notes can be read", 400);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new VaultError("Note not found", 404);
  }

  if (!stat.isFile()) {
    throw new VaultError("Note not found", 404);
  }

  const buffer = fs.readFileSync(absolute);
  const truncated = buffer.byteLength > MAX_READ_BYTES;
  const content = buffer.subarray(0, MAX_READ_BYTES).toString("utf8");
  const relative = path.relative(root, absolute).split(path.sep).join("/");

  return {
    path: relative,
    title: titleFromPath(relative),
    bytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
    content,
    truncated,
  };
}

export function searchVaultNotes(
  vaultPath: string | null | undefined,
  query: string,
): VaultSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    throw new VaultError("Search query must be at least 2 characters", 400);
  }

  const notes = listVaultNotes(vaultPath);
  const hits: VaultSearchHit[] = [];

  for (const note of notes) {
    if (hits.length >= MAX_SEARCH_HITS) break;
    let content: string;
    try {
      content = readVaultNote(vaultPath, note.path).content;
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      const line = lines[i];
      const idx = line.toLowerCase().indexOf(q);
      if (idx === -1) continue;

      const start = Math.max(0, idx - 40);
      const end = Math.min(line.length, idx + q.length + 80);
      let snippet = line.slice(start, end).trim();
      if (snippet.length > MAX_SEARCH_SNIPPET) {
        snippet = `${snippet.slice(0, MAX_SEARCH_SNIPPET)}…`;
      }

      hits.push({
        path: note.path,
        title: note.title,
        line: i + 1,
        snippet,
      });
    }
  }

  return hits;
}

const MAX_WRITE_BYTES = 200_000;

function normalizeNoteRelativePath(relativePath: string) {
  const cleaned = relativePath.replace(/^[/\\]+/, "").trim().replace(/\\/g, "/");
  if (!cleaned) {
    throw new VaultError("Note path is required", 400);
  }
  if (cleaned.includes("..")) {
    throw new VaultError("Note path cannot contain ..", 400);
  }
  const withExt = MARKDOWN_EXT.has(path.extname(cleaned).toLowerCase())
    ? cleaned
    : `${cleaned}.md`;
  return withExt;
}

/**
 * Create or overwrite a markdown note inside a project vault.
 * Paths are sandboxed to the vault root.
 */
export function writeVaultNote(
  vaultPath: string | null | undefined,
  relativePath: string,
  content: string,
  options?: { overwrite?: boolean },
): VaultNote {
  const root = ensureVaultDir(vaultPath);
  const cleaned = normalizeNoteRelativePath(relativePath);
  const absolute = path.resolve(root, cleaned);
  assertInsideVault(root, absolute);

  if (!isMarkdownFile(absolute)) {
    throw new VaultError("Only markdown notes can be written", 400);
  }

  const overwrite = options?.overwrite !== false;
  if (!overwrite && fs.existsSync(absolute)) {
    throw new VaultError("Note already exists", 409);
  }

  const body = content ?? "";
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new VaultError(
      `Note exceeds ${MAX_WRITE_BYTES} byte write limit`,
      400,
    );
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body, "utf8");
  return readVaultNote(vaultPath, cleaned);
}

/** Build a safe relative path under Jarvis Jobs/ for async outputs. */
export function jobNotePath(title: string, at = new Date()) {
  const stamp = at.toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "job";
  return `Jarvis Jobs/${stamp}-${slug}.md`;
}

/** Weekly review note under Jarvis Jobs/reviews/ (hub rollup or per-lane). */
export function weeklyReviewNotePath(weekKey: string, slug?: string | null) {
  const safeWeek = weekKey.replace(/[^0-9W-]/gi, "").slice(0, 16) || "week";
  if (slug?.trim()) {
    const safeSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "lane";
    return `Jarvis Jobs/reviews/${safeWeek}-${safeSlug}.md`;
  }
  return `Jarvis Jobs/reviews/${safeWeek}.md`;
}

/** Rolling compacted memory note per lane (supersedes dumping job history into chat). */
export function compactedMemoryNotePath(slug?: string | null) {
  if (slug?.trim()) {
    const safeSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "lane";
    return `Memory/${safeSlug}/Current.md`;
  }
  return "Memory/Current.md";
}

/** Daily / channel content drafts under Content/<channel>/. */
export function contentNotePath(
  channel: string | null | undefined,
  title: string,
  at = new Date(),
) {
  const stamp = at.toISOString().slice(0, 10);
  const channelSlug =
    (channel ?? "general")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "general";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "post";
  return `Content/${channelSlug}/${stamp}-${slug}.md`;
}
