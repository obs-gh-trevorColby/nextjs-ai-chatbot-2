import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

const tracer = trace.getTracer("ai-chatbot-middleware");

export async function middleware(request: NextRequest) {
  const startTime = Date.now();

  return tracer.startActiveSpan("middleware", async (span) => {
    let logger: any;

    try {
      const { logger: otelLogger } = await import("./otel-server");
      logger = otelLogger;
    } catch (error) {
      // Fallback if otel-server is not available
    }

    const { pathname } = request.nextUrl;

    span.setAttributes({
      "http.method": request.method,
      "http.url": request.url,
      "http.pathname": pathname,
      "http.user_agent": request.headers.get("user-agent") || "",
    });

    try {
      /*
       * Playwright starts the dev server and requires a 200 status to
       * begin the tests, so this ensures that the tests can start
       */
      if (pathname.startsWith("/ping")) {
        span.setAttributes({
          "middleware.action": "ping",
          "response.status": 200,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return new Response("pong", { status: 200 });
      }

      if (pathname.startsWith("/api/auth")) {
        span.setAttributes({
          "middleware.action": "auth_passthrough",
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return NextResponse.next();
      }

      const token = await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: !isDevelopmentEnvironment,
      });

      span.setAttributes({
        "auth.has_token": !!token,
        "auth.user_email": token?.email || "",
      });

      if (!token) {
        const redirectUrl = encodeURIComponent(request.url);

        span.setAttributes({
          "middleware.action": "redirect_to_guest",
          "response.status": 302,
        });

        if (logger) {
          logger.emit({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "Redirecting unauthenticated user to guest auth",
            attributes: {
              pathname,
              redirectUrl,
            },
          });
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return NextResponse.redirect(
          new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
        );
      }

      const isGuest = guestRegex.test(token?.email ?? "");
      span.setAttributes({
        "auth.is_guest": isGuest,
      });

      if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
        span.setAttributes({
          "middleware.action": "redirect_authenticated_user",
          "response.status": 302,
        });

        if (logger) {
          logger.emit({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "Redirecting authenticated user from auth pages",
            attributes: {
              pathname,
              userEmail: token.email,
            },
          });
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return NextResponse.redirect(new URL("/", request.url));
      }

      const duration = Date.now() - startTime;
      span.setAttributes({
        "middleware.action": "continue",
        "request.duration_ms": duration,
      });

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return NextResponse.next();
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);
      span.setAttributes({
        "request.duration_ms": duration,
      });

      if (logger) {
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Middleware error",
          attributes: {
            error: (error as Error).message,
            pathname,
            duration,
          },
        });
      }

      span.end();
      throw error;
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
