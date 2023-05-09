import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda'
import { default as winston } from 'winston'

import { SlackConfig, getSlackConfig, MessageResponse } from './slack_config'
import { getBuildConfig, createBuildToken } from './build_config'
import {
  AllProjectConfig,
  ProjectConfig,
  getProjectConfig,
} from './project_config'
import { BuildConfig } from './ephemeral'

export type AppMentionPayloadEvent = {
  type: string
  user: string
  text: string
  ts: string
  channel: string
  event_ts: string
}

export type AppMentionPayloadRequest = {
  event: AppMentionPayloadEvent
}

function isAppMentionPayloadRequest(e: unknown): e is AppMentionPayloadRequest {
  return (
    e !== null &&
    typeof e === 'object' &&
    'event' in e &&
    e['event'] !== null &&
    typeof e['event'] === 'object' &&
    'type' in e['event'] &&
    e['event']['type'] === 'app_mention' &&
    'user' in e['event'] &&
    'text' in e['event'] &&
    'ts' in e['event'] &&
    'channel' in e['event'] &&
    'event_ts' in e['event']
  )
}

function hasChallengeResponse(
  event: APIGatewayEvent
): APIGatewayProxyResult | undefined {
  const req = JSON.parse(event.body || '{}')
  if (
    'token' in req &&
    'challenge' in req &&
    'type' in req &&
    req['type'] === 'url_verification'
  ) {
    return {
      isBase64Encoded: false,
      statusCode: 200,
      headers: {
        'Content-type': 'application/json',
      },
      body: JSON.stringify({ challenge: req['challenge'] }),
    }
  }
  return undefined
}

type ProjectAndPr = {
  projectName: string
  projectConfig: ProjectConfig
  prNumber: string
}

function getProjectAndPrFromMessage(
  logger: winston.Logger,
  allProjectConfig: AllProjectConfig,
  message: string
): ProjectAndPr | undefined {
  const entries = Object.entries(allProjectConfig)
  return entries
    .map(([key, config]) => {
      const re = new RegExp(config.pull_url_prefix + '/(\\d+)')
      const found = message.match(re)
      logger.debug(
        `finding pr for message '${message}' with re '${re}', found: ${found}`
      )
      if (found != undefined && found.length === 2) {
        return { projectName: key, projectConfig: config, prNumber: found[1] }
      }
      return undefined
    })
    .find(obj => obj !== undefined)
}

async function doDeploy(
  logger: winston.Logger,
  deployCommand: string,
  allProjectConfig: AllProjectConfig,
  buildConfig: BuildConfig,
  buildToken: string
): Promise<string> {
  const foundEntry = getProjectAndPrFromMessage(
    logger,
    allProjectConfig,
    deployCommand
  )
  if (foundEntry === undefined) {
    logger.warn('Did not find project for message', deployCommand)
    return "Sorry, I don't recognize that project URL"
  }
  try {
    await foundEntry.projectConfig.builder(
      buildConfig,
      foundEntry.prNumber,
      buildToken
    )
  } catch (error) {
    winston.log(`Error starting build for ${foundEntry.projectName}`, error)
    return `Error starting build for ${foundEntry.projectName}: ${error}`
  }
  const message = `Starting deploy for ${foundEntry.projectName}`
  logger.warn(message)
  return message
}

function doInfo(
  logger: winston.Logger,
  infoCommand: string,
  allProjectConfig: AllProjectConfig
): string {
  const foundEntry = getProjectAndPrFromMessage(
    logger,
    allProjectConfig,
    infoCommand
  )
  if (foundEntry === undefined) {
    logger.warn('Did not find project for message', infoCommand)
    return "Sorry, I don't recognize that project URL"
  }

  return foundEntry.projectConfig.info(foundEntry.prNumber)
}

export async function respondToEvent(
  slackConfig: SlackConfig,
  buildConfig: BuildConfig,
  allProjectConfig: AllProjectConfig,
  logger: winston.Logger,
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> {
  // will throw if verify fails
  try {
    slackConfig.verifySignature(event.headers, event.body)
  } catch (error) {
    logger.error('Error verifying signature')
    return {
      isBase64Encoded: false,
      statusCode: 401,
      headers: {
        'Content-type': 'application/json',
      },
      body: '{"error":"Unauthorized"}',
    }
  }

  const req = event.body ? JSON.parse(event.body) : {}
  if (!isAppMentionPayloadRequest(req)) {
    logger.error('Request is not app mention request:', req)
    return {
      isBase64Encoded: false,
      statusCode: 400,
      headers: {
        'Content-type': 'application/json',
      },
      body: '{"error":"Invalid Request"}',
    }
  }

  const mentionEvent = req.event

  const helpText =
    "Sorry, I don't understand. " +
    'Try something like "deploy https://github.com/user/project/pull/123"'

  let message: string = helpText
  let markdown: string | undefined = undefined

  const [botUser, command, commandArgs] = mentionEvent.text.split(/\s+/, 3)

  logger.debug('mention parsed', {
    botUser: botUser,
    command: command,
    commandArgs: commandArgs,
  })
  if (command === 'deploy') {
    const buildToken = createBuildToken(mentionEvent.channel, mentionEvent.ts)
    message = await doDeploy(
      logger,
      commandArgs,
      allProjectConfig,
      buildConfig,
      buildToken
    )
  } else if (command === 'info') {
    message = 'info response'
    markdown = doInfo(logger, commandArgs, allProjectConfig)
  } else {
    logger.debug('Unknown command for text', { text: mentionEvent.text })
  }

  if (markdown === undefined) {
    markdown = message
  }
  const messageResponse: MessageResponse = {
    channel: mentionEvent.channel,
    thread_ts: mentionEvent.ts,
    fallback: message,
    markdown: markdown,
  }
  await slackConfig.sendMarkdownResponse(messageResponse)
  return {
    isBase64Encoded: false,
    statusCode: 200,
    headers: {
      'Content-type': 'application/json',
    },
    body: '{"ok":"ok"}',
  }
}

export async function slackHandler(
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> {
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

  try {
    const slackConfig = await getSlackConfig(logger)

    const buildConfig = await getBuildConfig()
    logger.debug('Using build config', buildConfig)

    const challengeResponse = hasChallengeResponse(event)
    if (challengeResponse !== undefined) {
      return challengeResponse
    }

    const allProjectConfig = getProjectConfig()
    logger.debug('Using all project config', allProjectConfig)

    const response = await respondToEvent(
      slackConfig,
      buildConfig,
      allProjectConfig,
      logger,
      event
    )
    logger.debug('lambda response', response)
    return response
  } catch (error) {
    logger.error('Error', error)
    return {
      isBase64Encoded: false,
      statusCode: 500,
      headers: {
        'Content-type': 'application/json',
      },
      body: JSON.stringify({ error: 'error' }),
    }
  }
}
