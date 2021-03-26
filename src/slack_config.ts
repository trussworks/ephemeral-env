export type SlackConfig = {
  signingSecret: string
  apiToken: string
}
export function getSlackConfig(): Promise<SlackConfig> {
  return new Promise<SlackConfig>((resolve, reject) => {
    if (process.env.SLACK_SIGNING_SECRET === undefined) {
      return reject('SLACK_SIGNING_SECRET is not defined')
    }
    if (process.env.SLACK_API_TOKEN === undefined) {
      return reject('SLACK_API_TOKEN is not defined')
    }
    resolve({
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      apiToken: process.env.SLACK_API_TOKEN,
    })
  })
}
