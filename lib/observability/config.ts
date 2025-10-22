import { z } from 'zod';

// Environment configuration schema
const observeConfigSchema = z.object({
  OBSERVE_API_KEY: z.string().min(1, 'OBSERVE_API_KEY is required').optional(),
  OBSERVE_ENDPOINT: z.string().url('OBSERVE_ENDPOINT must be a valid URL').optional(),
  SERVICE_NAME: z.string().min(1, 'SERVICE_NAME is required').default('ai-chatbot'),
  SERVICE_VERSION: z.string().min(1, 'SERVICE_VERSION is required').default('3.1.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

export type ObserveConfig = z.infer<typeof observeConfigSchema>;

// Parse and validate environment configuration
export function parseObserveConfig(): {
  config: ObserveConfig;
  isValid: boolean;
  errors: string[];
} {
  const rawConfig = {
    OBSERVE_API_KEY: process.env.OBSERVE_API_KEY,
    OBSERVE_ENDPOINT: process.env.OBSERVE_ENDPOINT,
    SERVICE_NAME: process.env.SERVICE_NAME,
    SERVICE_VERSION: process.env.SERVICE_VERSION,
    NODE_ENV: process.env.NODE_ENV
  };

  try {
    const config = observeConfigSchema.parse(rawConfig);
    
    // Additional validation for Observe-specific requirements
    const errors: string[] = [];
    
    // If one Observe setting is provided, both should be provided
    if ((config.OBSERVE_API_KEY && !config.OBSERVE_ENDPOINT) || 
        (!config.OBSERVE_API_KEY && config.OBSERVE_ENDPOINT)) {
      errors.push('Both OBSERVE_API_KEY and OBSERVE_ENDPOINT must be provided together');
    }
    
    // Validate API key format (basic check)
    if (config.OBSERVE_API_KEY && config.OBSERVE_API_KEY.length < 10) {
      errors.push('OBSERVE_API_KEY appears to be invalid (too short)');
    }
    
    return {
      config,
      isValid: errors.length === 0,
      errors
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        config: observeConfigSchema.parse({}), // Use defaults
        isValid: false,
        errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      };
    }
    
    return {
      config: observeConfigSchema.parse({}), // Use defaults
      isValid: false,
      errors: ['Unknown configuration error']
    };
  }
}

// Get validated configuration
export function getObserveConfig(): ObserveConfig {
  const { config } = parseObserveConfig();
  return config;
}

// Check if Observe is properly configured
export function isObserveConfigured(): boolean {
  const { config } = parseObserveConfig();
  return !!(config.OBSERVE_API_KEY && config.OBSERVE_ENDPOINT);
}

// Validate configuration and log results
export function validateAndLogConfig(): void {
  const { config, isValid, errors } = parseObserveConfig();
  
  if (isValid && isObserveConfigured()) {
    console.log('✅ Observe configuration is valid and complete');
    console.log(`   Service: ${config.SERVICE_NAME} v${config.SERVICE_VERSION}`);
    console.log(`   Environment: ${config.NODE_ENV}`);
    console.log(`   Endpoint: ${config.OBSERVE_ENDPOINT}`);
  } else if (isValid && !isObserveConfigured()) {
    console.log('⚠️  Observe configuration is valid but incomplete');
    console.log('   Observe logging will be disabled');
    console.log(`   Service: ${config.SERVICE_NAME} v${config.SERVICE_VERSION}`);
    console.log(`   Environment: ${config.NODE_ENV}`);
  } else {
    console.error('❌ Observe configuration has errors:');
    errors.forEach(error => console.error(`   - ${error}`));
  }
}

// Configuration constants
export const OBSERVE_CONFIG = getObserveConfig();
export const IS_OBSERVE_CONFIGURED = isObserveConfigured();

// Export individual config values for convenience
export const {
  OBSERVE_API_KEY,
  OBSERVE_ENDPOINT,
  SERVICE_NAME,
  SERVICE_VERSION,
  NODE_ENV
} = OBSERVE_CONFIG;

// Configuration for different environments
export const getLogLevel = (): string => {
  switch (NODE_ENV) {
    case 'production':
      return 'info';
    case 'test':
      return 'warn';
    case 'development':
    default:
      return 'debug';
  }
};

// Get Observe headers for HTTP requests
export const getObserveHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `${SERVICE_NAME}/${SERVICE_VERSION}`
  };
  
  if (OBSERVE_API_KEY) {
    headers['Authorization'] = `Bearer ${OBSERVE_API_KEY}`;
  }
  
  return headers;
};

// Get service resource attributes for OpenTelemetry
export const getServiceResourceAttributes = () => ({
  'service.name': SERVICE_NAME,
  'service.version': SERVICE_VERSION,
  'service.environment': NODE_ENV,
  'observe.endpoint': OBSERVE_ENDPOINT || 'not-configured'
});

// Startup configuration check
export function performStartupConfigCheck(): void {
  console.log('\n🔍 Checking Observe configuration...');
  validateAndLogConfig();
  console.log('');
}
