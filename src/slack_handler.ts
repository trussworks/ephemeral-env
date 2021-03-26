import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda'
import { verifyRequestSignature } from '@slack/events-api'
import * as web from '@slack/web-api'
import { default as winston } from 'winston'

import { SlackConfig, getSlackConfig } from './slack_config'
import { getBuildConfig } from './build_config'
import { BuildConfig, startMilmoveBuild } from './ephemeral'

type AppMentionPayloadEvent = {
  type: string
  user: string
  text: string
  ts: string
  channel: string
  event_ts: string
}

type AppMentionPayloadRequest = {
  event: AppMentionPayloadEvent
}

function isAppMentionPayloadRequest(e: any): e is AppMentionPayloadRequest {
  if (
    e != undefined &&
    typeof e === 'object' &&
    'event' in e &&
    typeof e['event'] === 'object'
  ) {
    const event = e['event']
    return (
      'type' in event &&
      event['type'] === 'app_mention' &&
      'user' in event &&
      'text' in event &&
      'ts' in event &&
      'channel' in event &&
      'event_ts' in event
    )
  }
  return false
}

export type MessageResponse = {
  channel: string
  thread_ts: string
  fallback: string
  markdown: string
}

export async function sendResponse(
  apiToken: string,
  dResponse: MessageResponse
) {
  const responseData: web.ChatPostMessageArguments = {
    channel: dResponse.channel,
    thread_ts: dResponse.thread_ts,
    text: dResponse.fallback,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: dResponse.markdown,
        },
      },
    ],
  }
  const webClient = new web.WebClient(apiToken)
  await webClient.chat.postMessage(responseData)
}

function hasChallengeResponse(
  event: APIGatewayProxyEvent
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

export async function respondToEvent(
  slackConfig: SlackConfig,
  buildConfig: BuildConfig,
  logger: winston.Logger,
  event: APIGatewayProxyEvent
): Promise<string | undefined> {
  const requestSignature = event.headers['X-Slack-Signature'] || ''
  const requestTimestamp = parseInt(
    event.headers['X-Slack-Request-Timestamp'] || '',
    10
  )

  // will throw if verify fails
  verifyRequestSignature({
    signingSecret: slackConfig.signingSecret,
    requestSignature: requestSignature,
    requestTimestamp: requestTimestamp,
    body: event.body || '',
  })

  const req = JSON.parse(event.body || '')
  if (!isAppMentionPayloadRequest(req)) {
    logger.error('Request is not app mention request:', req)
    throw new Error('Request is not app mention request')
  }

  const mentionEvent = req.event

  const helpText =
    "Sorry, I don't understand. " +
    'Try something like "deploy https://github.com/user/project/pull/123"'

  const milmoveRegex = new RegExp(
    'deploy\\s+<https://github.com/transcom/mymove/pull/(\\d+)>'
  )
  const found = mentionEvent.text.match(milmoveRegex)
  if (found == undefined || found.length != 2) {
    await sendResponse(slackConfig.apiToken, {
      channel: mentionEvent.channel,
      thread_ts: mentionEvent.ts,
      markdown: helpText,
      fallback: helpText,
    })
    return helpText
  }
  const prNumber = found[1]

  const message = 'Starting deploy'
  const buildToken = createBuildToken(mentionEvent.channel, mentionEvent.ts)
  try {
    startMilmoveBuild(buildConfig, prNumber, buildToken)
  } catch (error) {
    winston.log('Error starting build', error)
    return `Error starting build: ${error}`
  }

  const messageResponse: MessageResponse = {
    channel: mentionEvent.channel,
    thread_ts: mentionEvent.ts,
    fallback: message,
    markdown: message,
  }

  await sendResponse(slackConfig.apiToken, messageResponse)
  return undefined
}

export function createBuildToken(channel: string, ts: string): string {
  return [channel, ts].join('/')
}

export function parseBuildToken(
  token: string
): { channel: string; ts: string } {
  const [channel, ts] = token.split('/')
  return { channel: channel, ts: ts }
}

export const slackHandler: APIGatewayProxyHandler = async (
  event,
  _context,
  callback
): Promise<APIGatewayProxyResult> => {
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
    const slackConfig = await getSlackConfig()
    logger.debug('Using slack config', slackConfig)

    const buildConfig = await getBuildConfig()
    logger.debug('Using build config', buildConfig)

    const challengeResponse = hasChallengeResponse(event)
    if (challengeResponse !== undefined) {
      return challengeResponse
    }
    const responseString = await respondToEvent(
      slackConfig,
      buildConfig,
      logger,
      event
    )
    logger.debug('lambda response', responseString)
    if (responseString !== undefined) {
      return {
        isBase64Encoded: false,
        statusCode: 200,
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({ text: responseString }),
      }
    } else {
      return {
        isBase64Encoded: false,
        statusCode: 200,
        body: '',
      }
    }
  } catch (error) {
    logger.error('Error', error)
    callback(error)
    return {
      isBase64Encoded: false,
      statusCode: 500,
      body: '',
    }
  }
}
