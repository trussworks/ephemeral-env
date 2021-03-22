import {
  ElasticLoadBalancingV2Client,
  CreateListenerCommand,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'

import {
  EC2Client,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  DescribeSecurityGroupsCommandOutput,
} from '@aws-sdk/client-ec2'

import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53'

export type EphemeralEnvConfig = {
  region: string
  envName: string
  subnetIds: string[]
  defaultSecurityGroupId: string
  vpcId: string
  certificateArn: string
  targetContainer: string
  targetPort: number
  healthCheckPath: string
  hostedZoneId: string
  baseDomain: string
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

export type TargetGroupConfig = {
  arn: string
}

export async function createSecurityGroup(
  cfg: EphemeralEnvConfig
): Promise<AlbSgConfig> {
  const client = new EC2Client({ region: cfg.region })
  const createSG = new CreateSecurityGroupCommand({
    GroupName: `${cfg.envName}-lb-sg`,
    Description: `${cfg.envName}-lb-sg`,
    VpcId: cfg.vpcId,
  })
  try {
    const existingDsg = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [cfg.vpcId],
        },
        {
          Name: 'group-name',
          Values: [`${cfg.envName}-lb-sg`],
        },
      ],
    })
    let sgDataWithOwner: DescribeSecurityGroupsCommandOutput | undefined
    try {
      sgDataWithOwner = await client.send(existingDsg)
    } catch (error) {
      console.info('Error finding existing security group, continuing', error)
      sgDataWithOwner = undefined
    }
    if (
      sgDataWithOwner === undefined ||
      sgDataWithOwner.SecurityGroups === undefined ||
      sgDataWithOwner.SecurityGroups.length !== 1 ||
      sgDataWithOwner.SecurityGroups[0].GroupId == undefined ||
      sgDataWithOwner.SecurityGroups[0].OwnerId == undefined
    ) {
      const sgData = await client.send(createSG)
      console.log('sgData', sgData)
      if (sgData.GroupId === undefined) {
        return Promise.reject('Cannot create security group')
      }
      const dsg = new DescribeSecurityGroupsCommand({
        GroupIds: [sgData.GroupId],
      })
      sgDataWithOwner = await client.send(dsg)
      if (
        sgDataWithOwner.SecurityGroups === undefined ||
        sgDataWithOwner.SecurityGroups.length !== 1 ||
        sgDataWithOwner.SecurityGroups[0].GroupId == undefined ||
        sgDataWithOwner.SecurityGroups[0].OwnerId == undefined
      ) {
        return Promise.reject('Cannot find created security group')
      }
    }
    return Promise.resolve({
      groupId: sgDataWithOwner.SecurityGroups[0].GroupId,
      ownerId: sgDataWithOwner.SecurityGroups[0].OwnerId,
    })
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function createALBAndUpdateSG(
  cfg: EphemeralEnvConfig,
  albSgCfg: AlbSgConfig
): Promise<AlbConfig> {
  try {
    const elbClient = new ElasticLoadBalancingV2Client({ region: cfg.region })

    const describeCmd = new DescribeLoadBalancersCommand({
      Names: [`${cfg.envName}-alb`],
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
      console.info('no alb exists, creating')
      albConfig = undefined
    }

    if (albConfig === undefined) {
      const createALB = new CreateLoadBalancerCommand({
        Name: `${cfg.envName}-alb`,
        Subnets: cfg.subnetIds,
        SecurityGroups: [albSgCfg.groupId],
      })
      const albData = await elbClient.send(createALB)
      console.log('albData', albData)
      if (
        albData.LoadBalancers === undefined ||
        albData.LoadBalancers.length != 1 ||
        albData.LoadBalancers[0].LoadBalancerArn === undefined ||
        albData.LoadBalancers[0].DNSName === undefined ||
        albData.LoadBalancers[0].CanonicalHostedZoneId === undefined
      ) {
        return Promise.reject('Cannot create ALB')
      }
      albConfig = {
        arn: albData.LoadBalancers[0].LoadBalancerArn,
        dnsName: albData.LoadBalancers[0].DNSName,
        canonicalHostedZoneId: albData.LoadBalancers[0].CanonicalHostedZoneId,
      }
    }

    const ec2Client = new EC2Client({ region: cfg.region })

    const existingLbIngress = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'group-id',
          Values: [albSgCfg.groupId],
        },
      ],
    })
    let hasLbIngressRule = false
    try {
      const sgDataWithOwner = await ec2Client.send(existingLbIngress)
      console.log('sgdo', sgDataWithOwner)
      if (
        sgDataWithOwner.SecurityGroups !== undefined &&
        sgDataWithOwner.SecurityGroups.length === 1 &&
        sgDataWithOwner.SecurityGroups[0].IpPermissions !== undefined &&
        sgDataWithOwner.SecurityGroups[0].IpPermissions.length == 1
      ) {
        hasLbIngressRule = true
      }
    } catch (error) {
      console.log('error getting lb ingress rule', error)
      hasLbIngressRule = false
    }

    if (hasLbIngressRule) {
      console.log('has existing lb ingress rule')
    } else {
      const inputCmd = new AuthorizeSecurityGroupIngressCommand({
        GroupId: albSgCfg.groupId,
        IpPermissions: [
          {
            IpProtocol: '-1',
            IpRanges: [{ CidrIp: '0.0.0.0/0' }],
          },
        ],
      })
      const lbIngressData = await ec2Client.send(inputCmd)
      console.log('lbIngressData', lbIngressData)
    }

    const existingDefaultIngress = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [cfg.vpcId],
        },
        {
          Name: 'group-id',
          Values: [albSgCfg.groupId],
        },
      ],
    })
    let hasDefaultIngressRule = false
    try {
      const sgDataWithOwner = await ec2Client.send(existingDefaultIngress)
      console.log('sgdo', sgDataWithOwner)
      if (
        sgDataWithOwner.SecurityGroups !== undefined &&
        sgDataWithOwner.SecurityGroups.length === 1
      ) {
        hasDefaultIngressRule = true
      }
    } catch (error) {
      console.log('error getting ingress rule', error)
      hasDefaultIngressRule = false
    }

    if (hasDefaultIngressRule) {
      console.log('has existing default ingress rule')
      return Promise.resolve(albConfig)
    }

    // allow traffic from lb
    const lbInputCmd = new AuthorizeSecurityGroupIngressCommand({
      GroupId: cfg.defaultSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: '-1',
          UserIdGroupPairs: [
            {
              GroupId: albSgCfg.groupId,
              UserId: albSgCfg.ownerId,
            },
          ],
        },
      ],
    })
    const lbData = await ec2Client.send(lbInputCmd)
    console.log('lbData', lbData)
    return Promise.resolve(albConfig)
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function createAlbListener(
  cfg: EphemeralEnvConfig,
  albCfg: AlbConfig
): Promise<TargetGroupConfig> {
  const elbClient = new ElasticLoadBalancingV2Client({ region: cfg.region })

  const dtgCmd = new DescribeTargetGroupsCommand({
    LoadBalancerArn: albCfg.arn,
  })

  try {
    const existingTg = await elbClient.send(dtgCmd)
    if (
      existingTg.TargetGroups !== undefined &&
      existingTg.TargetGroups.length === 1 &&
      existingTg.TargetGroups[0].TargetGroupArn !== undefined
    ) {
      const tgConfig = {
        arn: existingTg.TargetGroups[0].TargetGroupArn,
      }
      console.log('Returning existing TG', tgConfig)
      return Promise.resolve(tgConfig)
    }
  } catch (error) {}

  const tgCmd = new CreateTargetGroupCommand({
    Name: `${cfg.envName}-tg`,
    Protocol: 'HTTP',
    Port: cfg.targetPort,
    HealthCheckPort: `${cfg.targetPort}`,
    HealthCheckPath: cfg.healthCheckPath,
    HealthCheckIntervalSeconds: 90,
    HealthCheckTimeoutSeconds: 60,
    TargetType: 'ip',
    VpcId: cfg.vpcId,
  })

  let tgConfig: TargetGroupConfig | undefined

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

  if (tgConfig === undefined) {
    return Promise.reject('Cannot create target group')
  }

  const listenerCmd = new CreateListenerCommand({
    DefaultActions: [
      {
        Type: 'forward',
        TargetGroupArn: tgConfig.arn,
      },
    ],
    Port: 443,
    Protocol: 'HTTPS',
    LoadBalancerArn: albCfg.arn,
    Certificates: [{ CertificateArn: cfg.certificateArn }],
  })
  try {
    const lData = await elbClient.send(listenerCmd)
    console.log('lData', lData)
  } catch (error) {
    return Promise.reject(error)
  }
  return Promise.resolve(tgConfig)
}

export async function setupDns(cfg: EphemeralEnvConfig, albCfg: AlbConfig) {
  const client = new Route53Client({ region: cfg.region })

  const rrCmd = new ChangeResourceRecordSetsCommand({
    HostedZoneId: cfg.hostedZoneId,
    ChangeBatch: {
      Changes: [
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: `my-${cfg.baseDomain}`,
            Type: 'A',
            AliasTarget: {
              HostedZoneId: albCfg.canonicalHostedZoneId,
              DNSName: `dualstack.${albCfg.dnsName}`,
              EvaluateTargetHealth: false,
            },
          },
        },
      ],
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

export async function createEphemeral(
  cfg: EphemeralEnvConfig
): Promise<TargetGroupConfig> {
  try {
    const sgCfg = await createSecurityGroup(cfg)
    const albConfig = await createALBAndUpdateSG(cfg, sgCfg)
    console.log('albConfig', albConfig)
    const tgConfig = await createAlbListener(cfg, albConfig)
    console.log('tgConfig', tgConfig)
    const rrStatus = await setupDns(cfg, albConfig)
    console.log('rrStatus', rrStatus)
    return Promise.resolve(tgConfig)
  } catch (error) {
    return Promise.reject(error)
  }
}

export async function debug(cfg: EphemeralEnvConfig) {
  const client = new EC2Client({ region: cfg.region })
  const dsg = new DescribeSecurityGroupsCommand({})
  const r = await client.send(dsg)
  console.log(JSON.stringify(r))
}
