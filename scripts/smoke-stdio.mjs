import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "dist", "index.js");

const requiredTools = {
  "ask-world-cup-soccer": ["prompt", "model"],
};

const requiredResources = [
  "calypso://server-info",
  "calypso://rag-agent-models",
  "soccer://corpus-info",
  "soccer://starter-prompts",
  "calypso://workflows",
  "calypso://security",
];

const requiredPrompts = [
  "calypso-knowledge-question",
  "calypso-knowledge-ingestion",
  "calypso-reset-conversation",
];

function assertRequiredTools(tools) {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const byokOnlyTools = [
    "calypso-list-knowledge-buckets",
    "calypso-upload-knowledge-file",
    "calypso-upload-knowledge-files-batch",
  ];
  for (const toolName of byokOnlyTools) {
    if (toolNames.has(toolName)) {
      throw new Error(
        `Smoke test failed: demo mode should not advertise BYOK-only tool ${toolName}`,
      );
    }
  }

  for (const [toolName, requiredProperties] of Object.entries(requiredTools)) {
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new Error(
        `Smoke test failed: missing tool registration for ${toolName}`,
      );
    }

    for (const propertyName of requiredProperties) {
      if (!tool.inputSchema?.properties?.[propertyName]) {
        throw new Error(
          `Smoke test failed: ${toolName} is missing inputSchema property ${propertyName}`,
        );
      }
    }
  }
}

function assertRequiredResources(resources) {
  const resourceUris = new Set(resources.map((resource) => resource.uri));
  const missingResources = requiredResources.filter(
    (uri) => !resourceUris.has(uri),
  );
  if (missingResources.length > 0) {
    throw new Error(
      `Smoke test failed: missing resources ${missingResources.join(", ")}`,
    );
  }
}

function assertRequiredPrompts(prompts) {
  const promptNames = new Set(prompts.map((prompt) => prompt.name));
  const missingPrompts = requiredPrompts.filter(
    (promptName) => !promptNames.has(promptName),
  );
  if (missingPrompts.length > 0) {
    throw new Error(
      `Smoke test failed: missing prompts ${missingPrompts.join(", ")}`,
    );
  }
}

function parseJsonTextResource(result, uri) {
  const content = result.contents?.find((item) => item.uri === uri);
  if (!content?.text) {
    throw new Error(`Smoke test failed: ${uri} returned no JSON text content`);
  }
  return JSON.parse(content.text);
}

async function assertDemoServerInfo(client) {
  const result = await client.readResource({ uri: "calypso://server-info" });
  const serverInfo = parseJsonTextResource(result, "calypso://server-info");
  if (serverInfo.authMode !== "demo_mcp") {
    throw new Error(
      `Smoke test failed: expected demo_mcp authMode, got ${serverInfo.authMode}`,
    );
  }
  if (serverInfo.defaultModel !== "calypso-rag-agent:worldcup") {
    throw new Error(
      `Smoke test failed: expected worldcup default model, got ${serverInfo.defaultModel}`,
    );
  }
  if (serverInfo.uploadsEnabled !== false) {
    throw new Error("Smoke test failed: demo mode should disable uploads.");
  }
}

async function main() {
  const client = new Client({
    name: "soccer-rag-mcp-smoke-test",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });

  await client.connect(transport);

  try {
    const toolsResult = await client.listTools();
    assertRequiredTools(toolsResult.tools);

    const resourcesResult = await client.listResources();
    assertRequiredResources(resourcesResult.resources);

    const promptsResult = await client.listPrompts();
    assertRequiredPrompts(promptsResult.prompts);

    await assertDemoServerInfo(client);

    console.log("npm stdio smoke test passed.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
