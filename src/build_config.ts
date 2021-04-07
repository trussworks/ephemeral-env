import { BuildConfig } from './ephemeral'

export function getBuildConfig(): Promise<BuildConfig> {
  return new Promise<BuildConfig>((resolve, reject) => {
    if (process.env.AWS_REGION === undefined) {
      return reject('AWS_REGION is not defined')
    }
    if (process.env.DOCKER_USERNAME === undefined) {
      return reject('DOCKER_USERNAME is not defined')
    }
    if (process.env.DOCKER_PASSWORD === undefined) {
      return reject('DOCKER_PASSWORD is not defined')
    }
    resolve({
      region: process.env.AWS_REGION,
      dockerUsername: process.env.DOCKER_USERNAME,
      dockerPassword: process.env.DOCKER_PASSWORD,
    })
  })
}

export function parseBuildToken(
  token: string
): { channel: string; ts: string } {
  const [channel, ts] = token.split('/')
  return { channel: channel, ts: ts }
}
