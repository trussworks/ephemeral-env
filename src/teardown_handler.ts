import { ScheduledEvent, ScheduledHandler } from 'aws-lambda'
import { default as winston } from 'winston'
import { destroyEphemeral } from '../src/ephemeral'

import { getMilmoveEphemeralConfig } from '../src/project_config'

export async function handleEvent(
  logger: winston.Logger,
  event: ScheduledEvent
): Promise<void> {
  logger.info('Tearing down')
  const cfg = getMilmoveEphemeralConfig('destroy', event.region)
  try {
    await destroyEphemeral(cfg)
  } catch (error) {
    logger.error('Error destroying ephemeral envs', error)
  }
}

export const teardownHandler: ScheduledHandler = async (
  event,
  _context,
  _callback
) => {
  const logLevel = process.env.LOG_LEVEL || 'info'
  const logFormat =
    process.env.LOG_FORMAT === 'simple'
      ? winston.format.simple()
      : winston.format.json()
  const logger = winston.createLogger({
    level: logLevel,
    format: logFormat,
    transports: [new winston.transports.Console()],
  })
  winston.add(logger)
  logger.debug('handling event', event)

  await handleEvent(logger, event)
  // scheduled events have no response
}
