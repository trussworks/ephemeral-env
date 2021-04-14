import {
  EphemeralEnvConfig,
  EphemeralSharedConfig,
  BuildConfig,
  startBuild,
  startTeardown,
} from './ephemeral'
export type ProjectConfig = {
  pull_url_prefix: string
  builder(cfg: BuildConfig, pr: string, token: string): Promise<string>
  info(pr: string): string
  teardown(cfg: BuildConfig): Promise<string>
}
export type AllProjectConfig = {
  [project: string]: ProjectConfig
}
export function getProjectConfig(): AllProjectConfig {
  return {
    milmove: {
      pull_url_prefix: 'https://github.com/transcom/mymove/pull',
      builder: startMilmoveBuild,
      info: infoForMilmoveDeploy,
      teardown: startMilmoveTeardown,
    },
  }
}

// return markdown info for the deploy
export function infoForMilmoveDeploy(pr: string): string {
  const envName = `milmove-pr-${pr}`
  const cfg = getMilmoveEphemeralConfig(envName)
  // seems that slack doesn't support list syntax in app-published
  // text
  // https://api.slack.com/reference/surfaces/formatting#block-formatting__lists
  return cfg.envDomains.map(envDom => `• <https://${envDom}>`).join('\n')
}

export function getMilmoveSharedConfig(region: string): EphemeralSharedConfig {
  return {
    region: region,
    clusterName: 'milmove-ephemeral',
    subnetIds: [
      // these are the new private subnets
      'subnet-0d29ef4d8ccfe1c5e',
      'subnet-0cca6a5a2edd62865',
      'subnet-017c11064475ac7ff',
      // these are the old public subnets
      // 'subnet-052eea16e823de366',
      // 'subnet-04e5f51788abc2ecd',
      // 'subnet-0705fce7326791dca',
    ],
    vpcId: 'vpc-0d454e20ab91056a7',
    defaultSecurityGroupId: 'sg-0b5c48586b23673c6',
    targetContainer: 'milmove',
    targetPort: 4000,
    healthCheckPath: '/health',
    hostedZoneId: 'ZF5E6T2ONJR1H',
    albArn:
      'arn:aws:elasticloadbalancing:us-west-2:004351505091:loadbalancer/app/milmove-ephemeral-envs/80873cf1e844f0e7',
    albListenerArn:
      'arn:aws:elasticloadbalancing:us-west-2:004351505091:listener/app/milmove-ephemeral-envs/80873cf1e844f0e7/137da1f108d3511a',
  }
}

export function getMilmoveEphemeralConfig(envName: string): EphemeralEnvConfig {
  const envBaseDomain = `${envName}.mymove.sandbox.truss.coffee`
  return {
    envName: envName,
    envBaseDomain: envBaseDomain,
    envDomains: [
      `my-${envBaseDomain}`,
      `admin-${envBaseDomain}`,
      `office-${envBaseDomain}`,
      `prime-${envBaseDomain}`,
    ],
  }
}

export async function startMilmoveTeardown(cfg: BuildConfig): Promise<string> {
  return startTeardown(cfg, 'milmove')
}

export async function startMilmoveBuild(
  cfg: BuildConfig,
  pr: string,
  token: string
): Promise<string> {
  return startBuild(cfg, 'milmove', pr, token)
}
