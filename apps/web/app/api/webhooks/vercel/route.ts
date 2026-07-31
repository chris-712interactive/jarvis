import { NextResponse } from "next/server";
import {
  applyDeployWebhookToLanes,
  authorizeDeployWebhook,
  findLanesForDeployEvent,
  parseVercelWebhook,
  verifyVercelSignature,
} from "@/lib/deploy/webhooks";

export const runtime = "nodejs";

/**
 * Vercel account webhook receiver.
 * Configure at Vercel → Settings → Webhooks →
 *   URL: https://YOUR_JARVIS/api/webhooks/vercel
 *   Secret → VERCEL_WEBHOOK_SECRET
 * Events: deployment.created, deployment.succeeded, deployment.error, deployment.canceled
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-vercel-signature");

  const signedOk = verifyVercelSignature(rawBody, signature);
  const sharedOk = authorizeDeployWebhook(request);
  if (!signedOk && !sharedOk) {
    return NextResponse.json(
      {
        error:
          "Unauthorized. Set VERCEL_WEBHOOK_SECRET (preferred) or pass DEPLOY_WEBHOOK_SECRET/CRON_SECRET as Bearer/?secret=.",
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseVercelWebhook(body);
  if (!parsed) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unsupported_or_unmapped_event",
    });
  }

  if (!parsed.productionTarget) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "non_production_target",
      type: parsed.type,
    });
  }

  const lanes = await findLanesForDeployEvent({
    host: "vercel",
    externalIds: parsed.externalIds,
    names: parsed.names,
  });

  if (lanes.length === 0) {
    return NextResponse.json({
      ok: true,
      matched: 0,
      type: parsed.type,
      note: "No Jarvis lane matched this Vercel project id/name. Set deployProjectId on the lane.",
    });
  }

  const updated = await applyDeployWebhookToLanes({
    lanes,
    statusHint: parsed.statusHint,
    detail: parsed.detail,
  });

  return NextResponse.json({
    ok: true,
    type: parsed.type,
    matched: updated.length,
    updated,
  });
}
