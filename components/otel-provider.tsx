"use client";

import { useEffect } from "react";
import { initOtel } from "@/lib/otel-client";

export function OtelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize OpenTelemetry on the client side
    try {
      initOtel();
    } catch (error) {
      console.error("Failed to initialize OpenTelemetry on client:", error);
    }
  }, []);

  return <>{children}</>;
}
