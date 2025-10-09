#!/bin/bash

# Start OpenTelemetry observability stack for local development

echo "🚀 Starting OpenTelemetry observability stack..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Create necessary directories
mkdir -p grafana/provisioning/datasources
mkdir -p grafana/provisioning/dashboards
mkdir -p grafana/dashboards

# Create Grafana datasource configuration
cat > grafana/provisioning/datasources/datasources.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true

  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
EOF

# Create Grafana dashboard configuration
cat > grafana/provisioning/dashboards/dashboards.yml << EOF
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
EOF

# Start the observability stack
echo "📊 Starting observability services..."
docker-compose -f docker-compose.observability.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service health
echo "🔍 Checking service health..."

# Check Jaeger
if curl -s http://localhost:16686/api/services > /dev/null; then
    echo "✅ Jaeger UI: http://localhost:16686"
else
    echo "❌ Jaeger is not responding"
fi

# Check Prometheus
if curl -s http://localhost:9090/-/healthy > /dev/null; then
    echo "✅ Prometheus UI: http://localhost:9090"
else
    echo "❌ Prometheus is not responding"
fi

# Check Grafana
if curl -s http://localhost:3001/api/health > /dev/null; then
    echo "✅ Grafana UI: http://localhost:3001 (admin/admin)"
else
    echo "❌ Grafana is not responding"
fi

# Check OpenTelemetry Collector
if curl -s http://localhost:4318/v1/traces > /dev/null; then
    echo "✅ OTLP HTTP endpoint: http://localhost:4318"
else
    echo "❌ OpenTelemetry Collector is not responding"
fi

echo ""
echo "🎉 Observability stack is ready!"
echo ""
echo "📋 Service URLs:"
echo "   • Jaeger (Tracing): http://localhost:16686"
echo "   • Prometheus (Metrics): http://localhost:9090"
echo "   • Grafana (Dashboards): http://localhost:3001 (admin/admin)"
echo "   • Loki (Logs): http://localhost:3100"
echo ""
echo "🔧 OpenTelemetry Endpoints:"
echo "   • OTLP HTTP: http://localhost:4318"
echo "   • OTLP gRPC: http://localhost:4317"
echo ""
echo "💡 To configure your app, copy .env.telemetry.example to .env.local"
echo "   and set the OTLP endpoints to the URLs above."
echo ""
echo "🛑 To stop the stack: docker-compose -f docker-compose.observability.yml down"
