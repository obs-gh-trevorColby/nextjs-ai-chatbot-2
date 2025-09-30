"use client";

import { useEffect } from "react";

export function OtelClientProvider() {
  useEffect(() => {
    // Only initialize in browser environment
    if (typeof window !== "undefined") {
      // Dynamic import to avoid SSR issues
      import("../otel-client")
        .then(({ initOtel }) => {
          initOtel();
        })
        .catch((error) => {
          console.error(
            "Failed to initialize client-side OpenTelemetry:",
            error
          );
        });
    }
  }, []);

  // This component doesn't render anything
  return null;
}
