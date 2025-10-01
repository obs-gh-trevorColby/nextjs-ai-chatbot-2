import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { createGuestUser, getUser } from "@/lib/db/queries";
import { logger, tracer } from "@/lib/otel-server";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  // biome-ignore lint/nursery/useConsistentTypeDefinitions: "Required"
  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        return tracer.startActiveSpan("auth.credentials", async (span) => {
          try {
            span.setAttributes({
              "auth.provider": "credentials",
              "auth.email": email,
            });

            const users = await getUser(email);

            if (users.length === 0) {
              await compare(password, DUMMY_PASSWORD);

              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: "User not found",
              });

              logger.emit({
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
                body: "Authentication failed - user not found",
                attributes: { email },
              });

              span.end();
              return null;
            }

            const [user] = users;

            if (!user.password) {
              await compare(password, DUMMY_PASSWORD);

              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: "No password set",
              });

              logger.emit({
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
                body: "Authentication failed - no password set",
                attributes: { email, userId: user.id },
              });

              span.end();
              return null;
            }

            const passwordsMatch = await compare(password, user.password);

            if (!passwordsMatch) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: "Invalid password",
              });

              logger.emit({
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
                body: "Authentication failed - invalid password",
                attributes: { email, userId: user.id },
              });

              span.end();
              return null;
            }

            span.setStatus({ code: SpanStatusCode.OK });
            span.setAttributes({
              "user.id": user.id,
              "user.type": "regular",
            });

            logger.emit({
              severityNumber: SeverityNumber.INFO,
              severityText: "INFO",
              body: "User authenticated successfully",
              attributes: { email, userId: user.id, userType: "regular" },
            });

            span.end();
            return { ...user, type: "regular" as UserType };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
            span.recordException(error as Error);

            logger.emit({
              severityNumber: SeverityNumber.ERROR,
              severityText: "ERROR",
              body: "Authentication error",
              attributes: {
                email,
                error: (error as Error).message,
              },
            });

            span.end();
            throw error;
          }
        });
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        return tracer.startActiveSpan("auth.guest", async (span) => {
          try {
            span.setAttributes({
              "auth.provider": "guest",
            });

            const [guestUser] = await createGuestUser();

            span.setStatus({ code: SpanStatusCode.OK });
            span.setAttributes({
              "user.id": guestUser.id,
              "user.type": "guest",
            });

            logger.emit({
              severityNumber: SeverityNumber.INFO,
              severityText: "INFO",
              body: "Guest user created successfully",
              attributes: { userId: guestUser.id, userType: "guest" },
            });

            span.end();
            return { ...guestUser, type: "guest" as UserType };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
            span.recordException(error as Error);

            logger.emit({
              severityNumber: SeverityNumber.ERROR,
              severityText: "ERROR",
              body: "Guest user creation error",
              attributes: {
                error: (error as Error).message,
              },
            });

            span.end();
            throw error;
          }
        });
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
