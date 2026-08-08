// Must run before any instrumented module is imported, otherwise
// @opentelemetry/auto-instrumentations-node cannot patch them — hence
// `import './bootstrap'` as the very first statement of `index.ts`.
// This alone is not enough for built-in modules like `http`, though — the
// `--import @fohte/service-kit/otel-register` flag on the start/dev scripts
// must preload it before this file (or anything else) is imported, or
// `http.Server` is never patched.
import {
  initObservabilityIfConfigured,
  type ObservabilityHandle,
} from '@fohte/service-kit/observability'

import { logger } from '#logger'

// registerSignalHandlers is off because #shutdown owns SIGTERM/SIGINT for the
// whole service and runs this handle's shutdown() as one of its steps.
export const observability: ObservabilityHandle | undefined =
  initObservabilityIfConfigured(process.env, {
    logger,
    registerSignalHandlers: false,
  })
