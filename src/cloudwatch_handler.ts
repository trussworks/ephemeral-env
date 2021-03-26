import {
  CodePipelineCloudWatchEvent,
  CodePipelineCloudWatchStageHandler,
} from 'aws-lambda'
import { default as winston } from 'winston'

import { getBuildInfo } from './ephemeral'
import { SlackConfig, getSlackConfig } from './slack_config'
import { parseBuildToken, sendResponse } from './slack_handler'

export async function handleEvent(
  slackConfig: SlackConfig,
  logger: winston.Logger,
  event: CodePipelineCloudWatchEvent
) {
  if (event.detail.state === 'SUCCEEDED') {
    const id = event.detail['execution-id']
    const buildInfo = await getBuildInfo(event.region, id)
    if (buildInfo === undefined) {
      logger.error(`Cannot find build info for id: ${id}`)
      return
    }
    const tokenInfo = parseBuildToken(buildInfo.buildToken)
    sendResponse(slackConfig.apiToken, {
      channel: tokenInfo.channel,
      thread_ts: tokenInfo.ts,
      fallback: 'Environment is deployed',
      markdown: `[Environment is deployed](https://my-milmove-pr-${buildInfo.prNumber}.mymove.sandbox.truss.coffee)`,
    })
  }
}

export const cloudwatchHandler: CodePipelineCloudWatchStageHandler = async (
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
  const slackConfig = await getSlackConfig()
  logger.debug('Using slack config', slackConfig)
  logger.debug('handling event', event)

  handleEvent(slackConfig, logger, event)
  // cloudwatch events have no response
}
