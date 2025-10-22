import { tool } from "ai";
import { z } from "zod";
import { createAIInstrumentationLogger } from "../../observability/ai-instrumentation";

export const getWeather = tool({
  description: "Get the current weather at a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  execute: async ({ latitude, longitude }) => {
    const logger = createAIInstrumentationLogger('weather-api', 'weather-query');

    return logger.instrumentAIOperation(
      'weather-query',
      {
        latitude,
        longitude,
        tool: 'get-weather'
      },
      async () => {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
        );

        if (!response.ok) {
          throw new Error(`Weather API request failed: ${response.status} ${response.statusText}`);
        }

        const weatherData = await response.json();
        return weatherData;
      },
      (result) => ({
        // Extract metrics from weather API response
        responseSize: JSON.stringify(result).length
      }),
      (result) => `Weather data for ${latitude}, ${longitude}: ${result.current?.temperature_2m}°C`
    );
  },
});
