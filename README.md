<a href="https://chat.vercel.ai/">
  <img alt="Next.js 14 and App Router-ready AI chatbot." src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chat SDK</h1>
</a>

<p align="center">
    Chat SDK is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chat-sdk.dev"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports xAI (default), OpenAI, Fireworks, and other model providers
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Auth.js](https://authjs.dev)
  - Simple and secure authentication
- **Observability & Logging**
  - [Observe.com](https://observe.com) integration for comprehensive logging and monitoring
  - OpenTelemetry instrumentation for distributed tracing
  - Structured logging with correlation IDs and trace context
  - Performance monitoring for AI operations, database queries, and API requests

## Model Providers

This template uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access multiple AI models through a unified interface. The default configuration includes [xAI](https://x.ai) models (`grok-2-vision-1212`, `grok-3-mini`) routed through the gateway.

### AI Gateway Authentication

**For Vercel deployments**: Authentication is handled automatically via OIDC tokens.

**For non-Vercel deployments**: You need to provide an AI Gateway API key by setting the `AI_GATEWAY_API_KEY` environment variable in your `.env.local` file.

With the [AI SDK](https://ai-sdk.dev/docs/introduction), you can also switch to direct LLM providers like [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Cohere](https://cohere.com/), and [many more](https://ai-sdk.dev/providers/ai-sdk-providers) with just a few lines of code.

## Observability with Observe.com

This template includes comprehensive observability and logging integration with [Observe.com](https://observe.com), providing deep insights into your AI chatbot's performance, user interactions, and system health.

### Features

- **Structured Logging**: All application events are logged with structured data including correlation IDs, user context, and trace information
- **AI Operation Monitoring**: Detailed logging of AI model interactions, token usage, response times, and performance metrics
- **Database Query Tracking**: Performance monitoring for all database operations with query timing and error tracking
- **Request/Response Tracing**: Complete request lifecycle tracking with middleware instrumentation
- **Error Handling**: Enhanced error logging with stack traces, context, and automatic span correlation
- **OpenTelemetry Integration**: Full distributed tracing support with automatic span creation and correlation

### Setup Instructions

1. **Create an Observe Account**
   - Sign up at [observe.com](https://observe.com)
   - Create a new workspace for your chatbot application

2. **Get Your API Credentials**
   - Navigate to Settings → API Tokens in your Observe workspace
   - Create a new API token with appropriate permissions
   - Note your Observe endpoint URL (typically `https://collect.observeinc.com`)

3. **Configure Environment Variables**

   Add the following variables to your `.env.local` file:

   ```bash
   # Observe.com configuration
   OBSERVE_API_KEY=your_api_key_here
   OBSERVE_ENDPOINT=https://collect.observeinc.com

   # Optional: Service identification
   SERVICE_NAME=ai-chatbot
   SERVICE_VERSION=3.1.0
   ```

4. **Verify Configuration**

   The application will automatically validate your Observe configuration on startup. Check the console for:

   ```
   ✅ Observe configuration is valid and complete
      Service: ai-chatbot v3.1.0
      Environment: production
      Endpoint: https://collect.observeinc.com
   ```

### What Gets Logged

- **Chat Interactions**: User messages, AI responses, model selection, and conversation flow
- **Authentication Events**: Login attempts, session creation, and authorization decisions
- **Database Operations**: Query performance, connection health, and data access patterns
- **AI Model Usage**: Token consumption, response times, model performance, and cost tracking
- **API Requests**: Request/response cycles, status codes, and performance metrics
- **Errors and Exceptions**: Detailed error context, stack traces, and recovery attempts

### Viewing Your Data

Once configured, your data will be available in Observe with:

- **Real-time Dashboards**: Monitor application health, user activity, and AI performance
- **Log Explorer**: Search and filter through structured logs with powerful query capabilities
- **Trace Visualization**: Follow requests through your entire application stack
- **Alerting**: Set up alerts for errors, performance issues, or usage thresholds

### Troubleshooting

**Configuration Issues:**
- Ensure `OBSERVE_API_KEY` and `OBSERVE_ENDPOINT` are both set
- Verify your API key has the correct permissions
- Check that your endpoint URL is correct (no trailing slash)

**No Data Appearing:**
- Confirm your API key is valid and not expired
- Check the application logs for any Observe-related errors
- Verify your network allows outbound HTTPS connections to your Observe endpoint

**Performance Impact:**
- Logging is asynchronous and batched to minimize performance impact
- In production, only INFO level and above are logged by default
- You can adjust log levels via the `NODE_ENV` environment variable

## Deploy Your Own

You can deploy your own version of the Next.js AI Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/nextjs-ai-chatbot)

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Next.js AI Chatbot. It's recommended you use [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables) for this, but a `.env` file is all that is necessary.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various AI and authentication provider accounts.

1. Install Vercel CLI: `npm i -g vercel`
2. Link local instance with Vercel and GitHub accounts (creates `.vercel` directory): `vercel link`
3. Download your environment variables: `vercel env pull`

```bash
pnpm install
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000).
