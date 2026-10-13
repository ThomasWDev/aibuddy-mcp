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

## Confirming filter after real use

Inference/v2 Lambda logs carry `User-Agent: AIBuddy-MCP/<version>` for every call
this package makes. A grep for `AIBuddy-MCP` that returns lines means real
traffic is arriving.
