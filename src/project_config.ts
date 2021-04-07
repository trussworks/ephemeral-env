import { startMilmoveBuild, EphemeralEnvConfig, BuildConfig } from './ephemeral'
export type ProjectConfig = {
  pull_url_prefix: string
  builder(cfg: BuildConfig, pr: string, token: string): Promise<string>
}
export type AllProjectConfig = {
  [project: string]: ProjectConfig
}
export function getProjectConfig(): AllProjectConfig {
  return {
    milmove: {
      pull_url_prefix: 'https://github.com/transcom/mymove/pull',
      builder: startMilmoveBuild,
    },
  }
}

export function getMilmoveEphemeralConfig(
  envName: string,
  region: string
): EphemeralEnvConfig {
  const envBaseDomain = `${envName}.mymove.sandbox.truss.coffee`
  return {
    envName: envName,
    region: region,
    envBaseDomain: envBaseDomain,
    envDomains: [
      `my-${envBaseDomain}`,
      `admin-${envBaseDomain}`,
      `office-${envBaseDomain}`,
      `prime-${envBaseDomain}`,
    ],
    clusterName: 'milmove-ephemeral',
    subnetIds: [
      'subnet-052eea16e823de366',
      'subnet-04e5f51788abc2ecd',
      'subnet-0705fce7326791dca',
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
