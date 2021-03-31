import {
  EphemeralEnvConfig,
  createEphemeralExistingAlb,
  runEcsCli,
} from '../src/ephemeral'

async function main() {
  const region = process.env['AWS_REGION']
  if (region === undefined) {
    console.log('Missing AWS_REGION')
    process.exit(1)
  }
  const envName = process.env['ENV_NAME']
  if (envName === undefined) {
    console.log('Missing ENV_NAME')
    process.exit(1)
  }
  const baseDomain = process.env['REVIEW_BASE_DOMAIN']
  if (baseDomain === undefined) {
    console.log('Missing REVIEW_BASE_DOMAIN')
    process.exit(1)
  }

  const ecsCliDeployDir = process.env['ECS_CLI_DEPLOY_DIR']
  if (ecsCliDeployDir === undefined) {
    console.log('Missing ECS_CLI_DEPLOY_DIR')
    process.exit(1)
  }
  const cfg: EphemeralEnvConfig = {
    envName: envName,
    clusterName: 'milmove-ephemeral',
    region: region,
    baseDomain: baseDomain,
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
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:loadbalancer/app/drewtest/53c202d75f37cd43',
      albListenerArn:
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:listener/app/drewtest/53c202d75f37cd43/e4e4d82a2246ed44',
    },
  }

  try {
    const tgConfig = await createEphemeralExistingAlb(
      cfg,
      cfg.albListenerConfig
    )
    console.log(tgConfig)

    process.chdir(ecsCliDeployDir)

    if (!runEcsCli(cfg, tgConfig)) {
      console.log('ecs-cli error')
      process.exit(1)
    }
  } catch (error) {
    console.log('error', error)
    process.exit(1)
  }
}

if (require.main) {
  main()
}
