import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";
import { requestLogger } from "./lib/observability/middleware";
import { nanoid } from "nanoid";
import { trace } from "@opentelemetry/api";

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  const requestId = nanoid();
  const { pathname } = request.nextUrl;

  // Create a span for this middleware execution
  const tracer = trace.getTracer('ai-chatbot-middleware');

  return tracer.startActiveSpan(`middleware-${pathname}`, async (span) => {
    try {
      // Set span attributes
      span.setAttributes({
        'http.method': request.method,
        'http.url': request.url,
        'http.route': pathname,
        'request.id': requestId,
        'user_agent.original': request.headers.get('user-agent') || 'unknown'
      });

      // Log incoming request
      requestLogger.logRequest(request, requestId);

      /*
       * Playwright starts the dev server and requires a 200 status to
       * begin the tests, so this ensures that the tests can start
       */
      if (pathname.startsWith("/ping")) {
        const response = new Response("pong", { status: 200 });
        requestLogger.logResponse(request, NextResponse.json({ message: "pong" }), requestId, startTime);
        return response;
      }

      if (pathname.startsWith("/api/auth")) {
        const response = NextResponse.next();
        requestLogger.logResponse(request, response, requestId, startTime);
        return response;
      }

      const token = await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: !isDevelopmentEnvironment,
      });

      if (!token) {
        span.setAttributes({
          'auth.status': 'unauthenticated',
          'auth.redirect': 'guest'
        });

        const redirectUrl = encodeURIComponent(request.url);
        const response = NextResponse.redirect(
          new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
        );

        requestLogger.logResponse(request, response, requestId, startTime);
        return response;
      }

      const isGuest = guestRegex.test(token?.email ?? "");

      span.setAttributes({
        'auth.status': 'authenticated',
        'auth.user_id': token.sub || 'unknown',
        'auth.email': token.email || 'unknown',
        'auth.is_guest': isGuest
      });

      if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
        span.setAttributes({
          'auth.redirect': 'home'
        });

        const response = NextResponse.redirect(new URL("/", request.url));
        requestLogger.logResponse(request, response, requestId, startTime);
        return response;
      }

      const response = NextResponse.next();

      // Add request ID to response headers for correlation
      response.headers.set('x-request-id', requestId);

      requestLogger.logResponse(request, response, requestId, startTime);
      return response;

    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: 2, // ERROR
        message: (error as Error).message
      });

      // Log error and return next response
      requestLogger.logResponse(
        request,
        NextResponse.next(),
        requestId,
        startTime,
        error as Error
      );

      return NextResponse.next();
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
