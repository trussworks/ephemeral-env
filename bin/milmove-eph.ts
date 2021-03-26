import {
  EphemeralEnvConfig,
  //  createEphemeralNewAlb,
  createEphemeralExistingAlb,
  runEcsCli,
} from '../src/ephemeral'

async function doAlbStuff(cfg: EphemeralEnvConfig) {
  if (cfg.albListenerConfig !== undefined) {
    return createEphemeralExistingAlb(cfg, cfg.albListenerConfig)
  } else {
    return Promise.reject('DREW DEBUG SHOULD NOT HAPPEN')
    //return createEphemeralNewAlb(cfg)
  }
}

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
    defaultSecurityGroupId: 'sg-055cf444c5cb816ec',
    certificateArn:
      'arn:aws:acm:us-west-2:004351505091:certificate/22aa8935-d843-4518-a70f-933dd7f1b699',
    targetContainer: 'milmove',
    targetPort: 4000,
    healthCheckPath: '/health',
    hostedZoneId: 'ZF5E6T2ONJR1H',
    albListenerConfig: {
      arn:
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:loadbalancer/app/milmove-one-alb/6c6e765f132b5a3c',
      albListenerArn:
        'arn:aws:elasticloadbalancing:us-west-2:004351505091:listener/app/milmove-one-alb/6c6e765f132b5a3c/c4c6d3077eea76f0',
    },
  }

  try {
    const tgConfig = await doAlbStuff(cfg)
    console.log(tgConfig)

    process.chdir(ecsCliDeployDir)

    // const createClusterCmd = child.spawnSync('ecs-cli', [
    //   'up',
    //   '--force',
    //   '--launch-type',
    //   'FARGATE',
    //   '--region',
    //   cfg.region,
    //   '-c',
    //   cfg.envName,
    //   '--vpc',
    //   cfg.vpcId,
    //   '--subnets',
    //   cfg.subnetIds.join(','),
    //   '--tags',
    //   `ephemeral=true,ephemeralEnvName=${cfg.envName}`,
    // ])
    // if (createClusterCmd.error || createClusterCmd.status !== 0) {
    //   console.log('Failed to run create cluster command')
    //   console.log('stderr: ', createClusterCmd.stderr.toString())
    //   console.log('stdout: ', createClusterCmd.stdout.toString())
    //   process.exit(1)
    // }

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
