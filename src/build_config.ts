import { BuildConfig } from './ephemeral'

export function getBuildConfig(): Promise<BuildConfig> {
  return new Promise<BuildConfig>((resolve, reject) => {
    if (process.env.AWS_REGION === undefined) {
      return reject('AWS_REGION is not defined')
    }
    resolve({
      region: process.env.AWS_REGION,
    })
  })
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
