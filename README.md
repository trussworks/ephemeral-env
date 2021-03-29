# ephemeral-env

Tool to create ephemeral envs

## Developer Setup

1. Make sure direnv is installed.
1. Make sure you have nix installed

    nix-env -f ./nix -i

1. Install dependencies

    yarn

## Slack Permissions

### Events

Go to `Event Subscriptions`. Enter the URL from when you deployed via
serverless.

Scroll down to `Subscribe to bot events`. Add `app_mention`.

Click `Save Changes` at the bottom

### Scopes

Go to `OAuth & Permissions` then scroll down to `Scopes`

1. `app_mentions:read`
1. `chat:write`
