# Releasing aibuddy-mcp

Users run it straight from this repository:
`npx -y github:ThomasWDev/aibuddy-mcp`. There is no registry step; the
default branch is what an unpinned install gets, so `main` must stay green.

## Release steps

1. In a PR, bump `version` in `package.json`, run `npm test`, merge.
2. Tag the merge commit and push the tag:
   `git tag v<version> <sha> && git push origin v<version>`.
   Users who pin `github:ThomasWDev/aibuddy-mcp#v<version>` get exactly that.
3. Verify from a clean cache, not your checkout:
   `npm_config_cache=$(mktemp -d) npx -y github:ThomasWDev/aibuddy-mcp#v<version> --version`
   prints the new version, and `... models` lists image, video and music models.

## Confirming real use

Every v2 request the gateway serves writes one line,
`REQUEST_SURFACE endpoint=<route> surface=<client> rid=<id>`
(ThomasWDev/aibuddyapi#3686, live since 2026-10-13). This client sends
`x-client-surface: mcp` from v0.1.1, so its calls read `surface=mcp`. Run this
in CloudWatch Logs Insights on `/aws/lambda/aibuddy-api-production-inference`:

    fields @message
    | filter @message like /REQUEST_SURFACE/
    | parse @message 'surface=* ' as surface
    | stats count(*) by surface

A non-zero `mcp` row means real traffic. Other rows, such as
`external_automation` and `unknown`, are present on any normal day and serve
as the control that the query works.
