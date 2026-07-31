import { NextResponse } from "next/server";
import {
  applyDeployWebhookToLanes,
  authorizeDeployWebhook,
  findLanesForDeployEvent,
  parseRailwayWebhook,
} from "@/lib/deploy/webhooks";

export const runtime = "nodejs";

/**
 * Railway project webhook receiver.
 * Configure per Railway project → Settings → Webhooks →
 *   URL: https://YOUR_JARVIS/api/webhooks/railway?secret=YOUR_DEPLOY_WEBHOOK_SECRET
 * Railway does not document HMAC signing; use the shared secret in the URL.
 */
export async function POST(request: Request) {
  if (!authorizeDeployWebhook(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized. Append ?secret=DEPLOY_WEBHOOK_SECRET (or CRON_SECRET) to the Railway webhook URL.",
      },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseRailwayWebhook(body);
  if (!parsed) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unsupported_or_ephemeral_event",
    });
  }

  const lanes = await findLanesForDeployEvent({
    host: "railway",
    externalIds: parsed.externalIds,
    names: parsed.names,
  });

  if (lanes.length === 0) {
    return NextResponse.json({
      ok: true,
      matched: 0,
      type: parsed.type,
      note: "No Jarvis lane matched this Railway project/service id. Set deployProjectId on the lane.",
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
