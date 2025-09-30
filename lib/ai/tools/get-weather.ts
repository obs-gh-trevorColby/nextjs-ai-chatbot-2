import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { tool } from "ai";
import { z } from "zod";
import { logger } from "@/otel-server";

export const getWeather = tool({
  description: "Get the current weather at a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  execute: async ({ latitude, longitude }) => {
    const tracer = trace.getTracer("ai-tools");

    return tracer.startActiveSpan("tool.get_weather", async (span) => {
      const startTime = Date.now();

      try {
        span.setAttributes({
          "tool.name": "get_weather",
          "weather.latitude": latitude,
          "weather.longitude": longitude,
        });

        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Weather tool execution started",
          attributes: {
            "tool.name": "get_weather",
            "weather.latitude": latitude,
            "weather.longitude": longitude,
          },
        });

        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
        );

        if (!response.ok) {
          throw new Error(`Weather API request failed: ${response.status}`);
        }

        const weatherData = await response.json();
        const duration = Date.now() - startTime;

        span.setAttributes({
          "tool.duration_ms": duration,
          "weather.temperature": weatherData.current?.temperature_2m,
          "weather.timezone": weatherData.timezone,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Weather tool execution completed",
          attributes: {
            "tool.name": "get_weather",
            "tool.duration_ms": duration,
            "weather.temperature": weatherData.current?.temperature_2m,
            "weather.timezone": weatherData.timezone,
          },
        });

        return weatherData;
      } catch (error) {
        const duration = Date.now() - startTime;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Weather tool execution failed",
          attributes: {
            "tool.name": "get_weather",
            "tool.duration_ms": duration,
            "error.message": (error as Error).message,
          },
        });

        throw error;
      } finally {
        span.end();
      }
    });
  },
});
