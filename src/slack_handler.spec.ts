import { APIGatewayProxyEvent } from 'aws-lambda'
import { BuildConfig } from './ephemeral'
import { SlackConfig, RequestHeaders } from './slack_config'
import { AllProjectConfig } from './project_config'
import { respondToEvent, AppMentionPayloadRequest } from './slack_handler'
import { Substitute } from '@fluffy-spoon/substitute'

import * as winston from 'winston'
jest.mock('winston')
const mockedLogger = Substitute.for<winston.Logger>()
const mockSendMarkdownResponse = jest.fn()

const mockMilmoveBuilder = jest.fn()
const fakeAllProjectConfig: AllProjectConfig = {
  milmove: {
    pull_url_prefix: 'https://github.com/transcom/mymove/pull',
    builder: mockMilmoveBuilder,
  },
}
const fakeSlackConfig: SlackConfig = {
  verifySignature(headers: RequestHeaders, body: string | null): boolean {
    if (headers['X-Slack-Test-OK'] !== undefined && body !== null) {
      return true
    }
    throw new Error('Fake Verify Signature Failed')
  },
  sendMarkdownResponse: mockSendMarkdownResponse,
}

const fakeBuildConfig: BuildConfig = {
  region: 'fakeRegion',
  dockerUsername: 'user',
  dockerPassword: 'pass',
}

describe('respondToEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should require authorization', async () => {
    // this fake event is missing auth headers
    const mockEvent = Substitute.for<APIGatewayProxyEvent>()
    mockEvent.headers.returns!({})
    mockEvent.body.returns!(null)

    const response = await respondToEvent(
      fakeSlackConfig,
      fakeBuildConfig,
      fakeAllProjectConfig,
      mockedLogger,
      mockEvent
    )
    expect(response).toEqual({
      isBase64Encoded: false,
      statusCode: 401,
      headers: {
        'Content-type': 'application/json',
      },
      body: '{"error":"Unauthorized"}',
    })
  })

  it('should require a app mention body', async () => {
    const mockEvent = Substitute.for<APIGatewayProxyEvent>()
    mockEvent.headers.returns!({
      'X-Slack-Test-OK': 'true',
    })
    mockEvent.body.returns!(JSON.stringify({ fake: 'thingy' }))

    const response = await respondToEvent(
      fakeSlackConfig,
      fakeBuildConfig,
      fakeAllProjectConfig,
      mockedLogger,
      mockEvent
    )
    expect(response).toEqual({
      isBase64Encoded: false,
      statusCode: 400,
      headers: {
        'Content-type': 'application/json',
      },
      body: '{"error":"Invalid Request"}',
    })
  })

  it('should build matching projects', async () => {
    const mockEvent = Substitute.for<APIGatewayProxyEvent>()
    mockEvent.headers.returns!({
      'X-Slack-Test-OK': 'true',
    })
    const mentionEvent: AppMentionPayloadRequest = {
      event: {
        type: 'app_mention',
        user: 'user',
        text: 'deploy https://github.com/transcom/mymove/pull/123',
        ts: 'fake_ts',
        channel: 'fake_channel',
        event_ts: 'fake_event_ts',
      },
    }
    const fakeBody = JSON.stringify(mentionEvent)
    mockEvent.body.returns!(fakeBody)
    const response = await respondToEvent(
      fakeSlackConfig,
      fakeBuildConfig,
      fakeAllProjectConfig,
      mockedLogger,
      mockEvent
    )
    expect(response).toEqual({
      isBase64Encoded: false,
      statusCode: 200,
      headers: {
        'Content-type': 'application/json',
      },
      body: '{"ok":"ok"}',
    })
    expect(mockSendMarkdownResponse.mock.calls).toEqual([
      [
        {
          channel: mentionEvent.event.channel,
          thread_ts: mentionEvent.event.ts,
          fallback: 'Starting deploy',
          markdown: 'Starting deploy',
        },
      ],
    ])
    expect(mockMilmoveBuilder.mock.calls).toEqual([
      [
        fakeBuildConfig,
        '123',
        `${mentionEvent.event.channel}/${mentionEvent.event.ts}`,
      ],
    ])
  })
})
