import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";
import { trace } from "@opentelemetry/api";

// Get tracer for middleware
const tracer = trace.getTracer("ai-chatbot-middleware", "1.0.0");

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Create span for middleware execution
  const span = tracer.startSpan("middleware", {
    attributes: {
      "http.method": request.method,
      "http.url": request.url,
      "http.route": pathname,
      "user_agent.original": request.headers.get("user-agent") || "",
    },
  });

  try {
    /*
     * Playwright starts the dev server and requires a 200 status to
     * begin the tests, so this ensures that the tests can start
     */
    if (pathname.startsWith("/ping")) {
      span.setAttributes({ "middleware.action": "ping" });
      return new Response("pong", { status: 200 });
    }

    if (pathname.startsWith("/api/auth")) {
      span.setAttributes({ "middleware.action": "auth_bypass" });
      return NextResponse.next();
    }

    span.setAttributes({ "middleware.action": "auth_check" });

    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });

    if (!token) {
      span.setAttributes({
        "middleware.result": "redirect_to_guest",
        "auth.token_present": false,
      });

      const redirectUrl = encodeURIComponent(request.url);
      return NextResponse.redirect(
        new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
      );
    }

    const isGuest = guestRegex.test(token?.email ?? "");

    span.setAttributes({
      "auth.token_present": true,
      "auth.is_guest": isGuest,
      "auth.user_email": token.email || "",
    });

    if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
      span.setAttributes({ "middleware.result": "redirect_to_home" });
      return NextResponse.redirect(new URL("/", request.url));
    }

    span.setAttributes({ "middleware.result": "continue" });
    return NextResponse.next();
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
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
