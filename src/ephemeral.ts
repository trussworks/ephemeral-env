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

export type EphemeralEnvConfig = {
  region: string
  envName: string
  clusterName: string
  subnetIds: string[]
  defaultSecurityGroupId: string
  vpcId: string
  targetContainer: string
  targetPort: number
  healthCheckPath: string
  hostedZoneId: string
  baseDomain: string
  albListenerConfig: AlbListenerConfig
}

export type BuildConfig = {
  region: string
  dockerUsername: string
  dockerPassword: string
}

export type AlbSgConfig = {
  groupId: string
  ownerId: string
}

export type AlbConfig = {
  arn: string
  dnsName: string
  canonicalHostedZoneId: string
}

export type AlbListenerConfig = {
  arn: string
  albListenerArn: string
}

export type AlbAndTgConfig = {
  albConfig: AlbConfig
  tgConfig: TargetGroupConfig
}

export type TargetGroupConfig = {
  arn: string
}

export async function createAlbRule(
  cfg: EphemeralEnvConfig,
  albCfg: AlbListenerConfig
): Promise<AlbAndTgConfig> {
  const elbClient = new ElasticLoadBalancingV2Client({ region: cfg.region })

  const describeCmd = new DescribeLoadBalancersCommand({
    LoadBalancerArns: [albCfg.arn],
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
      Port: cfg.targetPort,
      HealthCheckPort: `${cfg.targetPort}`,
      HealthCheckPath: cfg.healthCheckPath,
      HealthCheckIntervalSeconds: 60,
      HealthCheckTimeoutSeconds: 45,
      HealthyThresholdCount: 2,
      TargetType: 'ip',
      VpcId: cfg.vpcId,
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
    ListenerArn: albCfg.albListenerArn,
    PageSize: 100,
  })

  let priorityCount = 10
  try {
    const rules = await elbClient.send(dRuleCmd)
    if (rules !== undefined && rules.Rules !== undefined) {
      const ruleExists =
        rules.Rules.find(
          (rule) =>
            rule.Conditions !== undefined &&
            rule.Conditions.find(
              (cond) =>
                cond.HostHeaderConfig !== undefined &&
                cond.HostHeaderConfig.Values !== undefined &&
                cond.HostHeaderConfig.Values.includes(`*-${cfg.baseDomain}`)
            )
        ) !== undefined
      if (ruleExists) {
        return Promise.resolve({
          albConfig: albConfig,
          tgConfig: tgConfig,
        })
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
          Values: [`*-${cfg.baseDomain}`],
        },
      },
    ],
    Priority: priorityCount,
    ListenerArn: albCfg.albListenerArn,
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
  return Promise.resolve({
    albConfig: albConfig,
    tgConfig: tgConfig,
  })
}

export async function setupDns(cfg: EphemeralEnvConfig, albCfg: AlbConfig) {
  const client = new Route53Client({ region: cfg.region })

  const names = [
    `my-${cfg.baseDomain}`,
    `admin-${cfg.baseDomain}`,
    `office-${cfg.baseDomain}`,
    `prime-${cfg.baseDomain}`,
  ]

  const changes = names.map((name) => {
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
    HostedZoneId: cfg.hostedZoneId,
    ChangeBatch: {
      Changes: changes,
    },
  })

  console.log('DREW DEBUG rrCmd', JSON.stringify(rrCmd))
  try {
    const rrData = await client.send(rrCmd)
    console.log('rrData', rrData)
    return Promise.resolve(rrData.ChangeInfo?.Status)
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function createEphemeralExistingAlb(
  cfg: EphemeralEnvConfig,
  albListenerCfg: AlbListenerConfig
): Promise<TargetGroupConfig> {
  try {
    const albAndTgConfig = await createAlbRule(cfg, albListenerCfg)
    console.log('albAndTgConfig', albAndTgConfig)
    const rrStatus = await setupDns(cfg, albAndTgConfig.albConfig)
    console.log('rrStatus', rrStatus)
    return Promise.resolve(albAndTgConfig.tgConfig)
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function startMilmoveBuild(
  cfg: BuildConfig,
  pr: string,
  token: string
): Promise<string> {
  const client = new CodeBuildClient({ region: cfg.region })
  const buildCmd = new StartBuildCommand({
    projectName: 'milmove-ephemeral',
    idempotencyToken: token,
    environmentVariablesOverride: [
      {
        name: 'MILMOVE_PR',
        value: pr,
      },
      {
        name: 'DOCKER_USERNAME',
        value: cfg.dockerUsername,
      },
      {
        name: 'DOCKER_PASSWORD',
        value: cfg.dockerPassword,
      },
      {
        name: 'BUILD_TOKEN',
        value: token,
      },
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
      return Promise.reject('Error starting build')
    }
    return Promise.resolve(buildResult.build.arn)
  } catch (error) {
    return Promise.reject(error)
  }
}

export type BuildInfo = {
  prNumber: string
  buildToken: string
}

export function getBuildInfoFromEnvironmentVariables(
  environmentVariables: EnvironmentVariable[]
): BuildInfo | undefined {
  const token = environmentVariables.find((env) => env.name === 'BUILD_TOKEN')
  const prNumber = environmentVariables.find((env) => env.name === 'MILMOVE_PR')
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

function isValidEcsParams(ecsParams: any): ecsParams is EcsParams {
  return (
    ecsParams !== undefined &&
    typeof ecsParams === 'object' &&
    'task_definition' in ecsParams &&
    typeof ecsParams['task_definition'] === 'object'
  )
}

export function runEcsCli(
  cfg: EphemeralEnvConfig,
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
          subnets: cfg.subnetIds,
          security_groups: [cfg.defaultSecurityGroupId],
          assign_public_ip: 'ENABLED',
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
    cfg.clusterName,
    '--launch-type',
    'FARGATE',
    '--timeout',
    '7',
    '--target-groups',
    `targetGroupArn=${tgConfig.arn},containerName=${cfg.targetContainer},containerPort=${cfg.targetPort}`,
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

export async function destroyEphemeralTargetGroups(cfg: EphemeralEnvConfig) {
  const elbClient = new ElasticLoadBalancingV2Client({ region: cfg.region })
  // get all target groups as deleting the ecs service and rule
  // disassociates the target group from the ALB
  const dtgCmd = new DescribeTargetGroupsCommand({})

  const existingTgs = await elbClient.send(dtgCmd)
  const tgArns = existingTgs?.TargetGroups?.map(
    (tg) => tg.TargetGroupArn
  ).filter((arn) => arn != undefined) as string[]
  const dtCmd = new DescribeTagsCommand({
    ResourceArns: tgArns,
  })
  const tgTags = await elbClient.send(dtCmd)
  const ephemeralTgs = tgTags.TagDescriptions?.filter(
    (tg) =>
      tg.Tags !== undefined &&
      tg.Tags.find((tag) => tag.Key === 'ephemeral' && tag.Value === 'true')
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

export async function destroyEphemeralRules(cfg: EphemeralEnvConfig) {
  const elbClient = new ElasticLoadBalancingV2Client({ region: cfg.region })
  const drCmd = new DescribeRulesCommand({
    ListenerArn: cfg.albListenerConfig?.albListenerArn,
  })

  const existingRules = await elbClient.send(drCmd)
  const ruleArns = existingRules.Rules?.map((rule) => rule.RuleArn).filter(
    (arn) => arn != undefined
  ) as string[]
  const dtCmd = new DescribeTagsCommand({
    ResourceArns: ruleArns,
  })
  const ruleTags = await elbClient.send(dtCmd)
  const ephemeralRules = ruleTags.TagDescriptions?.filter(
    (tg) =>
      tg.Tags !== undefined &&
      tg.Tags.find((tag) => tag.Key === 'ephemeral' && tag.Value === 'true')
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

export async function destroyEphemeralServices(cfg: EphemeralEnvConfig) {
  const ecsClient = new ECSClient({ region: cfg.region })

  const lcCmd = new ListClustersCommand({
    maxResults: 100,
  })

  const clusterArns = await ecsClient.send(lcCmd)

  const dcCmd = new DescribeClustersCommand({
    clusters: clusterArns.clusterArns,
  })

  const clusters = await ecsClient.send(dcCmd)

  const ephemeralCluster = clusters.clusters?.find(
    (cluster) => cluster.clusterName === cfg.clusterName
  )

  if (ephemeralCluster === undefined) {
    console.log(`Cannot find ephemeral cluster '${cfg.clusterName}'`)
    return
  }

  const clusterArn = ephemeralCluster.clusterArn

  const dsCmd = new ListServicesCommand({
    cluster: clusterArn,
    maxResults: 100,
  })

  const existingServices = await ecsClient.send(dsCmd)
  const serviceArns = existingServices.serviceArns?.filter(
    (arn) => arn != undefined
  ) as string[]
  if (serviceArns.length === 0) {
    // no services to tear down
    return
  }
  const dtCmd = new DescribeServicesCommand({
    cluster: clusterArn,
    services: serviceArns,
    include: [ServiceField.TAGS],
  })
  const servicesWithTags = await ecsClient.send(dtCmd)
  const ephemeralServices = servicesWithTags.services?.filter(
    (service) =>
      service != undefined &&
      service.tags !== undefined &&
      service.tags.find(
        (tag) => tag.key === 'ephemeral' && tag.value === 'true'
      )
  )
  if (ephemeralServices !== undefined) {
    for (const svc of ephemeralServices) {
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

export async function destroyEphemeral(cfg: EphemeralEnvConfig) {
  await destroyEphemeralServices(cfg)
  await destroyEphemeralRules(cfg)
  await destroyEphemeralTargetGroups(cfg)
}
