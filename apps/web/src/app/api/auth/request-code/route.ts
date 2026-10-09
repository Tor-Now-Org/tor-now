import { checkBotId } from "botid/server";
import { API_BASE_URL } from "@/lib/api/client.ts";

/**
 * ADR 0027: sign-in codes are requested here, not from the API directly. Every
 * code is a WhatsApp message we pay for, so the caller is checked for being a
 * person first, and only then is the request forwarded with the secret the API
 * requires of it.
 */
export async function POST(request: Request): Promise<Response> {
  const verdict = await checkBotId({
    // Off Vercel there is no BotID to ask, and the library then answers
    // "human" itself. On Vercel, VERCEL is always "1".
    developmentOptions: { isDevelopment: process.env["VERCEL"] !== "1" },
  });
  if (verdict.isBot) {
    return Response.json(
      { error: { code: "FORBIDDEN", message: "This request looks automated" } },
      { status: 403 },
    );
  }

  const secret = process.env["SIGN_IN_PROXY_SECRET"];
  const upstream = await fetch(`${API_BASE_URL}/auth/request-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === undefined || secret === "" ? {} : { "X-Sign-In-Proxy": secret }),
    },
    body: await request.text(),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
