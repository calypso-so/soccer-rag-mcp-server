#!/usr/bin/env node

import "./runtime-polyfills.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import {
  formatUsage,
  parseCliOptions,
  resolveRuntimeConfig,
} from "./config.js";
import { loadRagModelCatalog } from "./models.js";
import { createCalypsoMcpServer } from "./server.js";

type PackageInfo = {
  name: string;
  version: string;
};

const FALLBACK_PACKAGE_INFO: PackageInfo = {
  name: "@calypsohq/soccer-rag-mcp-server",
  version: "0.0.0",
};

async function loadPackageInfo(): Promise<PackageInfo> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const packageJsonContent = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonContent) as Partial<PackageInfo>;

    return {
      name: packageJson.name || FALLBACK_PACKAGE_INFO.name,
      version: packageJson.version || FALLBACK_PACKAGE_INFO.version,
    };
  } catch {
    return FALLBACK_PACKAGE_INFO;
  }
}

// Start the server with stdio transport
async function main() {
  try {
    dotenv.config();

    const packageInfo = await loadPackageInfo();
    const cliOptions = parseCliOptions(process.argv.slice(2));

    if (cliOptions.help) {
      console.log(formatUsage(packageInfo.name));
      process.exit(0);
    }

    if (cliOptions.version) {
      console.log(packageInfo.version);
      process.exit(0);
    }

    const runtimeConfig = resolveRuntimeConfig({
      cli: cliOptions,
      env: process.env,
    });
    const modelCatalog = await loadRagModelCatalog(runtimeConfig);

    const server = createCalypsoMcpServer({
      config: runtimeConfig,
      modelCatalog,
      packageInfo,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      console.error(`Example: npx -y @calypsohq/soccer-rag-mcp-server`);
      console.error("");
      console.error(formatUsage());
    }
    process.exit(1);
  }
}

main();
