// Must run before any instrumented module is imported, otherwise
// @opentelemetry/auto-instrumentations-node cannot patch them — hence
// `import './bootstrap'` as the very first statement of `index.ts`.
// This alone is not enough for built-in modules like `http`, though — see
// otel-register.mjs, registered via `--import` in the `start`/`dev` scripts
// and the Dockerfile's `CMD`, for why.
import {
  initObservability,
  isObservabilityConfigured,
  type ObservabilityHandle,
} from '@fohte/service-kit/observability'

export const observability: ObservabilityHandle | undefined =
  isObservabilityConfigured(process.env)
    ? initObservability(process.env)
    : undefined
