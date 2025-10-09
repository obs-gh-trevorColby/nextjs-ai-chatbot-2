"use client";

import { useEffect } from "react";

export function ClientOtelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Import and initialize client-side OpenTelemetry
      import("../otel-client").then(({ initOtel }) => {
        initOtel();
      });
    }
  }, []);

  return <>{children}</>;
}
