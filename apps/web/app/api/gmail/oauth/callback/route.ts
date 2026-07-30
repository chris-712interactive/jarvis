import { GET as startGet } from "../start/route";

export const runtime = "nodejs";

/** OAuth redirect target — same handler as /api/gmail/oauth/start with ?code=. */
export async function GET(request: Request) {
  return startGet(request);
}
