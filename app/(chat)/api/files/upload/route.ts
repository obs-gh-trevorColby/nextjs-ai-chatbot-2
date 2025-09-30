import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  getUserAttributes,
  logApiRequest,
  logApiResponse,
  withSpan,
} from "@/lib/otel-utils";

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    // Update the file type based on the kind of files you want to accept
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

export async function POST(request: Request) {
  const startTime = Date.now();

  return withSpan(
    "files.upload",
    async (span) => {
      const session = await auth();

      logApiRequest("POST", "/api/files/upload");

      if (!session) {
        logApiResponse(
          "POST",
          "/api/files/upload",
          401,
          Date.now() - startTime
        );
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (request.body === null) {
        logApiResponse(
          "POST",
          "/api/files/upload",
          400,
          Date.now() - startTime,
          session.user?.id
        );
        return new Response("Request body is empty", { status: 400 });
      }

      const userAttributes = getUserAttributes(session);
      span.setAttributes(userAttributes);

      try {
        const formData = await request.formData();
        const file = formData.get("file") as Blob;

        if (!file) {
          logApiResponse(
            "POST",
            "/api/files/upload",
            400,
            Date.now() - startTime,
            session.user?.id
          );
          return NextResponse.json(
            { error: "No file uploaded" },
            { status: 400 }
          );
        }

        const validatedFile = FileSchema.safeParse({ file });

        if (!validatedFile.success) {
          const errorMessage = validatedFile.error.errors
            .map((error) => error.message)
            .join(", ");

          logApiResponse(
            "POST",
            "/api/files/upload",
            400,
            Date.now() - startTime,
            session.user?.id
          );
          return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        // Get filename from formData since Blob doesn't have name property
        const filename = (formData.get("file") as File).name;
        const fileBuffer = await file.arrayBuffer();

        span.setAttributes({
          "file.name": filename,
          "file.size": file.size,
          "file.type": file.type,
        });

        try {
          const data = await put(`${filename}`, fileBuffer, {
            access: "public",
          });

          logApiResponse(
            "POST",
            "/api/files/upload",
            200,
            Date.now() - startTime,
            session.user?.id
          );
          return NextResponse.json(data);
        } catch (_error) {
          logApiResponse(
            "POST",
            "/api/files/upload",
            500,
            Date.now() - startTime,
            session.user?.id
          );
          return NextResponse.json({ error: "Upload failed" }, { status: 500 });
        }
      } catch (_error) {
        logApiResponse(
          "POST",
          "/api/files/upload",
          500,
          Date.now() - startTime,
          session.user?.id
        );
        return NextResponse.json(
          { error: "Failed to process request" },
          { status: 500 }
        );
      }
    },
    {
      "http.method": "POST",
      "http.route": "/api/files/upload",
    }
  );
}
