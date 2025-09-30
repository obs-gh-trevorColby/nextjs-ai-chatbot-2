"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";

import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  const tracer = trace.getTracer("auth-actions");
  const logger = logs.getLogger("auth-actions");

  return tracer.startActiveSpan(
    "auth.login",
    async (span): Promise<LoginActionState> => {
      try {
        const email = formData.get("email") as string;

        span.setAttributes({
          "action.name": "login",
          "user.email": email,
        });

        const validatedData = authFormSchema.parse({
          email,
          password: formData.get("password"),
        });

        await signIn("credentials", {
          email: validatedData.email,
          password: validatedData.password,
          redirect: false,
        });

        span.setStatus({ code: SpanStatusCode.OK });
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "User login successful",
          attributes: { email: validatedData.email },
        });

        span.end();
        return { status: "success" };
      } catch (error) {
        if (error instanceof z.ZodError) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Invalid form data",
          });
          logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: "WARN",
            body: "Login failed - invalid data",
            attributes: { error: "validation_error" },
          });
          span.end();
          return { status: "invalid_data" };
        }

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Login failed",
          attributes: { error: (error as Error).message },
        });

        span.end();
        return { status: "failed" };
      }
    }
  );
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }
    await createUser(validatedData.email, validatedData.password);
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
