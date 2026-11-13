import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { activityConfigured, sendActivityNotice } from "@/lib/activity/notify";
import { createRateLimiter, VISIT_NOTICES_PER_MINUTE } from "@/lib/activity/rate-limit";
import { buildVisitPayload, decideVisit, SEEN_COOKIE, SEEN_COOKIE_MAX_AGE } from "@/lib/activity/visit";

// Aviso de acesso no Discord. Roda no runtime Node.js (padrão do proxy no Next 16); o envio acontece
// depois da resposta via event.waitUntil e nunca altera nem atrasa a página.

const limiter = createRateLimiter(VISIT_NOTICES_PER_MINUTE, 60_000);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = NextResponse.next();
  try {
    if (!activityConfigured()) return response;

    const { pathname, search } = request.nextUrl;
    const decision = decideVisit({
      method: request.method,
      pathname,
      search,
      header: (name) => request.headers.get(name),
      hasCookie: request.cookies.has(SEEN_COOKIE),
    });
    if (!decision.notify) return response;

    response.cookies.set({
      name: SEEN_COOKIE,
      value: "1",
      maxAge: SEEN_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    if (limiter.tryTake()) {
      const payload = buildVisitPayload({
        pathname,
        search,
        country: request.headers.get("x-vercel-ip-country"),
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
        ownHost: request.headers.get("host"),
        droppedSinceLast: limiter.takeDropped(),
      });
      event.waitUntil(sendActivityNotice(payload));
    }
  } catch {
    // Aviso é opcional: qualquer erro aqui não pode afetar a página.
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
