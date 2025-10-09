"use client";

import { useEffect } from "react";

export function OtelClientInit() {

  useEffect(() => {
    console.log('OtelClientInit!!!!!!!');
    if (typeof window !== "undefined") {
      console.log('OtelClientInit: window is defined!!!!!!!!');
      // Import and initialize client-side OpenTelemetry
      import("../otel-client").then(({ initOtel }) => {
        initOtel();
      });
    }
  }, []);

  return null; // This component doesn't render anything
}
