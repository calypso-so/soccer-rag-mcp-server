import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILTIN_DEMO_MCP_BEARER,
  CALYPSO_WORLDCUP_MODEL,
  resolveRuntimeConfig,
} from "../dist/config.js";

test("resolveRuntimeConfig defaults to demo auth mode without CALYPSO_API_KEY", () => {
  const config = resolveRuntimeConfig({
    cli: {},
    env: {},
  });

  assert.equal(config.authMode, "demo");
  assert.equal(config.effectiveBearer, BUILTIN_DEMO_MCP_BEARER);
  assert.equal(config.defaultModel, CALYPSO_WORLDCUP_MODEL);
});

test("resolveRuntimeConfig prefers BYOK when CALYPSO_API_KEY is set", () => {
  const config = resolveRuntimeConfig({
    cli: {},
    env: {
      CALYPSO_API_KEY: "sk-project-key",
    },
  });

  assert.equal(config.authMode, "byok");
  assert.equal(config.effectiveBearer, "sk-project-key");
});

test("resolveRuntimeConfig allows demo bearer override", () => {
  const config = resolveRuntimeConfig({
    cli: {},
    env: {
      CALYPSO_DEMO_MCP_BEARER: "sk-demo-mcp-worldcup-custom",
    },
  });

  assert.equal(config.effectiveBearer, "sk-demo-mcp-worldcup-custom");
});
