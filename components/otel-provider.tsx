"use client";

import { useEffect } from "react";

export function OtelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Only initialize on client side
    if (typeof window !== "undefined") {
      import("@/lib/otel-client").then(({ initOtel }) => {
        initOtel();
      });
    }
  }, []);

  return <>{children}</>;
}
