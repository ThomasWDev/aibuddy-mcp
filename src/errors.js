'use strict';

// Bad tool arguments: reported to the agent as an isError result, never a crash.
class ToolInputError extends Error {}

module.exports = { ToolInputError };
