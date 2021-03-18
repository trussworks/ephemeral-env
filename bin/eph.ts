import { EphemeralEnvConfig, createEphemeral } from '../src/ephemeral'

async function main() {
  const region = process.env['AWS_REGION'] || 'unknown'
  const cfg: EphemeralEnvConfig = {
    envName: 'ahobson',
    region: region,
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
    await createEphemeral(cfg)
  } catch (error) {
    console.log('error', error)
  }
}

if (require.main) {
  main()
}
