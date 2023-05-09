'use strict'
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
const ssmClient = new SSMClient()

async function getSsm(stage, ssmKey) {
  const name = '/app/reviewappbot/' + stage + '/' + ssmKey
  try {
    const resp = await ssmClient.send(
      new GetParameterCommand({
        Name: name,
        WithDecryption: true,
      })
    )
    if (resp.Parameter && resp.Parameter.Value !== '') {
      return resp.Parameter.Value
    }
  } catch (e) {
    if (e.name === 'InvalidKeyId') {
      console.log(`Unknown ssm key: ${name}`)
    } else if (e.__type === 'ParameterNotFound') {
      console.log(`Unknown ssm key: ${name}`)
    } else {
      console.log(e)
    }
  }
  return undefined
}

module.exports = async ({ options, resolveVariable }) => {
  const stage = await resolveVariable('sls:stage')
  if (stage === 'offline' || stage === 'test') {
    return {
      signingSecret:
        process.env.SLACK_SIGNING_SECRET || 'FAKE_SLACK_SIGNING_SECRET',
      apiToken: process.env.SLACK_API_TOKEN || 'FAKE_SLACK_API_TOKEN',
      slackbotLambdaRole: 'OFFLINE_LAMBDA_ROLE',
    }
  } else {
    return {
      signingSecret:
        process.env.SLACK_SIGNING_SECRET ||
        (await getSsm(stage, 'slack-signing-secret')),
      apiToken:
        process.env.SLACK_API_TOKEN || (await getSsm(stage, 'slack-api-token')),
      slackbotLambdaRole:
        process.env.SLACKBOT_LAMBDA_ROLE ||
        (await getSsm(stage, 'lambda-role')),
    }
  }
}
