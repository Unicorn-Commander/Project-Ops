import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function initializeOpenTelemetry() {
  const otelEnabled = process.env.OTEL_ENABLED === 'true';

  if (!otelEnabled) {
    console.log('OpenTelemetry is disabled');
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'project-ops-backend';
  const jaegerEndpoint = process.env.OTEL_EXPORTER_JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';

  // Configure Jaeger exporter
  const jaegerExporter = new JaegerExporter({
    endpoint: jaegerEndpoint,
  });

  // Configure Prometheus exporter
  const prometheusExporter = new PrometheusExporter(
    {
      port: 9464,
    },
    () => {
      console.log('Prometheus metrics available at http://localhost:9464/metrics');
    },
  );

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    }),
    traceExporter: jaegerExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        // Winston/Bunyan LOG auto-instrumentation hooks the logger and routes
        // emitted records into the OTel logs pipeline. This SDK configures a
        // traceExporter only (no log exporter), so hooked per-request winston +
        // console output is diverted and silently dropped — it never reaches
        // stdout / `docker logs`. (Boot logs, emitted before the hook goes live,
        // still appear — the tell-tale asymmetry that hid auth-gate decisions.)
        // Keep tracing; drop the log hooks so winston's Console transport logs
        // normally. No log exporter is configured, so this loses nothing.
        '@opentelemetry/instrumentation-winston': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-bunyan': {
          enabled: false,
        },
      }),
    ],
  });

  try {
    sdk.start();
    console.log('OpenTelemetry tracing initialized successfully');

    process.on('SIGTERM', () => {
      sdk
        .shutdown()
        .then(() => console.log('OpenTelemetry SDK shut down successfully'))
        .catch((error) => console.log('Error shutting down OpenTelemetry SDK', error))
        .finally(() => process.exit(0));
    });
  } catch (error) {
    console.error('Error initializing OpenTelemetry', error);
  }
}