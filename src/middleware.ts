import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logInfo } from "@/lib/logger";

export function middleware(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id") ?? crypto.randomUUID();
  const startedAt = Date.now();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-request-start", String(startedAt));

  if (process.env.LOG_REQUESTS === "1") {
    logInfo("request", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
    });
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
