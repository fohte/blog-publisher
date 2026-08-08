import { optionalEnum } from '@fohte/service-kit/env'
import {
  createLogger,
  type Logger,
  type LogLevel,
} from '@fohte/service-kit/logger'

const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]

export const logger: Logger = createLogger({
  level: optionalEnum(process.env, 'LOG_LEVEL', LOG_LEVELS, 'info').unwrapOr(
    'info',
  ),
})
