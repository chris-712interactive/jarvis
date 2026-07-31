import type { JobKind, Project } from "@/lib/db/schema";
import {
  getSearchConsoleSummary,
  isGscConfigured,
  type GscSiteSummary,
} from "@/lib/analytics/gsc";

/**
 * Heuristics for chat → start_job kind selection.
 * Chat has no email-style classifier; these guards stop "implement SEO"
 * from becoming research/ops vault notes or docs-only Cloud Agent PRs.
 */

const CODE_INTENT_RE =
  /\b(implement|ship|fix|build|update|improve|optimize|optimise|add|change|refactor|pr\b|pull request|deploy|patch|hotfix|landing page|meta(?:data)?|sitemap|robots\.txt|structured data|schema\.org|open graph|canonical|seo updates?|on-?page)\b/i;

const SEO_INTENT_RE =
  /\b(seo|search console|gsc|rankings?|serp|ctr|impressions?|queries?|index(?:ing|ed)?|sitemap|meta(?:data)?|canonical|structured data)\b/i;

const DOCS_ONLY_RE =
  /\b(docs?\s+only|documentation\s+only|write\s+(a\s+)?(plan|note|markdown)|obsidian\s+note|planning\s+doc)\b/i;

export function looksLikeCodeIntent(text: string) {
  return CODE_INTENT_RE.test(text);
}

export function looksLikeSeoIntent(text: string) {
  return SEO_INTENT_RE.test(text);
}

export function looksLikeDocsOnlyIntent(text: string) {
  return DOCS_ONLY_RE.test(text);
}

/**
 * Coerce research/ops (or omitted kind) → code when the brief is clearly an
 * implementation mission. Explicit `message` stays message. Explicit docs-only
 * wording is left alone.
 */
export function resolveJobKind(input: {
  kind?: JobKind | null;
  title: string;
  brief: string;
}): { kind: JobKind; coerced: boolean; reason: string | null } {
  const requested = input.kind ?? "ops";
  const blob = `${input.title}\n${input.brief}`;

  if (requested === "message" || requested === "code") {
    return { kind: requested, coerced: false, reason: null };
  }

  if (looksLikeDocsOnlyIntent(blob)) {
    return { kind: requested, coerced: false, reason: null };
  }

  const wantsCode = looksLikeCodeIntent(blob);
  const wantsSeo = looksLikeSeoIntent(blob);

  // "plan and implement SEO" / "SEO updates" → code, not vault markdown.
  if (wantsCode || (wantsSeo && /\b(plan and|then |based on|using )\b/i.test(blob))) {
    return {
      kind: "code",
      coerced: true,
      reason: wantsSeo
        ? "SEO implementation requests run as code jobs (Cloud Agent PR), not research notes."
        : "Implementation language detected — coercing kind to code.",
    };
  }

  // Pure SEO analysis without implement language stays research/ops.
  return { kind: requested, coerced: false, reason: null };
}

function fmtPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function summarizeGscForBrief(summary: GscSiteSummary) {
  const lines: string[] = [
    `Search Console window: ${summary.startDate} → ${summary.endDate} (${summary.rangeDays}d, site ${summary.siteUrl})`,
    `Totals: clicks ${summary.current.clicks} (${fmtPct(summary.deltas.clicksPct)} vs prior), impressions ${summary.current.impressions} (${fmtPct(summary.deltas.impressionsPct)}), CTR ${(summary.current.ctr * 100).toFixed(2)}%, avg position ${summary.current.position.toFixed(1)}`,
  ];

  if (summary.risingQueries.length) {
    lines.push(
      "Rising queries:",
      ...summary.risingQueries.slice(0, 6).map(
        (q) =>
          `- "${q.query}" clicks=${q.clicks} pos=${q.position.toFixed(1)} ctr=${(q.ctr * 100).toFixed(1)}%`,
      ),
    );
  }
  if (summary.decliningQueries.length) {
    lines.push(
      "Declining queries:",
      ...summary.decliningQueries.slice(0, 6).map(
        (q) =>
          `- "${q.query}" clicks=${q.clicks} Δclicks=${q.clicksDelta} pos=${q.position.toFixed(1)}`,
      ),
    );
  }
  if (summary.topPages.length) {
    lines.push(
      "Top pages:",
      ...summary.topPages.slice(0, 8).map(
        (p) =>
          `- ${p.page} clicks=${p.clicks} pos=${p.position.toFixed(1)} ctr=${(p.ctr * 100).toFixed(1)}%`,
      ),
    );
  }
  if (summary.topQueries.length) {
    lines.push(
      "Top queries:",
      ...summary.topQueries.slice(0, 8).map(
        (q) =>
          `- "${q.query}" clicks=${q.clicks} pos=${q.position.toFixed(1)} ctr=${(q.ctr * 100).toFixed(1)}%`,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * When a code job looks SEO-related and the lane has GSC configured, append
 * live Search Console highlights so the Cloud Agent implements from data —
 * not a vague "do SEO" brief that drifts into markdown plans.
 */
export async function enrichCodeBriefWithGsc(input: {
  project: Project;
  title: string;
  brief: string;
}): Promise<{ brief: string; enriched: boolean }> {
  const blob = `${input.title}\n${input.brief}`;
  if (!looksLikeSeoIntent(blob)) {
    return { brief: input.brief, enriched: false };
  }
  if (!input.project.gscSiteUrl?.trim() || !isGscConfigured()) {
    return { brief: input.brief, enriched: false };
  }

  // Skip if the chat model already pasted a large GSC dump.
  if (
    /\b(rising queries|declining queries|search console window)\b/i.test(
      input.brief,
    ) &&
    input.brief.length > 1200
  ) {
    return { brief: input.brief, enriched: false };
  }

  try {
    const summary = await getSearchConsoleSummary(
      input.project.gscSiteUrl,
      28,
    );
    const gscBlock = summarizeGscForBrief(summary);
    const brief = [
      input.brief.trim(),
      "",
      "—— Live Search Console data (do not invent beyond this) ——",
      gscBlock,
      "",
      "Implementation requirements from this data:",
      "- Turn rising/declining queries and weak-CTR pages into concrete on-site changes (copy, titles/meta, headings, internal links, new/updated pages, sitemap/robots, structured data as appropriate for this repo).",
      "- Prefer shipping product/site changes over documentation.",
      "- Put analysis and the SEO rationale in the PR description — not as the only files in the PR.",
    ].join("\n");
    return { brief, enriched: true };
  } catch (error) {
    console.warn("[jobs] GSC brief enrichment failed", error);
    return { brief: input.brief, enriched: false };
  }
}

/** Extra Cloud Agent rules when the mission is SEO / site implementation. */
export function buildCodeAgentRequirements(jobTitle: string, jobBrief: string) {
  const blob = `${jobTitle}\n${jobBrief}`;
  const seo = looksLikeSeoIntent(blob);

  const base = [
    "Requirements:",
    "- Implement the requested work in this repository with real code/content/config changes.",
    "- Prefer a focused, reviewable change set.",
    "- Open or update a pull request when done if enabled.",
    "- Do not invent requirements beyond the brief; if ambiguous, state assumptions in the PR description.",
    "- Do NOT ship a PR that only adds markdown planning docs, SEO strategy notes, checklists, or README writeups unless the brief explicitly asks for documentation only.",
    "- Put plans/analysis in the PR description. The diff must change the product (pages, components, metadata, sitemap, robots, content routes, structured data, etc.) when the brief asks to implement or update the site.",
  ];

  if (seo) {
    base.push(
      "- SEO missions: prioritize on-page changes grounded in the Search Console data in the brief (titles, descriptions, headings, copy, internal links, sitemap health, indexability).",
      "- If the repo has no obvious marketing site, still change the closest real surfaces (app metadata, public pages, content collections) rather than dumping a docs-only plan.",
    );
  }

  return base;
}
