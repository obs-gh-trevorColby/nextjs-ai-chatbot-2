"use client";

import { useEffect } from "react";

export function OtelClientInit() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Import and initialize client-side OpenTelemetry
      import("../otel-client")
        .then(({ initOtel }) => {
          initOtel();
        })
        .catch((error) => {
          console.error("Failed to initialize OpenTelemetry client:", error);
        });
    }
  }, []);

  return null; // This component doesn't render anything
}
