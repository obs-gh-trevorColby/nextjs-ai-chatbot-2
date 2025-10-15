"use client";

import { useEffect } from "react";
import { initOtel } from "@/lib/otel-client";

export function ObservabilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Initialize client-side OpenTelemetry
    if (typeof window !== "undefined") {
      try {
        initOtel();
      } catch (error) {
        console.error("Failed to initialize client-side observability:", error);
      }
    }
  }, []);

  return <>{children}</>;
}
