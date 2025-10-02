"use client";

import { useEffect } from "react";
import { initOtelClient } from "@/lib/otel-client";

export function ClientOtelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Initialize OpenTelemetry on the client side
    if (typeof window !== "undefined") {
      try {
        initOtelClient();
      } catch (error) {
        console.warn("Failed to initialize OpenTelemetry client:", error);
      }
    }
  }, []);

  return <>{children}</>;
}
