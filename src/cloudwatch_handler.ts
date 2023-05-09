import {
  EventBridgeEvent,
  CodeBuildStateEventDetail,
  CodeBuildCloudWatchStateHandler,
} from 'aws-lambda'
import { default as winston } from 'winston'
import { getBuildInfoFromEnvironmentVariables } from './ephemeral'
import { AllProjectConfig, getProjectConfig } from './project_config'

import { SlackConfig, getSlackConfig } from './slack_config'
import { parseBuildToken } from './build_config'

// create our own type because the exported
// CodeBuildCloudWatchStateEvent has `aws.codebuild` as the literal
// type for `source` instead of `string`
type CodeBuildCloudWatchBuildStateChangeEvent = EventBridgeEvent<
  'CodeBuild Build State Change',
  CodeBuildStateEventDetail
>

export async function handleEvent(
  slackConfig: SlackConfig,
  allProjectConfig: AllProjectConfig,
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
  logger.debug('token info and build status', tokenInfo, {
    buildStatus: buildStatus,
  })
  // HACK: For now hardcode this. In the future, figure it out from
  // build info
  const project = 'milmove'

  const projectConfig = allProjectConfig[project]
  if (projectConfig === undefined) {
    logger.warn(`Cannot get project config for project: '${project}'`)
  }
  if (buildStatus === 'SUCCEEDED') {
    const markdown =
      'Environment is deployed\n' + projectConfig.info(buildInfo.prNumber)
    await slackConfig.sendMarkdownResponse({
      channel: tokenInfo.channel,
      thread_ts: tokenInfo.ts,
      fallback: 'Environment is deployed',
      markdown: markdown,
    })
    logger.debug('Deployed response sent')
  } else {
    await slackConfig.sendMarkdownResponse({
      channel: tokenInfo.channel,
      thread_ts: tokenInfo.ts,
      fallback: 'Deployment problem',
      markdown: `Deployment problem: ${buildStatus}`,
    })
    logger.debug('Problem response sent')
  }
}

export const cloudwatchHandler: CodeBuildCloudWatchStateHandler = async event => {
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
  const slackConfig = await getSlackConfig(logger)
  logger.debug('handling event', event)
  const allProjectConfig = getProjectConfig()

  await handleEvent(slackConfig, allProjectConfig, logger, event)
  // cloudwatch events have no response
}
