import { teardownEphemeral } from '../src/ephemeral'
import {
  getMilmoveSharedConfig,
  getMilmoveEphemeralConfig,
} from '../src/project_config'

async function main() {
  const region = process.env['AWS_REGION']
  if (region === undefined) {
    console.log('Missing AWS_REGION')
    process.exit(1)
  }

  const sharedCfg = getMilmoveSharedConfig(region)

  try {
    const tgConfig = await teardownEphemeral(
      sharedCfg,
      getMilmoveEphemeralConfig
    )
    console.log(tgConfig)
  } catch (error) {
    console.log('error', error)
    process.exit(1)
  }
}

if (require.main) {
  main()
}
