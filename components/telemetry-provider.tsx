"use client";

import { useEffect } from "react";
import { initializeClientTelemetry } from "@/lib/telemetry/client";

interface TelemetryProviderProps {
  children: React.ReactNode;
}

export function TelemetryProvider({ children }: TelemetryProviderProps) {
  useEffect(() => {
    // Initialize client-side telemetry
    initializeClientTelemetry();
  }, []);

  return <>{children}</>;
}
