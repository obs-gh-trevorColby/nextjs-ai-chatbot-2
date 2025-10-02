import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";
import { logger, tracer } from "./lib/otel-server";

export async function middleware(request: NextRequest) {
  return tracer.startActiveSpan("middleware", async (span) => {
    try {
      const { pathname } = request.nextUrl;

      span.setAttributes({
        "http.method": request.method,
        "http.url": request.url,
        "http.pathname": pathname,
        "http.user_agent": request.headers.get("user-agent") || "unknown",
      });

      /*
       * Playwright starts the dev server and requires a 200 status to
       * begin the tests, so this ensures that the tests can start
       */
      if (pathname.startsWith("/ping")) {
        span.setAttributes({ "middleware.action": "ping" });
        span.setStatus({ code: SpanStatusCode.OK });
        return new Response("pong", { status: 200 });
      }

      if (pathname.startsWith("/api/auth")) {
        span.setAttributes({ "middleware.action": "auth_bypass" });
        span.setStatus({ code: SpanStatusCode.OK });
        return NextResponse.next();
      }

      const token = await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: !isDevelopmentEnvironment,
      });

      if (!token) {
        span.setAttributes({
          "middleware.action": "redirect_to_guest",
          "auth.status": "no_token",
        });

        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Redirecting unauthenticated user to guest auth",
          attributes: { pathname },
        });

        const redirectUrl = encodeURIComponent(request.url);
        span.setStatus({ code: SpanStatusCode.OK });
        return NextResponse.redirect(
          new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
        );
      }

      const isGuest = guestRegex.test(token?.email ?? "");

      span.setAttributes({
        "auth.status": "authenticated",
        "auth.is_guest": isGuest,
        "user.email": token.email || "unknown",
      });

      if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
        span.setAttributes({
          "middleware.action": "redirect_authenticated_user",
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return NextResponse.redirect(new URL("/", request.url));
      }

      span.setAttributes({ "middleware.action": "allow" });
      span.setStatus({ code: SpanStatusCode.OK });
      return NextResponse.next();
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Middleware error",
        attributes: {
          error: (error as Error).message,
          pathname: request.nextUrl.pathname,
        },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
