import { EphemeralEnvConfig, destroyEphemeral } from '../src/ephemeral'

async function main() {
  const region = process.env['AWS_REGION']
  if (region === undefined) {
    console.log('Missing AWS_REGION')
    process.exit(1)
  }
  const cfg: EphemeralEnvConfig = {
    envName: 'destroy',
    clusterName: 'milmove-ephemeral',
    region: region,
    baseDomain: 'destroy',
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
    albListenerConfig: {
      arn:
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:loadbalancer/app/milmove-ephemeral-envs/80873cf1e844f0e7',
      albListenerArn:
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:listener/app/milmove-ephemeral-envs/80873cf1e844f0e7/137da1f108d3511a',
    },
  }

  try {
    const tgConfig = await destroyEphemeral(cfg)
    console.log(tgConfig)
  } catch (error) {
    console.log('error', error)
    process.exit(1)
  }
}

if (require.main) {
  main()
}
