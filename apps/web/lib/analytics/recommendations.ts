import { generateText } from "ai";

import {
  Ga4Error,
  getPropertySummary,
  isGa4Configured,
  type Ga4PropertySummary,
} from "@/lib/analytics/ga4";
import {
  GscError,
  getSearchConsoleSummary,
  isGscConfigured,
  type GscSiteSummary,
} from "@/lib/analytics/gsc";
import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import type { JobKind, Project } from "@/lib/db/schema";
import {
  recommendationsNotePath,
  writeVaultNote,
  VaultError,
} from "@/lib/vault/notes";

export type RecommendationChannel =
  | "site"
  | "social"
  | "content"
  | "ops"
  | "analytics_setup";

export type RecommendationPriority = "critical" | "high" | "medium" | "low";

export type LaneRecommendation = {
  id: string;
  channel: RecommendationChannel;
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  evidence: string[];
  goalAlignment: string;
  suggestedJobKind: JobKind | "none";
  briefSeed: string;
  effort: "S" | "M" | "L";
  expectedImpact: string;
};

export type LaneRecommendationsResult = {
  projectId: string;
  projectName: string;
  goal: string;
  contentChannel: string | null;
  range: {
    ga4Days: number;
    gscDays: number;
  };
  sources: {
    ga4: "ok" | "missing_config" | "missing_property" | "error";
    gsc: "ok" | "missing_config" | "missing_property" | "error";
    ga4Error: string | null;
    gscError: string | null;
  };
  snapshot: {
    ga4: Ga4PropertySummary | null;
    gsc: GscSiteSummary | null;
  };
  narrative: string;
  recommendations: LaneRecommendation[];
  nextMoves: string[];
  polishedWithLlm: boolean;
  vaultPath: string | null;
  generatedAt: string;
};

const PRIORITY_SCORE: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function fmtPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtCtr(ctr: number) {
  return `${(ctr * 100).toFixed(2)}%`;
}

function slugId(prefix: string, seed: string) {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}-${slug || "item"}`;
}

function pushRec(
  list: LaneRecommendation[],
  rec: Omit<LaneRecommendation, "id"> & { id?: string },
) {
  list.push({
    id: rec.id ?? slugId(rec.channel, rec.title),
    ...rec,
  });
}

function heuristicFromGa4(
  project: Project,
  ga4: Ga4PropertySummary,
  out: LaneRecommendation[],
) {
  const goal = project.goal?.trim() || "the lane goal";

  if ((ga4.deltas.activeUsersPct ?? 0) <= -15) {
    pushRec(out, {
      channel: "site",
      priority: "high",
      title: "Arrest the traffic decline",
      rationale: `Active users dropped ${fmtPct(ga4.deltas.activeUsersPct)} vs the prior period. Stabilize acquisition and conversion paths that support: ${goal}.`,
      evidence: [
        `GA4 activeUsers ${ga4.current.activeUsers} (${fmtPct(ga4.deltas.activeUsersPct)})`,
        `Sessions ${ga4.current.sessions} (${fmtPct(ga4.deltas.sessionsPct)})`,
        `Views ${ga4.current.screenPageViews} (${fmtPct(ga4.deltas.screenPageViewsPct)})`,
      ],
      goalAlignment: `Recovering users protects progress toward "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        `Investigate and fix on-site causes of the ${fmtPct(ga4.deltas.activeUsersPct)} active-user drop.`,
        `Lane goal: ${goal}`,
        `Top pages to inspect: ${ga4.topPages
          .slice(0, 5)
          .map((p) => p.path)
          .join(", ")}`,
        "Ship concrete UX/content/performance fixes; do not write a docs-only plan.",
      ].join("\n"),
      effort: "M",
      expectedImpact: "Stop compounding traffic loss before SEO wins can compound.",
    });
  }

  if (
    ga4.current.engagementRate != null &&
    ga4.current.engagementRate < 0.4 &&
    ga4.current.sessions >= 20
  ) {
    pushRec(out, {
      channel: "site",
      priority: "medium",
      title: "Raise engagement on key pages",
      rationale: `Engagement rate is ${(ga4.current.engagementRate * 100).toFixed(1)}%. Sharper CTAs, clearer hooks, and faster first contentful paint on top pages will better serve: ${goal}.`,
      evidence: [
        `Engagement rate ${(ga4.current.engagementRate * 100).toFixed(1)}%`,
        `Avg session ${ga4.current.averageSessionDurationSec?.toFixed(0) ?? "n/a"}s`,
        ...ga4.topPages
          .slice(0, 3)
          .map((p) => `Top page ${p.path}: ${p.views} views / ${p.activeUsers} users`),
      ],
      goalAlignment: `Engaged visitors are more likely to convert against "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        "Improve engagement on top GA4 pages: clearer above-the-fold value, stronger CTA, trim friction.",
        `Lane goal: ${goal}`,
        ...ga4.topPages.slice(0, 5).map((p) => `- ${p.path}`),
      ].join("\n"),
      effort: "M",
      expectedImpact: "Higher engaged sessions → more conversions / return visits.",
    });
  }

  if (ga4.topPages.length >= 3 && project.contentChannel?.trim()) {
    const lead = ga4.topPages[0];
    pushRec(out, {
      channel: "social",
      priority: "medium",
      title: `Promote top page on ${project.contentChannel}`,
      rationale: `GA4 shows ${lead.path} leading with ${lead.views} views. A ${project.contentChannel} post that teases that content can pull social attention toward "${goal}".`,
      evidence: [
        `Top page ${lead.path}: ${lead.views} views, ${lead.activeUsers} users`,
        `Channel: ${project.contentChannel}`,
      ],
      goalAlignment: `Social distribution amplifies proven site assets tied to "${goal}".`,
      suggestedJobKind: "message",
      briefSeed: [
        `Draft a ${project.contentChannel} post that drives people to ${lead.path}.`,
        `Lane goal: ${goal}`,
        project.contentBrief?.trim()
          ? `Standing brief:\n${project.contentBrief.trim()}`
          : null,
        "Hook with a concrete takeaway; end with a clear CTA to the page.",
      ]
        .filter(Boolean)
        .join("\n"),
      effort: "S",
      expectedImpact: "Borrow proven on-site interest into the community channel.",
    });
  }
}

function heuristicFromGsc(
  project: Project,
  gsc: GscSiteSummary,
  out: LaneRecommendation[],
) {
  const goal = project.goal?.trim() || "the lane goal";

  const weakCtr = gsc.topPages
    .filter((p) => p.impressions >= 80 && p.ctr < 0.02 && p.position <= 20)
    .slice(0, 5);
  if (weakCtr.length) {
    pushRec(out, {
      channel: "site",
      priority: "high",
      title: "Fix weak-CTR pages that already rank",
      rationale:
        "These URLs earn impressions but convert poorly to clicks. Title/meta/H1 and snippet-worthy openers are usually the highest-ROI SEO edits.",
      evidence: weakCtr.map(
        (p) =>
          `${p.page}: CTR ${fmtCtr(p.ctr)}, pos ${p.position.toFixed(1)}, impressions ${p.impressions}, clicks ${p.clicks}`,
      ),
      goalAlignment: `More qualified clicks on ranking pages accelerates "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        "Improve titles, meta descriptions, H1s, and above-the-fold copy for weak-CTR ranking pages.",
        `Lane goal: ${goal}`,
        "Targets:",
        ...weakCtr.map(
          (p) =>
            `- ${p.page} (CTR ${fmtCtr(p.ctr)}, pos ${p.position.toFixed(1)}, impressions ${p.impressions})`,
        ),
        "Ship real on-page changes — not a docs-only PR.",
      ].join("\n"),
      effort: "M",
      expectedImpact: "Lift CTR on pages Google already shows.",
    });
  }

  const nearWin = gsc.topQueries
    .filter((q) => q.position >= 4 && q.position <= 15 && q.impressions >= 40)
    .slice(0, 6);
  if (nearWin.length) {
    pushRec(out, {
      channel: "site",
      priority: "high",
      title: "Push page-2 / mid-pack queries into top 3",
      rationale:
        "Queries in positions ~4–15 are close enough that internal links, deeper sections, FAQs, and intent-matched copy can move them into high-CTR slots.",
      evidence: nearWin.map(
        (q) =>
          `"${q.query}": pos ${q.position.toFixed(1)}, clicks ${q.clicks}, impressions ${q.impressions}, CTR ${fmtCtr(q.ctr)}`,
      ),
      goalAlignment: `Winning these queries builds discoverability for "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        "Strengthen on-page coverage for near-win Search Console queries (content depth, FAQ, internal links, titles).",
        `Lane goal: ${goal}`,
        "Queries:",
        ...nearWin.map(
          (q) =>
            `- "${q.query}" pos=${q.position.toFixed(1)} impressions=${q.impressions}`,
        ),
      ].join("\n"),
      effort: "L",
      expectedImpact: "Compounding organic clicks from already-visible queries.",
    });
  }

  if (gsc.risingQueries.length) {
    const rising = gsc.risingQueries.slice(0, 5);
    pushRec(out, {
      channel: "site",
      priority: "high",
      title: "Double down on rising queries",
      rationale:
        "These queries are gaining clicks. Expand supporting pages, refresh matching posts, and add internal links while momentum is up.",
      evidence: rising.map(
        (q) =>
          `"${q.query}": clicks ${q.clicks}, pos ${q.position.toFixed(1)}, CTR ${fmtCtr(q.ctr)}`,
      ),
      goalAlignment: `Riding rising demand is the fastest SEO path toward "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        "Expand/refresh site content and internal links for rising Search Console queries.",
        `Lane goal: ${goal}`,
        ...rising.map((q) => `- "${q.query}"`),
      ].join("\n"),
      effort: "M",
      expectedImpact: "Capture accelerating demand before competitors do.",
    });

    if (project.contentChannel?.trim() || project.dailyContent) {
      const channel = project.contentChannel?.trim() || "social";
      pushRec(out, {
        channel: "social",
        priority: "medium",
        title: `Turn rising queries into ${channel} posts`,
        rationale: `Social can seed demand and brand association for queries Google is already rewarding. Use the standing content brief when drafting.`,
        evidence: rising.slice(0, 4).map((q) => `"${q.query}" rising in GSC`),
        goalAlignment: `Community content around proven search themes supports "${goal}".`,
        suggestedJobKind: "message",
        briefSeed: [
          `Draft a ${channel} post inspired by rising search queries (do not keyword-stuff).`,
          `Lane goal: ${goal}`,
          project.contentBrief?.trim()
            ? `Standing brief:\n${project.contentBrief.trim()}`
            : null,
          "Query themes:",
          ...rising.slice(0, 5).map((q) => `- ${q.query}`),
        ]
          .filter(Boolean)
          .join("\n"),
        effort: "S",
        expectedImpact: "Audience education + branded search demand.",
      });
    }
  }

  if (gsc.decliningQueries.length) {
    const declining = gsc.decliningQueries.slice(0, 5);
    pushRec(out, {
      channel: "site",
      priority: "medium",
      title: "Diagnose declining queries",
      rationale:
        "Clicks fell on previously working queries. Check cannibalization, title changes, lost sections, or competitor SERP features.",
      evidence: declining.map(
        (q) =>
          `"${q.query}": clicks ${q.clicks} (Δ ${q.clicksDelta}), pos ${q.position.toFixed(1)}`,
      ),
      goalAlignment: `Stopping regress on known-good queries protects "${goal}".`,
      suggestedJobKind: "research",
      briefSeed: [
        "Research why these Search Console queries declined and propose concrete on-site fixes.",
        `Lane goal: ${goal}`,
        ...declining.map(
          (q) => `- "${q.query}" Δclicks=${q.clicksDelta} pos=${q.position.toFixed(1)}`,
        ),
      ].join("\n"),
      effort: "M",
      expectedImpact: "Recover lost organic clicks.",
    });
  }

  if ((gsc.deltas.clicksPct ?? 0) <= -20 && gsc.previous.clicks >= 20) {
    pushRec(out, {
      channel: "site",
      priority: "critical",
      title: "Organic clicks dropped sharply",
      rationale: `Clicks are ${fmtPct(gsc.deltas.clicksPct)} vs prior. Treat this as an SEO incident: indexation, rankings, CTR, and intent mismatch.`,
      evidence: [
        `Clicks ${gsc.current.clicks} (${fmtPct(gsc.deltas.clicksPct)})`,
        `Impressions ${gsc.current.impressions} (${fmtPct(gsc.deltas.impressionsPct)})`,
        `CTR ${fmtCtr(gsc.current.ctr)} (${gsc.deltas.ctrPctPoints != null ? `${gsc.deltas.ctrPctPoints > 0 ? "+" : ""}${(gsc.deltas.ctrPctPoints * 100).toFixed(2)} pts` : "n/a"})`,
        `Avg position ${gsc.current.position.toFixed(1)} (Δ ${gsc.deltas.positionDelta?.toFixed(1) ?? "n/a"})`,
      ],
      goalAlignment: `Organic is likely a primary acquisition path for "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        `Urgent SEO recovery: clicks ${fmtPct(gsc.deltas.clicksPct)} vs prior window ${gsc.startDate}→${gsc.endDate}.`,
        `Lane goal: ${goal}`,
        "Inspect index coverage, top declining queries/pages, titles/CTR, and recent site changes.",
        "Ship fixes; put analysis in the PR description.",
      ].join("\n"),
      effort: "L",
      expectedImpact: "Stabilize organic acquisition.",
    });
  }

  const coverage = gsc.coverage;
  if (coverage) {
    if (coverage.sitemapTotals.withErrors > 0) {
      pushRec(out, {
        channel: "site",
        priority: "critical",
        title: "Repair sitemap errors",
        rationale:
          "Broken sitemaps block discovery/indexation. Fix submitted URL lists before spending effort on new content.",
        evidence: [
          `${coverage.sitemapTotals.withErrors} sitemap(s) with errors`,
          ...coverage.sitemaps
            .filter((s) => s.errors > 0)
            .slice(0, 4)
            .map((s) => `${s.path}: ${s.errors} errors / ${s.warnings} warnings`),
        ],
        goalAlignment: `Indexable pages are a prerequisite for SEO progress on "${goal}".`,
        suggestedJobKind: "code",
        briefSeed: [
          "Fix Search Console sitemap errors and confirm valid URLs are submitted.",
          `Lane goal: ${goal}`,
          ...coverage.sitemaps
            .filter((s) => s.errors > 0)
            .map((s) => `- ${s.path} errors=${s.errors}`),
        ].join("\n"),
        effort: "S",
        expectedImpact: "Unblock crawling/indexing of growth pages.",
      });
    }

    const badInspect = coverage.inspectedUrls.filter((u) => {
      const verdict = u.indexStatusResult.verdict?.toUpperCase() ?? "";
      const state = u.indexStatusResult.coverageState?.toLowerCase() ?? "";
      return (
        verdict.includes("FAIL") ||
        state.includes("not indexed") ||
        state.includes("excluded") ||
        state.includes("error")
      );
    });
    if (badInspect.length) {
      pushRec(out, {
        channel: "site",
        priority: "high",
        title: "Fix index coverage on inspected URLs",
        rationale:
          "URL Inspection reports non-indexed / failed pages among top surfaces. Resolve robots, canonicals, and soft-404s.",
        evidence: badInspect.slice(0, 5).map((u) => {
          const s = u.indexStatusResult;
          return `${u.inspectionUrl}: verdict=${s.verdict ?? "?"} coverage=${s.coverageState ?? "?"}`;
        }),
        goalAlignment: `Unindexed pages cannot contribute to "${goal}".`,
        suggestedJobKind: "code",
        briefSeed: [
          "Fix indexability issues found by Search Console URL Inspection.",
          `Lane goal: ${goal}`,
          ...badInspect.slice(0, 5).map((u) => `- ${u.inspectionUrl}`),
        ].join("\n"),
        effort: "M",
        expectedImpact: "Bring important URLs into the index.",
      });
    }
  }

  const mobile = gsc.byDevice.find((d) => /mobile/i.test(d.key));
  const desktop = gsc.byDevice.find((d) => /desktop/i.test(d.key));
  if (mobile && desktop && mobile.ctr + 0.01 < desktop.ctr && mobile.impressions > 100) {
    pushRec(out, {
      channel: "site",
      priority: "medium",
      title: "Close the mobile CTR gap",
      rationale: `Mobile CTR ${fmtCtr(mobile.ctr)} trails desktop ${fmtCtr(desktop.ctr)}. Mobile titles/snippets and page experience may be underperforming.`,
      evidence: [
        `Mobile: clicks ${mobile.clicks}, CTR ${fmtCtr(mobile.ctr)}, pos ${mobile.position.toFixed(1)}`,
        `Desktop: clicks ${desktop.clicks}, CTR ${fmtCtr(desktop.ctr)}, pos ${desktop.position.toFixed(1)}`,
      ],
      goalAlignment: `Most acquisition is often mobile — gap hurts "${goal}".`,
      suggestedJobKind: "code",
      briefSeed: [
        "Improve mobile SERP CTR and mobile page experience for top landing pages.",
        `Lane goal: ${goal}`,
      ].join("\n"),
      effort: "M",
      expectedImpact: "Recover mobile organic clicks.",
    });
  }
}

function setupGaps(project: Project, out: LaneRecommendation[]) {
  if (!project.gaPropertyId?.trim()) {
    pushRec(out, {
      channel: "analytics_setup",
      priority: "medium",
      title: "Connect GA4 for this lane",
      rationale:
        "Without gaPropertyId, Jarvis cannot measure on-site traction against the goal.",
      evidence: ["projects.gaPropertyId is empty"],
      goalAlignment: "You cannot steer what you cannot measure.",
      suggestedJobKind: "none",
      briefSeed: "Set GA4 property id on the project form and ensure SA credentials are configured.",
      effort: "S",
      expectedImpact: "Unlock traffic/engagement recommendations.",
    });
  } else if (!isGa4Configured()) {
    pushRec(out, {
      channel: "analytics_setup",
      priority: "high",
      title: "Add GA4 service-account credentials",
      rationale:
        "Lane has a GA4 property id but Jarvis has no GA4_SERVICE_ACCOUNT_JSON (or file path).",
      evidence: ["gaPropertyId set", "GA4 credentials missing in env"],
      goalAlignment: "Credentials are required for live recommendations.",
      suggestedJobKind: "none",
      briefSeed: "Set GA4_SERVICE_ACCOUNT_JSON on the host.",
      effort: "S",
      expectedImpact: "Enable get_lane_analytics + recommendations.",
    });
  }

  if (!project.gscSiteUrl?.trim()) {
    pushRec(out, {
      channel: "analytics_setup",
      priority: "medium",
      title: "Connect Search Console for this lane",
      rationale:
        "Without gscSiteUrl, Jarvis cannot see queries, CTR, or index coverage.",
      evidence: ["projects.gscSiteUrl is empty"],
      goalAlignment: "SEO recommendations need Search Console.",
      suggestedJobKind: "none",
      briefSeed: "Set gscSiteUrl (sc-domain:example.com or https://example.com/).",
      effort: "S",
      expectedImpact: "Unlock SEO deep-dive recommendations.",
    });
  } else if (!isGscConfigured()) {
    pushRec(out, {
      channel: "analytics_setup",
      priority: "high",
      title: "Add Search Console API credentials",
      rationale:
        "Lane has gscSiteUrl but no shared Google service-account JSON is configured.",
      evidence: ["gscSiteUrl set", "GSC/GA4 credentials missing in env"],
      goalAlignment: "Credentials are required for live SEO recommendations.",
      suggestedJobKind: "none",
      briefSeed: "Set GA4_SERVICE_ACCOUNT_JSON (reused for GSC) and grant the SA on the property.",
      effort: "S",
      expectedImpact: "Enable get_lane_search + SEO recommendations.",
    });
  }

  if (!project.goal?.trim()) {
    pushRec(out, {
      channel: "ops",
      priority: "high",
      title: "Write a concrete lane goal",
      rationale:
        "Recommendations are ranked against the goal. An empty goal forces generic advice.",
      evidence: ["projects.goal is empty"],
      goalAlignment: "Goal is the ranking function for every recommendation.",
      suggestedJobKind: "none",
      briefSeed: "Edit the lane and set a measurable goal (audience, outcome, timeframe).",
      effort: "S",
      expectedImpact: "Sharper, less generic recommendations.",
    });
  }
}

function sortRecs(recs: LaneRecommendation[]) {
  return [...recs].sort(
    (a, b) => PRIORITY_SCORE[a.priority] - PRIORITY_SCORE[b.priority],
  );
}

function buildEvidencePack(input: {
  project: Project;
  ga4: Ga4PropertySummary | null;
  gsc: GscSiteSummary | null;
  ga4Error: string | null;
  gscError: string | null;
}) {
  const { project, ga4, gsc } = input;
  const lines = [
    `Lane: ${project.name} (${project.slug})`,
    `Goal: ${project.goal?.trim() || "(none)"}`,
    `Status: ${project.status} · Trust: ${project.trustLevel}`,
    project.needsYou ? `Needs you: ${project.needsYou}` : null,
    project.notes?.trim() ? `Hub notes: ${project.notes.trim().slice(0, 400)}` : null,
    project.contentChannel
      ? `Content channel: ${project.contentChannel}${project.dailyContent ? " (daily on)" : ""}`
      : "Content channel: (none)",
    project.contentBrief?.trim()
      ? `Content brief:\n${project.contentBrief.trim().slice(0, 800)}`
      : null,
    project.repoUrl ? `Repo: ${project.repoUrl}` : null,
    project.productionUrl ? `Production: ${project.productionUrl}` : null,
    "",
  ].filter((line) => line !== null) as string[];

  if (ga4) {
    lines.push(
      `## GA4 (${ga4.rangeDays}d)`,
      `Users ${ga4.current.activeUsers} (${fmtPct(ga4.deltas.activeUsersPct)}), sessions ${ga4.current.sessions} (${fmtPct(ga4.deltas.sessionsPct)}), views ${ga4.current.screenPageViews} (${fmtPct(ga4.deltas.screenPageViewsPct)})`,
      `Engagement ${ga4.current.engagementRate != null ? `${(ga4.current.engagementRate * 100).toFixed(1)}%` : "n/a"}, avg session ${ga4.current.averageSessionDurationSec?.toFixed(0) ?? "n/a"}s`,
      "Top pages:",
      ...ga4.topPages
        .slice(0, 8)
        .map((p) => `- ${p.path}: views=${p.views} users=${p.activeUsers}`),
      "",
    );
  } else {
    lines.push(`## GA4 unavailable: ${input.ga4Error || "not configured"}`, "");
  }

  if (gsc) {
    lines.push(
      `## Search Console (${gsc.rangeDays}d, ${gsc.startDate}→${gsc.endDate})`,
      `Clicks ${gsc.current.clicks} (${fmtPct(gsc.deltas.clicksPct)}), impressions ${gsc.current.impressions} (${fmtPct(gsc.deltas.impressionsPct)}), CTR ${fmtCtr(gsc.current.ctr)}, pos ${gsc.current.position.toFixed(1)}`,
      "Rising queries:",
      ...gsc.risingQueries
        .slice(0, 8)
        .map(
          (q) =>
            `- "${q.query}" clicks=${q.clicks} pos=${q.position.toFixed(1)}`,
        ),
      "Declining queries:",
      ...gsc.decliningQueries
        .slice(0, 8)
        .map(
          (q) =>
            `- "${q.query}" clicks=${q.clicks} Δ=${q.clicksDelta} pos=${q.position.toFixed(1)}`,
        ),
      "Top pages:",
      ...gsc.topPages
        .slice(0, 8)
        .map(
          (p) =>
            `- ${p.page} clicks=${p.clicks} CTR=${fmtCtr(p.ctr)} pos=${p.position.toFixed(1)}`,
        ),
      "Devices:",
      ...gsc.byDevice
        .slice(0, 4)
        .map((d) => `- ${d.key}: clicks=${d.clicks} CTR=${fmtCtr(d.ctr)}`),
      "",
    );
    if (gsc.coverage) {
      lines.push(
        `Sitemaps: ${gsc.coverage.sitemapTotals.count} (errors ${gsc.coverage.sitemapTotals.withErrors}, warnings ${gsc.coverage.sitemapTotals.withWarnings})`,
        ...gsc.coverage.inspectedUrls.slice(0, 5).map((u) => {
          const s = u.indexStatusResult;
          return `- inspect ${u.inspectionUrl}: ${s.verdict}/${s.coverageState}`;
        }),
        "",
      );
    }
  } else {
    lines.push(`## GSC unavailable: ${input.gscError || "not configured"}`, "");
  }

  lines.push(
    "Note: Native Skool/social analytics are not connected yet — social recommendations must use GSC/GA4 demand signals + contentBrief, and must not invent engagement metrics.",
  );

  return lines.join("\n");
}

function fallbackNarrative(
  project: Project,
  recs: LaneRecommendation[],
  sources: LaneRecommendationsResult["sources"],
) {
  const goal = project.goal?.trim() || "this lane's goal";
  const top = recs.filter((r) => r.priority === "critical" || r.priority === "high");
  const bits = [
    `Recommendation pass for ${project.name} toward "${goal}".`,
    `Sources: GA4=${sources.ga4}, GSC=${sources.gsc}.`,
    top.length
      ? `Top priorities: ${top
          .slice(0, 3)
          .map((r) => r.title)
          .join("; ")}.`
      : "No critical/high items — keep compounding mid-pack SEO and content loops.",
    "Social advice uses search/traffic demand as a proxy until native social APIs are wired.",
  ];
  return bits.join(" ");
}

async function polishWithLlm(input: {
  project: Project;
  evidence: string;
  seed: LaneRecommendation[];
}): Promise<{
  narrative: string;
  recommendations: LaneRecommendation[];
  nextMoves: string[];
} | null> {
  if (!isChatConfigured()) return null;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.35,
      prompt: [
        "You are a senior growth + SEO operator for Jarvis.",
        "Produce a DETAILED, specific recommendation plan for ONE project lane.",
        "Be ruthless about evidence. Do NOT invent metrics, rankings, or social stats not in the evidence pack.",
        "Native social analytics are unavailable — social ideas must be grounded in GSC/GA4 demand + contentBrief.",
        "Return ONLY valid JSON (no markdown fences) with shape:",
        '{',
        '  "narrative": "400-700 word operator briefing tying data → goal → strategy",',
        '  "nextMoves": ["3-5 immediate next actions"],',
        '  "recommendations": [',
        "    {",
        '      "id": "stable-kebab-id",',
        '      "channel": "site|social|content|ops|analytics_setup",',
        '      "priority": "critical|high|medium|low",',
        '      "title": "short title",',
        '      "rationale": "2-4 sentences",',
        '      "evidence": ["metric quotes from the pack"],',
        '      "goalAlignment": "how this serves the lane goal",',
        '      "suggestedJobKind": "code|message|research|ops|none",',
        '      "briefSeed": "paste-ready job brief",',
        '      "effort": "S|M|L",',
        '      "expectedImpact": "one sentence"',
        "    }",
        "  ]",
        "}",
        "Include 6-12 recommendations. Prefer actionable site/code and social/message items over vague strategy.",
        "You may refine/extend the seed recommendations; keep the strongest seeds unless evidence contradicts them.",
        "",
        `Lane goal: ${input.project.goal || "(none)"}`,
        "",
        "Seed recommendations JSON:",
        JSON.stringify(input.seed.slice(0, 12), null, 2),
        "",
        "Evidence pack:",
        input.evidence,
      ].join("\n"),
    });

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as {
      narrative?: string;
      nextMoves?: string[];
      recommendations?: Array<Partial<LaneRecommendation>>;
    };

    const channels = new Set([
      "site",
      "social",
      "content",
      "ops",
      "analytics_setup",
    ]);
    const priorities = new Set(["critical", "high", "medium", "low"]);
    const kinds = new Set(["code", "message", "research", "ops", "none"]);
    const efforts = new Set(["S", "M", "L"]);

    const recommendations: LaneRecommendation[] = [];
    for (const raw of parsed.recommendations ?? []) {
      if (!raw.title || !raw.rationale) continue;
      const channel = channels.has(String(raw.channel))
        ? (raw.channel as RecommendationChannel)
        : "ops";
      const priority = priorities.has(String(raw.priority))
        ? (raw.priority as RecommendationPriority)
        : "medium";
      const suggestedJobKind = kinds.has(String(raw.suggestedJobKind))
        ? (raw.suggestedJobKind as LaneRecommendation["suggestedJobKind"])
        : "none";
      const effort = efforts.has(String(raw.effort))
        ? (raw.effort as "S" | "M" | "L")
        : "M";
      recommendations.push({
        id: String(raw.id || slugId(channel, String(raw.title))),
        channel,
        priority,
        title: String(raw.title).slice(0, 160),
        rationale: String(raw.rationale).slice(0, 1200),
        evidence: Array.isArray(raw.evidence)
          ? raw.evidence.map((e) => String(e).slice(0, 300)).slice(0, 8)
          : [],
        goalAlignment: String(raw.goalAlignment || "").slice(0, 400),
        suggestedJobKind,
        briefSeed: String(raw.briefSeed || raw.title).slice(0, 4000),
        effort,
        expectedImpact: String(raw.expectedImpact || "").slice(0, 300),
      });
    }

    if (recommendations.length === 0) return null;

    return {
      narrative: String(parsed.narrative || "").slice(0, 6000),
      nextMoves: Array.isArray(parsed.nextMoves)
        ? parsed.nextMoves.map((m) => String(m).slice(0, 240)).slice(0, 6)
        : [],
      recommendations: sortRecs(recommendations).slice(0, 14),
    };
  } catch (error) {
    console.warn("[recommendations] LLM polish failed", error);
    return null;
  }
}

function recommendationsMarkdown(result: LaneRecommendationsResult) {
  const lines = [
    `# Recommendations — ${result.projectName}`,
    "",
    `> Generated ${result.generatedAt}${result.polishedWithLlm ? " · LLM-polished" : " · heuristic"}`,
    "",
    `## Goal`,
    "",
    result.goal || "(none set)",
    "",
    `## Briefing`,
    "",
    result.narrative,
    "",
    `## Next moves`,
    "",
    ...result.nextMoves.map((m) => `- ${m}`),
    "",
    `## Recommendations`,
    "",
  ];

  for (const rec of result.recommendations) {
    lines.push(
      `### [${rec.priority}] ${rec.title}`,
      "",
      `- Channel: **${rec.channel}** · Effort **${rec.effort}** · Job **${rec.suggestedJobKind}**`,
      `- Impact: ${rec.expectedImpact}`,
      `- Goal fit: ${rec.goalAlignment}`,
      "",
      rec.rationale,
      "",
      "Evidence:",
      ...rec.evidence.map((e) => `- ${e}`),
      "",
      "Brief seed:",
      "",
      "```",
      rec.briefSeed,
      "```",
      "",
    );
  }

  lines.push(
    "---",
    `_Jarvis lane recommendations · GA4 ${result.sources.ga4} · GSC ${result.sources.gsc}_`,
    "",
  );
  return lines.join("\n");
}

export async function generateLaneRecommendations(input: {
  project: Project;
  ga4Days?: number;
  gscDays?: number;
  includeCoverage?: boolean;
  writeVault?: boolean;
  skipLlm?: boolean;
}): Promise<LaneRecommendationsResult> {
  const ga4Days = Math.min(Math.max(input.ga4Days ?? 28, 1), 90);
  const gscDays = Math.min(Math.max(input.gscDays ?? 28, 1), 90);
  const includeCoverage = input.includeCoverage !== false;

  let ga4: Ga4PropertySummary | null = null;
  let gsc: GscSiteSummary | null = null;
  let ga4Status: LaneRecommendationsResult["sources"]["ga4"] = "missing_property";
  let gscStatus: LaneRecommendationsResult["sources"]["gsc"] = "missing_property";
  let ga4Error: string | null = null;
  let gscError: string | null = null;

  const tasks: Array<Promise<void>> = [];

  if (!input.project.gaPropertyId?.trim()) {
    ga4Status = "missing_property";
  } else if (!isGa4Configured()) {
    ga4Status = "missing_config";
    ga4Error = "GA4 credentials not configured";
  } else {
    tasks.push(
      (async () => {
        try {
          ga4 = await getPropertySummary(input.project.gaPropertyId!, ga4Days);
          ga4Status = "ok";
        } catch (error) {
          ga4Status = "error";
          ga4Error =
            error instanceof Ga4Error
              ? error.message
              : error instanceof Error
                ? error.message
                : "GA4 request failed";
        }
      })(),
    );
  }

  if (!input.project.gscSiteUrl?.trim()) {
    gscStatus = "missing_property";
  } else if (!isGscConfigured()) {
    gscStatus = "missing_config";
    gscError = "Search Console credentials not configured";
  } else {
    tasks.push(
      (async () => {
        try {
          gsc = await getSearchConsoleSummary(input.project.gscSiteUrl!, {
            days: gscDays,
            includeCoverage,
            inspectTopPages: includeCoverage ? 3 : 0,
          });
          gscStatus = "ok";
        } catch (error) {
          gscStatus = "error";
          gscError =
            error instanceof GscError
              ? error.message
              : error instanceof Error
                ? error.message
                : "GSC request failed";
        }
      })(),
    );
  }

  await Promise.all(tasks);

  const seed: LaneRecommendation[] = [];
  setupGaps(input.project, seed);
  if (ga4) heuristicFromGa4(input.project, ga4, seed);
  if (gsc) heuristicFromGsc(input.project, gsc, seed);

  const sources: LaneRecommendationsResult["sources"] = {
    ga4: ga4Status,
    gsc: gscStatus,
    ga4Error,
    gscError,
  };

  const evidence = buildEvidencePack({
    project: input.project,
    ga4,
    gsc,
    ga4Error,
    gscError,
  });

  let recommendations = sortRecs(seed);
  let narrative = fallbackNarrative(input.project, recommendations, sources);
  let nextMoves = recommendations
    .slice(0, 5)
    .map((r) => `${r.title} (${r.suggestedJobKind})`);
  let polishedWithLlm = false;

  if (!input.skipLlm) {
    const polished = await polishWithLlm({
      project: input.project,
      evidence,
      seed: recommendations,
    });
    if (polished) {
      polishedWithLlm = true;
      recommendations = polished.recommendations;
      narrative = polished.narrative || narrative;
      nextMoves =
        polished.nextMoves.length > 0 ? polished.nextMoves : nextMoves;
    }
  }

  const result: LaneRecommendationsResult = {
    projectId: input.project.id,
    projectName: input.project.name,
    goal: input.project.goal?.trim() || "",
    contentChannel: input.project.contentChannel,
    range: { ga4Days, gscDays },
    sources,
    snapshot: { ga4, gsc },
    narrative,
    recommendations,
    nextMoves,
    polishedWithLlm,
    vaultPath: null,
    generatedAt: new Date().toISOString(),
  };

  if (input.writeVault && input.project.vaultPath?.trim()) {
    try {
      const note = writeVaultNote(
        input.project.vaultPath,
        recommendationsNotePath(input.project.slug),
        recommendationsMarkdown(result),
        { overwrite: true },
      );
      result.vaultPath = note.path;
    } catch (error) {
      if (!(error instanceof VaultError)) {
        console.error("[recommendations] vault write failed", error);
      }
    }
  }

  return result;
}
