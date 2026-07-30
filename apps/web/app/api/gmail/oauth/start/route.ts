import { NextResponse } from "next/server";
import {
  buildGmailAuthUrl,
  exchangeGmailCode,
  GmailError,
  isGmailOAuthAppConfigured,
} from "@/lib/gmail/client";

export const runtime = "nodejs";

function redirectUri(request: Request) {
  const configured = process.env.GMAIL_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.origin}/api/gmail/oauth/callback`;
}

/** Start Gmail OAuth — visit once to mint a refresh token. */
export async function GET(request: Request) {
  if (!isGmailOAuthAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first (Google Cloud OAuth client).",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  if (url.pathname.endsWith("/callback") || url.searchParams.has("code")) {
    return handleCallback(request);
  }

  const dest = buildGmailAuthUrl(redirectUri(request), "jarvis-gmail");
  return NextResponse.redirect(dest);
}

async function handleCallback(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return new NextResponse(`Gmail OAuth error: ${error}`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return new NextResponse("Missing OAuth code", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const tokens = await exchangeGmailCode(code, redirectUri(request));
    const refresh = tokens.refresh_token?.trim();
    const body = [
      "Gmail OAuth connected.",
      "",
      refresh
        ? `Add this to apps/web/.env.local:\n\nGMAIL_REFRESH_TOKEN=${refresh}\n`
        : "No refresh_token returned. Revoke Jarvis access at https://myaccount.google.com/permissions and retry with prompt=consent (already enabled).",
      "",
      "Then restart the dev server and set email senders on each lane.",
      "",
      "You can close this tab.",
    ].join("\n");

    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message =
      err instanceof GmailError
        ? err.message
        : err instanceof Error
          ? err.message
          : "OAuth failed";
    return new NextResponse(message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
