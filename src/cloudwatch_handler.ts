import {
  EventBridgeEvent,
  CodeBuildStateEventDetail,
  CodeBuildCloudWatchStateHandler,
} from 'aws-lambda'
import { default as winston } from 'winston'
import { getBuildInfoFromEnvironmentVariables } from './ephemeral'

import { SlackConfig, getSlackConfig } from './slack_config'
import { parseBuildToken, sendResponse } from './slack_handler'

// create our own type because the exported
// CodeBuildCloudWatchStateEvent has `aws.codebuild` as the literal
// type for `source` instead of `string`
type CodeBuildCloudWatchBuildStateChangeEvent = EventBridgeEvent<
  'CodeBuild Build State Change',
  CodeBuildStateEventDetail
>

export async function handleEvent(
  slackConfig: SlackConfig,
  logger: winston.Logger,
  event: CodeBuildCloudWatchBuildStateChangeEvent
): Promise<void> {
  const envVariables =
    event.detail['additional-information'].environment['environment-variables']
  const buildInfo = getBuildInfoFromEnvironmentVariables(envVariables)
  if (buildInfo === undefined) {
    logger.warn('Cannot get build info', event)
    return
  }

  const tokenInfo = parseBuildToken(buildInfo.buildToken)
  const buildStatus = event.detail['build-status']
  if (buildStatus === 'SUCCEEDED') {
    await sendResponse(slackConfig.apiToken, {
      channel: tokenInfo.channel,
      thread_ts: tokenInfo.ts,
      fallback: 'Environment is deployed',
      markdown: `[Environment is deployed](https://my-milmove-pr-${buildInfo.prNumber}.mymove.sandbox.truss.coffee)`,
    })
  } else {
    await sendResponse(slackConfig.apiToken, {
      channel: tokenInfo.channel,
      thread_ts: tokenInfo.ts,
      fallback: 'Deployment problem',
      markdown: `Deployment problem: ${buildStatus}`,
    })
  }
}

export const cloudwatchHandler: CodeBuildCloudWatchStateHandler = async (
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
