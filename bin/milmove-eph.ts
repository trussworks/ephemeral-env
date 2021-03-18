import * as child from 'child_process'
import { EphemeralEnvConfig, createEphemeral } from '../src/ephemeral'

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
  }

  try {
    const tgConfig = await createEphemeral(cfg)

    process.chdir(ecsCliDeployDir)

    const createClusterCmd = child.spawnSync('ecs-cli', [
      '--launch-type',
      'FARGATE',
      '--region',
      cfg.region,
      '-c',
      cfg.envName,
      '--vpc',
      cfg.vpcId,
      '-subnets',
      cfg.subnetIds.join(','),
    ])
    if (createClusterCmd.error || createClusterCmd.status !== 0) {
      console.log('Failed to run create cluster command')
      console.log('stderr: ', createClusterCmd.stderr.toString())
      console.log('stdout: ', createClusterCmd.stdout.toString())
      process.exit(1)
    }

    const serviceUpCmd = child.spawnSync('ecs-cli', [
      'compose',
      '--file',
      'docker-compose.ecs.yml',
      '--project-name',
      cfg.targetContainer,
      'service',
      'up',
      '--create-log-groups',
      '--cluster',
      cfg.envName,
      '--launch-type',
      'FARGATE',
      '--target-groups',
      `targetGroupArn=${tgConfig.arn},containerName=${cfg.targetContainer},containerPort=${cfg.targetPort}`,
    ])
    if (serviceUpCmd.error || serviceUpCmd.status !== 0) {
      console.log('Failed to run service up command')
      console.log('stderr: ', serviceUpCmd.stderr.toString())
      console.log('stdout: ', serviceUpCmd.stdout.toString())
      process.exit(1)
    }
  } catch (error) {
    console.log('error', error)
  }
}

if (require.main) {
  main()
}
