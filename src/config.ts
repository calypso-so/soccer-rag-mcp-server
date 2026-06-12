import { z } from "zod";

export const CALYPSO_RAG_AGENT = "calypso-rag-agent";
export const CALYPSO_WORLDCUP_MODEL = "calypso-rag-agent:worldcup";
export const BUILTIN_DEMO_MCP_BEARER =
  "sk-demo-mcp-worldcup-calypso-public-demo-v1";
export const CALYPSO_LIST_KNOWLEDGE_BUCKETS = "calypso-list-knowledge-buckets";
export const CALYPSO_UPLOAD_KNOWLEDGE_FILE = "calypso-upload-knowledge-file";
export const CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH =
  "calypso-upload-knowledge-files-batch";
export const DEFAULT_CALYPSO_API_BASE_URL = "https://api.calypso.so/v1";

export type AuthMode = "byok" | "demo";

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const calypsoConfigSchema = z.object({
  apiKey: optionalString,
  demoMcpBearer: optionalString,
  apiBaseUrl: optionalString
    .pipe(z.string().url().endsWith("/v1").optional())
    .default(DEFAULT_CALYPSO_API_BASE_URL),
});

export type CalypsoRuntimeConfig = z.infer<typeof calypsoConfigSchema> & {
  authMode: AuthMode;
  effectiveBearer: string;
  defaultModel: string;
};

export type CalypsoCliOptions = {
  apiKey?: string;
  demoMcpBearer?: string;
  apiBaseUrl?: string;
  help: boolean;
  version: boolean;
};

const CLI_FLAG_ALIASES: Record<
  string,
  keyof Omit<CalypsoCliOptions, "help" | "version">
> = {
  "api-key": "apiKey",
  "calypso-api-key": "apiKey",
  "demo-mcp-bearer": "demoMcpBearer",
  "calypso-demo-mcp-bearer": "demoMcpBearer",
  "api-base-url": "apiBaseUrl",
  "calypso-api-base-url": "apiBaseUrl",
};

function normalizeOptionalValue(value?: string | null): string | undefined {
  const trimmed = (value || "").trim();
  return trimmed || undefined;
}

function readFlagValue(
  flag: string,
  argv: string[],
  index: number,
): { value?: string; consumedNextArg: boolean } {
  if (flag.includes("=")) {
    const [, rawValue = ""] = flag.split(/=(.*)/s, 2);
    return { value: rawValue, consumedNextArg: false };
  }

  const nextArg = argv[index + 1];
  if (!nextArg || nextArg.startsWith("--")) {
    throw new Error(`Missing value for --${flag.replace(/^--/, "")}`);
  }

  return { value: nextArg, consumedNextArg: true };
}

export function parseCliOptions(argv: string[]): CalypsoCliOptions {
  const options: CalypsoCliOptions = {
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--version" || argument === "-v") {
      options.version = true;
      continue;
    }

    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const normalizedFlag = argument.slice(2).split("=")[0];
    const targetOption = CLI_FLAG_ALIASES[normalizedFlag];
    if (!targetOption) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const { value, consumedNextArg } = readFlagValue(argument, argv, index);
    options[targetOption] = normalizeOptionalValue(value);
    if (consumedNextArg) {
      index += 1;
    }
  }

  return options;
}

export function resolveRuntimeConfig(options: {
  cli: Pick<CalypsoCliOptions, "apiKey" | "demoMcpBearer" | "apiBaseUrl">;
  env: NodeJS.ProcessEnv;
}): CalypsoRuntimeConfig {
  const parsed = calypsoConfigSchema.parse({
    apiKey:
      normalizeOptionalValue(options.cli.apiKey) ??
      normalizeOptionalValue(options.env.CALYPSO_API_KEY),
    demoMcpBearer:
      normalizeOptionalValue(options.cli.demoMcpBearer) ??
      normalizeOptionalValue(options.env.CALYPSO_DEMO_MCP_BEARER) ??
      BUILTIN_DEMO_MCP_BEARER,
    apiBaseUrl:
      normalizeOptionalValue(options.cli.apiBaseUrl) ??
      normalizeOptionalValue(options.env.CALYPSO_API_BASE_URL),
  });

  const authMode: AuthMode = parsed.apiKey ? "byok" : "demo";
  const effectiveBearer =
    parsed.apiKey ?? parsed.demoMcpBearer ?? BUILTIN_DEMO_MCP_BEARER;
  const defaultModel =
    authMode === "demo" ? CALYPSO_WORLDCUP_MODEL : CALYPSO_RAG_AGENT;

  return {
    ...parsed,
    authMode,
    effectiveBearer,
    defaultModel,
  };
}

export function formatUsage(command = "soccer-rag-mcp"): string {
  return [
    `Usage: ${command} [options]`,
    "",
    "Options:",
    "  --api-key <value>           Calypso project API key (optional BYOK override)",
    "  --demo-mcp-bearer <value>   Demo MCP bearer override",
    "  --api-base-url <value>      Calypso OpenAI-compatible base URL (must end in /v1)",
    "  --help                      Show help",
    "  --version                   Show version",
    "",
    "Environment variables:",
    "  CALYPSO_API_KEY             Optional BYOK project key",
    "  CALYPSO_DEMO_MCP_BEARER     Demo MCP bearer (defaults to built-in public token)",
    `  CALYPSO_API_BASE_URL        Optional, defaults to ${DEFAULT_CALYPSO_API_BASE_URL}`,
    "",
    "Zero-config demo mode:",
    `  ${command}`,
    `  Uses ${CALYPSO_WORLDCUP_MODEL} via the public demo MCP bearer.`,
  ].join("\n");
}
