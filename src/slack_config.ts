import { verifyRequestSignature } from '@slack/events-api'
import { WebClient, ChatPostMessageArguments } from '@slack/web-api'
import { default as winston } from 'winston'

export type MessageResponse = {
  channel: string
  thread_ts: string
  fallback: string
  markdown: string
}

export type RequestHeaders = {
  [name: string]: string | undefined
}

export type SlackConfig = {
  verifySignature(headers: RequestHeaders, body: string | null): boolean
  sendMarkdownResponse(dResponse: MessageResponse): Promise<boolean>
}

export function getSlackConfig(logger: winston.Logger): Promise<SlackConfig> {
  return new Promise<SlackConfig>((resolve, reject) => {
    if (process.env.SLACK_SIGNING_SECRET === undefined) {
      return reject('SLACK_SIGNING_SECRET is not defined')
    }
    const signingSecret = process.env.SLACK_SIGNING_SECRET
    if (process.env.SLACK_API_TOKEN === undefined) {
      return reject('SLACK_API_TOKEN is not defined')
    }
    const apiToken = process.env.SLACK_API_TOKEN
    logger.debug('Using slack config', {
      signingSecret: signingSecret,
      apiToken: apiToken,
    })
    const cfg: SlackConfig = {
      verifySignature(headers: RequestHeaders, body: string | null): boolean {
        const requestSignature = headers['X-Slack-Signature'] || ''
        const requestTimestamp = parseInt(
          headers['X-Slack-Request-Timestamp'] || '',
          10
        )
        return verifyRequestSignature({
          signingSecret: signingSecret,
          requestSignature: requestSignature,
          requestTimestamp: requestTimestamp,
          body: body || '',
        })
      },
      async sendMarkdownResponse(dResponse: MessageResponse): Promise<boolean> {
        logger.debug('Sending markdown message', dResponse)
        const responseData: ChatPostMessageArguments = {
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
        const webClient = new WebClient(apiToken)
        const response = await webClient.chat.postMessage(responseData)
        return response.ok
      },
    }
    resolve(cfg)
  })
}
