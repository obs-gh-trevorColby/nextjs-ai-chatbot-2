import type { NextConfig } from "next";

// Regex patterns for webpack externals
const OTEL_INSTRUMENTATION_REGEX = /^@opentelemetry\/instrumentation-/;
const OTEL_NODE_REGEX = /^@opentelemetry\/.*-node$/;
const SERVER_ONLY_MODULES_REGEX = /^(@opentelemetry\/auto-instrumentations-node|@opentelemetry\/sdk-node|@opentelemetry\/exporter-metrics-otlp-http|@grpc\/grpc-js|protobufjs)$/;

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude server-side OpenTelemetry modules from client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        zlib: false,
        http: false,
        https: false,
        url: false,
        util: false,
        os: false,
        path: false,
        child_process: false,
        dns: false,
        events: false,
        buffer: false,
        assert: false,
        constants: false,
        querystring: false,
        timers: false,
      };

      // Exclude server-side OpenTelemetry packages from client bundle
      config.externals = config.externals || [];
      config.externals.push(
        "@opentelemetry/auto-instrumentations-node",
        "@opentelemetry/sdk-node",
        "@opentelemetry/exporter-metrics-otlp-http",
        "@grpc/grpc-js",
        "protobufjs",
        OTEL_INSTRUMENTATION_REGEX,
        OTEL_NODE_REGEX
      );

      // Ignore server-only modules during client build
      const webpack = require("webpack");
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: SERVER_ONLY_MODULES_REGEX,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
