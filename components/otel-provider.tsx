"use client";

import { useEffect } from "react";
import { initOtel } from "@/lib/otel-client";

export function OtelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize OpenTelemetry on the client side
    if (typeof window !== "undefined") {
      try {
        initOtel();
      } catch (error) {
        console.warn("Failed to initialize OpenTelemetry client:", error);
      }
    }
  }, []);

  return <>{children}</>;
}
