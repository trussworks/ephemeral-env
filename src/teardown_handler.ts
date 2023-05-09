import { ScheduledEvent, ScheduledHandler } from 'aws-lambda'
import { default as winston } from 'winston'

import { AllProjectConfig, getProjectConfig } from './project_config'

export async function handleEvent(
  logger: winston.Logger,
  event: ScheduledEvent,
  allProjectConfig: AllProjectConfig
): Promise<void> {
  logger.info('Starting teardown')
  for (const config of Object.values(allProjectConfig)) {
    await config.teardown({ region: event.region })
  }
}

export const teardownHandler: ScheduledHandler = async event => {
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
  const allProjectConfig = getProjectConfig()

  await handleEvent(logger, event, allProjectConfig)
  // scheduled events have no response
}
