import * as child from 'child_process'
import * as yaml from 'js-yaml'
import * as fs from 'fs'

import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeRulesCommand,
  DescribeTagsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'

import {
  ECSClient,
  DeleteServiceCommand,
  DescribeClustersCommand,
  DescribeServicesCommand,
  ListClustersCommand,
  ListServicesCommand,
  UpdateServiceCommand,
  ServiceField,
} from '@aws-sdk/client-ecs'

import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53'

import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  EnvironmentVariable,
} from '@aws-sdk/client-codebuild'

export type EphemeralSharedConfig = {
  region: string
  clusterName: string
  subnetIds: string[]
  defaultSecurityGroupId: string
  vpcId: string
  targetContainer: string
  targetPort: number
  healthCheckPath: string
  hostedZoneId: string
  albArn: string
  albListenerArn: string
}

export type EphemeralEnvConfig = {
  envName: string
  envBaseDomain: string
  envDomains: string[]
}

export type GetEphemeralEnvConfigFunction = (
  envName: string
) => EphemeralEnvConfig

export type BuildConfig = {
  region: string
}

export type AlbConfig = {
  arn: string
  dnsName: string
  canonicalHostedZoneId: string
}

export type AlbAndTgConfig = {
  albConfig: AlbConfig
  tgConfig: TargetGroupConfig
}

export type TargetGroupConfig = {
  arn: string
}

async function findAlb(sharedCfg: EphemeralSharedConfig): Promise<AlbConfig> {
  const elbClient = new ElasticLoadBalancingV2Client({
    region: sharedCfg.region,
  })

  const describeCmd = new DescribeLoadBalancersCommand({
    LoadBalancerArns: [sharedCfg.albArn],
  })

  let albConfig: AlbConfig | undefined

  try {
    const albData = await elbClient.send(describeCmd)
    if (
      albData.LoadBalancers !== undefined &&
      albData.LoadBalancers.length === 1 &&
      albData.LoadBalancers[0].LoadBalancerArn !== undefined &&
      albData.LoadBalancers[0].DNSName !== undefined &&
      albData.LoadBalancers[0].CanonicalHostedZoneId !== undefined
    ) {
      albConfig = {
        arn: albData.LoadBalancers[0].LoadBalancerArn,
        dnsName: albData.LoadBalancers[0].DNSName,
        canonicalHostedZoneId: albData.LoadBalancers[0].CanonicalHostedZoneId,
      }
    }
  } catch (error) {
    console.log('Cannot get Alb Data', error)
    return Promise.reject(error)
  }
  if (albConfig === undefined) {
    return Promise.reject('Cannot get ALB data')
  }

  return Promise.resolve(albConfig)
}

async function createAlbRule(
  cfg: EphemeralEnvConfig,
  sharedCfg: EphemeralSharedConfig
): Promise<AlbAndTgConfig> {
  const albConfig = await findAlb(sharedCfg)

  const elbClient = new ElasticLoadBalancingV2Client({
    region: sharedCfg.region,
  })
  const dtgCmd = new DescribeTargetGroupsCommand({
    Names: [`${cfg.envName}-tg`],
  })

  let tgConfig: TargetGroupConfig | undefined

  try {
    const existingTg = await elbClient.send(dtgCmd)
    if (
      existingTg.TargetGroups !== undefined &&
      existingTg.TargetGroups.length === 1 &&
      existingTg.TargetGroups[0].TargetGroupArn !== undefined
    ) {
      tgConfig = {
        arn: existingTg.TargetGroups[0].TargetGroupArn,
      }
    }
  } catch (error) {
    console.log('Cannot get existing tg', error)
    tgConfig = undefined
  }

  if (tgConfig === undefined) {
    const tgCmd = new CreateTargetGroupCommand({
      Name: `${cfg.envName}-tg`,
      Protocol: 'HTTP',
      Port: sharedCfg.targetPort,
      HealthCheckPort: `${sharedCfg.targetPort}`,
      HealthCheckPath: sharedCfg.healthCheckPath,
      HealthCheckIntervalSeconds: 60,
      HealthCheckTimeoutSeconds: 45,
      HealthyThresholdCount: 2,
      TargetType: 'ip',
      VpcId: sharedCfg.vpcId,
      Tags: [
        { Key: 'ephemeral', Value: 'true' },
        { Key: 'ephemeralEnvName', Value: cfg.envName },
      ],
    })

    try {
      const tgData = await elbClient.send(tgCmd)
      console.log('tgData', tgData)
      if (
        tgData.TargetGroups !== undefined &&
        tgData.TargetGroups.length == 1 &&
        tgData.TargetGroups[0].TargetGroupArn !== undefined
      ) {
        tgConfig = {
          arn: tgData.TargetGroups[0].TargetGroupArn,
        }
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  if (tgConfig === undefined) {
    return Promise.reject('Cannot find or create target group')
  }

  const dRuleCmd = new DescribeRulesCommand({
    ListenerArn: sharedCfg.albListenerArn,
    PageSize: 100,
  })

  let priorityCount = 10
  try {
    const rules = await elbClient.send(dRuleCmd)
    if (rules !== undefined && rules.Rules !== undefined) {
      const ruleExists =
        rules.Rules.find(
          rule =>
            rule.Conditions !== undefined &&
            rule.Conditions.find(
              cond =>
                cond.HostHeaderConfig !== undefined &&
                cond.HostHeaderConfig.Values !== undefined &&
                cond.HostHeaderConfig.Values.includes(`*-${cfg.envBaseDomain}`)
            )
        ) !== undefined
      if (ruleExists) {
        return {
          albConfig: albConfig,
          tgConfig: tgConfig,
        }
      }
      priorityCount += rules.Rules.length
    }
  } catch (error) {
    console.log('Error getting rules', error)
  }

  const ruleCmd = new CreateRuleCommand({
    Actions: [
      {
        Type: 'forward',
        TargetGroupArn: tgConfig.arn,
      },
    ],
    Conditions: [
      {
        Field: 'host-header',
        HostHeaderConfig: {
          Values: [`*-${cfg.envBaseDomain}`],
        },
      },
    ],
    Priority: priorityCount,
    ListenerArn: sharedCfg.albListenerArn,
    Tags: [
      { Key: 'ephemeral', Value: 'true' },
      { Key: 'ephemeralEnvName', Value: cfg.envName },
    ],
  })
  try {
    const lData = await elbClient.send(ruleCmd)
    console.log('lData', lData)
  } catch (error) {
    return Promise.reject(error)
  }
  return {
    albConfig: albConfig,
    tgConfig: tgConfig,
  }
}

export async function setupDns(
  cfg: EphemeralEnvConfig,
  sharedCfg: EphemeralSharedConfig,
  albCfg: AlbConfig
) {
  const client = new Route53Client({ region: sharedCfg.region })

  const changes = cfg.envDomains.map(name => {
    return {
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: name,
        Type: 'A',
        AliasTarget: {
          HostedZoneId: albCfg.canonicalHostedZoneId,
          DNSName: `dualstack.${albCfg.dnsName}`,
          EvaluateTargetHealth: false,
        },
      },
    }
  })

  const rrCmd = new ChangeResourceRecordSetsCommand({
    HostedZoneId: sharedCfg.hostedZoneId,
    ChangeBatch: {
      Changes: changes,
    },
  })

  try {
    const rrData = await client.send(rrCmd)
    console.log('rrData', rrData)
    return rrData.ChangeInfo?.Status
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function createEphemeralExistingAlb(
  cfg: EphemeralEnvConfig,
  sharedCfg: EphemeralSharedConfig
): Promise<TargetGroupConfig> {
  try {
    const albAndTgConfig = await createAlbRule(cfg, sharedCfg)
    console.log('albAndTgConfig', albAndTgConfig)
    const rrStatus = await setupDns(cfg, sharedCfg, albAndTgConfig.albConfig)
    console.log('rrStatus', rrStatus)
    return albAndTgConfig.tgConfig
  } catch (error) {
    return Promise.reject(error)
  }
}
export type BuildInfo = {
  prNumber: string
  buildToken: string
}

export async function startBuild(
  cfg: BuildConfig,
  project: string,
  pr: string,
  token: string
): Promise<string> {
  const client = new CodeBuildClient({ region: cfg.region })
  const buildCmd = new StartBuildCommand({
    projectName: 'milmove-ephemeral',
    idempotencyToken: token,
    environmentVariablesOverride: [
      { name: 'PROJECT', value: project },
      { name: 'ACTION', value: 'build' },
      { name: 'PR', value: pr },
      { name: 'BUILD_TOKEN', value: token },
    ],
  })
  try {
    const buildResult = await client.send(buildCmd)
    console.log('buildResult', buildResult)
    if (
      buildResult === undefined ||
      buildResult.build === undefined ||
      buildResult.build.arn === undefined
    ) {
      return await Promise.reject('Error starting build')
    }
    return buildResult.build.arn
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function startTeardown(
  cfg: BuildConfig,
  project: string
): Promise<string> {
  const client = new CodeBuildClient({ region: cfg.region })
  const buildCmd = new StartBuildCommand({
    projectName: 'milmove-ephemeral',
    environmentVariablesOverride: [
      { name: 'PROJECT', value: project },
      { name: 'ACTION', value: 'teardown' },
    ],
  })
  try {
    const buildResult = await client.send(buildCmd)
    console.log('buildResult', buildResult)
    if (
      buildResult === undefined ||
      buildResult.build === undefined ||
      buildResult.build.arn === undefined
    ) {
      return await Promise.reject('Error starting build')
    }
    return buildResult.build.arn
  } catch (error) {
    return Promise.reject(error)
  }
}

export function getBuildInfoFromEnvironmentVariables(
  environmentVariables: EnvironmentVariable[]
): BuildInfo | undefined {
  const token = environmentVariables.find(env => env.name === 'BUILD_TOKEN')
  const prNumber = environmentVariables.find(env => env.name === 'PR')
  if (
    token === undefined ||
    token.value === undefined ||
    prNumber == undefined ||
    prNumber.value === undefined
  ) {
    return undefined
  }
  return {
    prNumber: prNumber.value,
    buildToken: token.value,
  }
}

export async function getBuildInfo(
  region: string,
  id: string
): Promise<BuildInfo | undefined> {
  const client = new CodeBuildClient({ region: region })
  const getBuildCmd = new BatchGetBuildsCommand({
    ids: [id],
  })
  const builds = await client.send(getBuildCmd)
  if (
    builds !== undefined &&
    builds.builds !== undefined &&
    builds.builds.length === 1 &&
    builds.builds[0].environment !== undefined &&
    builds.builds[0].environment.environmentVariables !== undefined
  ) {
    return getBuildInfoFromEnvironmentVariables(
      builds.builds[0].environment.environmentVariables
    )
  }
}

type TaskDefinition = {
  task_execution_role: string
}

type EcsParams = {
  task_definition: TaskDefinition
  run_params?: object
}

function isValidEcsParams(ecsParams: unknown): ecsParams is EcsParams {
  return (
    ecsParams !== null &&
    typeof ecsParams === 'object' &&
    'task_definition' in ecsParams &&
    typeof ecsParams['task_definition'] === 'object'
  )
}

export function runEcsCli(
  cfg: EphemeralEnvConfig,
  sharedCfg: EphemeralSharedConfig,
  tgConfig: TargetGroupConfig
): boolean {
  try {
    const ecsParams = yaml.load(fs.readFileSync('ecs-params.yml.in', 'utf8'))
    if (!isValidEcsParams(ecsParams)) {
      console.log('ecs-params.yml.in invalid format')
      return false
    }

    ecsParams.task_definition['task_execution_role'] =
      'milmove-ecs-cli-task-role'
    ecsParams['run_params'] = {
      network_configuration: {
        awsvpc_configuration: {
          subnets: sharedCfg.subnetIds,
          security_groups: [sharedCfg.defaultSecurityGroupId],
          assign_public_ip: 'DISABLED',
        },
      },
    }
    fs.writeFileSync('ecs-params.yml', yaml.dump(ecsParams))
  } catch (error) {
    console.log('Cannot read ecs-params.yml.in')
    return false
  }

  const serviceUpCmd = child.spawnSync('ecs-cli', [
    'compose',
    '--file',
    'docker-compose.ecs.yml',
    '--project-name',
    cfg.envName,
    'service',
    'up',
    '--create-log-groups',
    '--force-deployment',
    '--cluster',
    sharedCfg.clusterName,
    '--launch-type',
    'FARGATE',
    '--timeout',
    '7',
    '--target-groups',
    `targetGroupArn=${tgConfig.arn},containerName=${sharedCfg.targetContainer},containerPort=${sharedCfg.targetPort}`,
    '--tags',
    `ephemeral=true,ephemeralEnvName=${cfg.envName}`,
  ])
  if (serviceUpCmd.error || serviceUpCmd.status !== 0) {
    console.log('Failed to run service up command')
    console.log('stderr: ', serviceUpCmd.stderr.toString())
    console.log('stdout: ', serviceUpCmd.stdout.toString())
    return false
  }
  return true
}

export async function destroyEphemeralTargetGroups(
  sharedCfg: EphemeralSharedConfig
) {
  const elbClient = new ElasticLoadBalancingV2Client({
    region: sharedCfg.region,
  })
  // get all target groups as deleting the ecs service and rule
  // disassociates the target group from the ALB
  const dtgCmd = new DescribeTargetGroupsCommand({})

  const existingTgs = await elbClient.send(dtgCmd)
  const allTgArns = existingTgs?.TargetGroups?.map(
    tg => tg.TargetGroupArn
  ).filter(arn => arn != undefined) as string[]

  while (allTgArns.length) {
    // describe tags can have at most 20
    const tgArns = allTgArns.splice(0, 10)

    const dtCmd = new DescribeTagsCommand({
      ResourceArns: tgArns,
    })
    const tgTags = await elbClient.send(dtCmd)
    const ephemeralTgs = tgTags.TagDescriptions?.filter(
      tg =>
        tg.Tags !== undefined &&
        tg.Tags.find(tag => tag.Key === 'ephemeral' && tag.Value === 'true')
    )
    if (ephemeralTgs !== undefined) {
      for (const tg of ephemeralTgs) {
        const dtg = new DeleteTargetGroupCommand({
          TargetGroupArn: tg.ResourceArn,
        })
        await elbClient.send(dtg)
      }
    }
  }
}

export async function destroyEphemeralRules(sharedCfg: EphemeralSharedConfig) {
  const elbClient = new ElasticLoadBalancingV2Client({
    region: sharedCfg.region,
  })
  const drCmd = new DescribeRulesCommand({
    ListenerArn: sharedCfg.albListenerArn,
  })

  const existingRules = await elbClient.send(drCmd)
  const allRuleArns = existingRules.Rules?.map(rule => rule.RuleArn).filter(
    arn => arn != undefined
  ) as string[]

  while (allRuleArns.length) {
    // describe tags can have at most 20
    const ruleArns = allRuleArns.splice(0, 10)
    const dtCmd = new DescribeTagsCommand({
      ResourceArns: ruleArns,
    })

    const ruleTags = await elbClient.send(dtCmd)
    const ephemeralRules = ruleTags.TagDescriptions?.filter(
      tg =>
        tg.Tags !== undefined &&
        tg.Tags.find(tag => tag.Key === 'ephemeral' && tag.Value === 'true')
    )
    if (ephemeralRules !== undefined) {
      for (const rule of ephemeralRules) {
        console.log('deleting rule', rule)
        const drc = new DeleteRuleCommand({
          RuleArn: rule.ResourceArn,
        })
        const r = await elbClient.send(drc)
        console.log('delete rule response', r)
      }
    }
  }
}

export async function destroyDns(
  cfg: EphemeralEnvConfig,
  sharedCfg: EphemeralSharedConfig
) {
  const albCfg = await findAlb(sharedCfg)
  const client = new Route53Client({ region: sharedCfg.region })

  const changes = cfg.envDomains.map(name => {
    return {
      Action: 'DELETE',
      ResourceRecordSet: {
        Name: name,
        Type: 'A',
        AliasTarget: {
          HostedZoneId: albCfg.canonicalHostedZoneId,
          DNSName: `dualstack.${albCfg.dnsName}`,
          EvaluateTargetHealth: false,
        },
      },
    }
  })
  const rrCmd = new ChangeResourceRecordSetsCommand({
    HostedZoneId: sharedCfg.hostedZoneId,
    ChangeBatch: {
      Changes: changes,
    },
  })
  try {
    const rrData = await client.send(rrCmd)
    return rrData.ChangeInfo?.Status
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function destroyEphemeralServices(
  sharedCfg: EphemeralSharedConfig,
  getEphemeralConfig: GetEphemeralEnvConfigFunction
) {
  const ecsClient = new ECSClient({ region: sharedCfg.region })

  const lcCmd = new ListClustersCommand({
    maxResults: 100,
  })

  const clusterArns = await ecsClient.send(lcCmd)

  const dcCmd = new DescribeClustersCommand({
    clusters: clusterArns.clusterArns,
  })

  const clusters = await ecsClient.send(dcCmd)

  const ephemeralCluster = clusters.clusters?.find(
    cluster => cluster.clusterName === sharedCfg.clusterName
  )

  if (ephemeralCluster === undefined) {
    console.log(`Cannot find ephemeral cluster '${sharedCfg.clusterName}'`)
    return
  }

  const clusterArn = ephemeralCluster.clusterArn

  const dsCmd = new ListServicesCommand({
    cluster: clusterArn,
    maxResults: 100,
  })

  const existingServices = await ecsClient.send(dsCmd)
  const allServiceArns = existingServices.serviceArns?.filter(
    arn => arn != undefined
  ) as string[]

  while (allServiceArns.length) {
    // describe services can have at most 10
    const serviceArns = allServiceArns.splice(0, 10)

    const dtCmd = new DescribeServicesCommand({
      cluster: clusterArn,
      services: serviceArns,
      include: [ServiceField.TAGS],
    })
    const servicesWithTags = await ecsClient.send(dtCmd)
    const ephemeralServices = servicesWithTags.services?.filter(
      service =>
        service != undefined &&
        service.tags !== undefined &&
        service.tags.find(
          tag => tag.key === 'ephemeral' && tag.value === 'true'
        )
    )
    if (ephemeralServices !== undefined) {
      for (const svc of ephemeralServices) {
        const envName = svc.tags?.find(tag => tag.key === 'ephemeralEnvName')
          ?.value
        if (envName !== undefined) {
          const envCfg = getEphemeralConfig(envName)
          await destroyDns(envCfg, sharedCfg)
        } else {
          console.warn(`Cannot find envName for service: ${svc}`)
        }
        const updateService = new UpdateServiceCommand({
          cluster: clusterArn,
          service: svc.serviceArn,
          desiredCount: 0,
        })
        await ecsClient.send(updateService)
        const delService = new DeleteServiceCommand({
          cluster: clusterArn,
          service: svc.serviceArn,
        })
        await ecsClient.send(delService)
      }
    }
  }
}

export async function teardownEphemeral(
  sharedCfg: EphemeralSharedConfig,
  getEphemeralConfig: GetEphemeralEnvConfigFunction
) {
  await destroyEphemeralServices(sharedCfg, getEphemeralConfig)
  await destroyEphemeralRules(sharedCfg)
  await destroyEphemeralTargetGroups(sharedCfg)
}
