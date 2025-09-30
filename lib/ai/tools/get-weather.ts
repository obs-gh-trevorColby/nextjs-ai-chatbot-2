import { tool } from "ai";
import { z } from "zod";
import { withSpan } from "@/lib/otel-utils";

export const getWeather = tool({
  description: "Get the current weather at a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  execute: async ({ latitude, longitude }) => {
    return withSpan("ai.tool.getWeather", async (span) => {
      span.setAttributes({
        "tool.name": "getWeather",
        "weather.latitude": latitude,
        "weather.longitude": longitude,
      });

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
      );

      span.setAttributes({
        "http.status_code": response.status,
        "http.url": response.url,
      });

      const weatherData = await response.json();
      return weatherData;
    });
  },
});
