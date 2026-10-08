# Releasing aibuddy-mcp

The install docs and the landing page at `/aibuddy-api/mcp` (Denver site) both
tell users to run `npx -y aibuddy-mcp`. That works only once this package is on
npm, so a release is the gate for the page.

## Waiting on the operator

| Needed | Actor | Done-check |
|---|---|---|
| An npm login on the publishing machine | Operator, interactively: `npm login` | `npm whoami` prints a username |

An agent cannot do this step: it needs the account password and 2FA.

## Release steps (after the login)

1. On an up-to-date `main`, from `packages/aibuddy-mcp`:
   `npm publish`. `prepublishOnly` runs the test suite first, so a red tree cannot publish.
2. Verify the published bytes, not the publish command's exit code:
   - `npm view aibuddy-mcp version` prints the `package.json` version.
   - `npx -y aibuddy-mcp models` lists image, video and music models.
3. Release the landing page: ThomasWDev/denvermobileappdeveloper10#3550 is
   held with `HOLD —` in its title. Update its branch, drop the hold, merge,
   deploy, then confirm that `https://denvermobileappdeveloper.com/aibuddy-api/mcp`
   returns 200 (it returns 302 until then).
4. Later releases: bump `version` in `package.json` in the release PR, then repeat steps 1–2.

## Confirming filter after first real use

Inference/v2 Lambda logs carry `User-Agent: AIBuddy-MCP/<version>` for every call
this package makes. A grep for `AIBuddy-MCP` that returns lines means real
traffic is arriving.
