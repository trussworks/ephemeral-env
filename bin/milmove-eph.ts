import { createEphemeralExistingAlb, runEcsCli } from '../src/ephemeral'
import { getMilmoveEphemeralConfig } from '../src/project_config'

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
  const ecsCliDeployDir = process.env['ECS_CLI_DEPLOY_DIR']
  if (ecsCliDeployDir === undefined) {
    console.log('Missing ECS_CLI_DEPLOY_DIR')
    process.exit(1)
  }

  const cfg = getMilmoveEphemeralConfig(envName, region)

  try {
    const tgConfig = await createEphemeralExistingAlb(cfg)
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
