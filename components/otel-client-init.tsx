"use client";

import { useEffect } from "react";

export function OtelClientInit() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Import and initialize client-side OpenTelemetry
      import("../otel-client").then(({ initOtel }) => {
        initOtel();
      });
    }
  }, []);

  return null; // This component doesn't render anything
}
