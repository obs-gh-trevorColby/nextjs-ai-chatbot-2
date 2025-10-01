"use client";

import { useEffect } from "react";
import { initOtel } from "@/lib/otel-client";

export function OtelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize OpenTelemetry on the client side
    if (typeof window !== "undefined") {
      initOtel();
    }
  }, []);

  return <>{children}</>;
}
