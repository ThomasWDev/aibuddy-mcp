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

There is no working usage signal yet. The API logs a client's User-Agent only
when it blocks a request as abuse, and spend rows for image, video and music
carry no client surface. ThomasWDev/aibuddyapi#3686 adds an `mcp` surface. Once
that ships and this client sends `x-client-surface: mcp`, run this in
CloudWatch Logs Insights on `/aws/lambda/aibuddy-api-production-inference`:

    filter @message like /PROVIDER_SPEND/ and @message like /surface=mcp/ | stats count(*)

The count should be non-zero after real use. As a control, the same query with
`surface=external_automation` must be non-zero.
