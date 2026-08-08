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

const levelResult = optionalEnum(process.env, 'LOG_LEVEL', LOG_LEVELS, 'info')

export const logger: Logger = createLogger({
  level: levelResult.unwrapOr('info'),
})

if (levelResult.isErr()) {
  logger.warn({ error: levelResult.error }, 'invalid LOG_LEVEL; using info')
}
