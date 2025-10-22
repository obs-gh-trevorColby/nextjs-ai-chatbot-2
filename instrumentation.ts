import { registerOTel } from "@vercel/otel";
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';

// Environment configuration
const OBSERVE_ENDPOINT = process.env.OBSERVE_ENDPOINT || 'https://collect.observeinc.com';
const OBSERVE_API_KEY = process.env.OBSERVE_API_KEY;
const SERVICE_NAME = process.env.SERVICE_NAME || 'ai-chatbot';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '3.1.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

export function register() {
  // Register Vercel's OpenTelemetry setup (existing)
  registerOTel({ serviceName: SERVICE_NAME });

  // Enhanced OpenTelemetry setup for Observe
  if (OBSERVE_API_KEY && OBSERVE_ENDPOINT) {
    try {
      // Create resource with service information
      const resource = new Resource({
        [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
        [SEMRESATTRS_SERVICE_VERSION]: SERVICE_VERSION,
        'environment': NODE_ENV,
        'observe.endpoint': OBSERVE_ENDPOINT
      });

      // Configure log exporter for Observe
      const logExporter = new OTLPLogExporter({
        url: `${OBSERVE_ENDPOINT}/v1/logs`,
        headers: {
          'Authorization': `Bearer ${OBSERVE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      // Create logger provider
      const loggerProvider = new LoggerProvider({
        resource,
        logRecordProcessors: [
          new BatchLogRecordProcessor(logExporter, {
            maxExportBatchSize: 100,
            maxQueueSize: 1000,
            exportTimeoutMillis: 30000,
            scheduledDelayMillis: 5000
          })
        ]
      });

      // Register the logger provider
      logs.setGlobalLoggerProvider(loggerProvider);

      // Create Node SDK with additional instrumentations
      const sdk = new NodeSDK({
        resource,
        instrumentations: [
          new WinstonInstrumentation({
            // Disable console logging to avoid duplication
            disableConsoleTransport: NODE_ENV === 'production'
          })
        ]
      });

      // Start the SDK
      sdk.start();

      console.log('Observe instrumentation initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize Observe instrumentation:', error);
    }
  } else {
    console.log('Observe instrumentation skipped - missing OBSERVE_API_KEY or OBSERVE_ENDPOINT');
  }
}
