import { destroyEphemeral } from '../src/ephemeral'
import { getMilmoveEphemeralConfig } from '../src/project_config'

async function main() {
  const region = process.env['AWS_REGION']
  if (region === undefined) {
    console.log('Missing AWS_REGION')
    process.exit(1)
  }

  const cfg = getMilmoveEphemeralConfig('destroy', region)

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
