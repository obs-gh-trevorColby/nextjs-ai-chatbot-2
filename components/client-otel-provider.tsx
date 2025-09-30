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
      import("../otel-client")
        .then(({ initOtel }) => {
          initOtel();
        })
        .catch((error) => {
          console.warn(
            "Failed to initialize client-side OpenTelemetry:",
            error
          );
        });
    }
  }, []);

  return <>{children}</>;
}
