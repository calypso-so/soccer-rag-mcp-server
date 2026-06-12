import type { CalypsoRuntimeConfig } from "./config.js";

export type GroundedSourceRef = {
  index?: number;
  label?: string;
  filename?: string;
  snippet?: string;
  quote?: string;
  knowledge_id?: string;
};

export type GroundingSupportRef = {
  support_index?: number;
  chunks?: number[];
  text?: string;
};

export type GroundedRagResponse = {
  text: string;
  responseId: string | null;
  conversationId: string | null;
  sources: string[];
  groundedSources: GroundedSourceRef[];
  groundingSupports: GroundingSupportRef[];
  formattedText: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractAssistantText(
  response: Record<string, unknown>,
  aiCore: Record<string, unknown>,
): string {
  const canonicalText = asString(aiCore.display_text);
  if (canonicalText) {
    return canonicalText;
  }
  const outputText = asString(response.output_text);
  if (outputText) {
    return outputText;
  }

  const output = asArray(response.output);
  return output
    .filter((item) => asRecord(item).type === "message")
    .flatMap((item) => asArray(asRecord(item).content))
    .filter((item) => asRecord(item).type === "output_text")
    .map((item) => asString(asRecord(item).text))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeGroundedSource(
  value: unknown,
  fallbackIndex: number,
): GroundedSourceRef | null {
  const record = asRecord(value);
  const label =
    asString(record.label) ||
    asString(record.filename) ||
    asString(record.title) ||
    asString(record.file_name);
  const snippet =
    asString(record.snippet) ||
    asString(record.quote) ||
    asString(record.text) ||
    asString(record.excerpt);
  if (!label && !snippet) {
    return null;
  }
  return {
    index: typeof record.index === "number" ? record.index : fallbackIndex,
    label: label || `Source ${fallbackIndex}`,
    filename:
      asString(record.filename) || asString(record.file_name) || undefined,
    snippet: snippet || undefined,
    quote: asString(record.quote) || undefined,
    knowledge_id: asString(record.knowledge_id) || undefined,
  };
}

function extractGroundedSources(
  response: Record<string, unknown>,
  aiCore: Record<string, unknown>,
): GroundedSourceRef[] {
  const metadataSources = asArray(aiCore.grounded_sources)
    .map((source, index) => normalizeGroundedSource(source, index + 1))
    .filter((source): source is GroundedSourceRef => Boolean(source));

  const fileSearchSources = asArray(response.output)
    .filter((item) => asRecord(item).type === "file_search_call")
    .flatMap((item) => asArray(asRecord(item).results))
    .map((result, index) =>
      normalizeGroundedSource(
        {
          filename: asRecord(result).filename,
          snippet: asRecord(result).text,
          quote: asRecord(result).text,
        },
        index + 1,
      ),
    )
    .filter((source): source is GroundedSourceRef => Boolean(source));

  const seen = new Set<string>();
  const sources: GroundedSourceRef[] = [];
  for (const source of [...metadataSources, ...fileSearchSources]) {
    const key = [
      source.label || "",
      source.filename || "",
      source.snippet || "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sources.push({ ...source, index: source.index || sources.length + 1 });
  }
  return sources;
}

function extractGroundingSupports(
  aiCore: Record<string, unknown>,
): GroundingSupportRef[] {
  const supports: GroundingSupportRef[] = [];
  for (const [index, support] of asArray(aiCore.grounding_supports).entries()) {
    const record = asRecord(support);
    const chunks = asArray(record.chunks)
      .map((chunk) => Number(chunk))
      .filter((chunk) => Number.isFinite(chunk));
    const text = asString(record.text) || asString(record.segment_text);
    if (!chunks.length && !text) {
      continue;
    }
    supports.push({
      support_index:
        typeof record.support_index === "number"
          ? record.support_index
          : index + 1,
      chunks: chunks.length ? chunks : undefined,
      text: text || undefined,
    });
  }
  return supports;
}

export function parseGroundedRagResponse(
  rawResponse: unknown,
): GroundedRagResponse {
  const response = asRecord(rawResponse);
  const metadata = asRecord(response.metadata);
  const aiCore = asRecord(metadata._aicore);
  const conversation = asRecord(response.conversation);
  const text = extractAssistantText(response, aiCore);
  const groundedSources = extractGroundedSources(response, aiCore);
  const groundingSupports = extractGroundingSupports(aiCore);
  const sources = uniqueStrings(
    groundedSources.map(
      (source) => source.label || source.filename || "Source",
    ),
  );

  return {
    text,
    responseId: asString(response.id) || null,
    conversationId: asString(conversation.id) || null,
    sources,
    groundedSources,
    groundingSupports,
    formattedText: formatGroundedAnswer({
      text,
      sources,
      groundedSources,
      groundingSupports,
    }),
  };
}

export function formatGroundedAnswer(args: {
  text: string;
  sources: string[];
  groundedSources: GroundedSourceRef[];
  groundingSupports: GroundingSupportRef[];
}): string {
  const sections = [args.text.trim() || "No answer text was returned."];

  if (args.groundedSources.length > 0) {
    sections.push("--- Sources ---");
    for (const source of args.groundedSources) {
      const label =
        source.label || source.filename || `Source ${source.index || ""}`;
      const snippet = source.snippet || source.quote;
      sections.push(snippet ? `- ${label}: ${snippet}` : `- ${label}`);
    }
  } else if (args.sources.length > 0) {
    sections.push("--- Sources ---");
    for (const source of args.sources) {
      sections.push(`- ${source}`);
    }
  }

  if (args.groundingSupports.length > 0) {
    sections.push("--- Grounding Supports ---");
    sections.push(JSON.stringify(args.groundingSupports, null, 2));
  }

  return sections.join("\n");
}

function buildApiUrl(
  config: CalypsoRuntimeConfig,
  relativePath: string,
): string {
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return new URL(normalizedPath, `${config.apiBaseUrl}/`).toString();
}

export async function createGroundedRagResponse(args: {
  config: CalypsoRuntimeConfig;
  prompt: string;
  model: string;
  conversationId?: string | null;
  previousResponseId?: string | null;
}): Promise<GroundedRagResponse> {
  const payload: Record<string, unknown> = {
    model: args.model,
    input: [{ type: "input_text", text: args.prompt }],
    stream: false,
    store: true,
    metadata: {
      source: "soccer_rag_mcp_server",
      _aicore: {
        file_input_strategy: "rag_policy",
        response_policy: "fast",
      },
    },
  };

  if (args.previousResponseId) {
    payload.previous_response_id = args.previousResponseId;
  } else if (args.conversationId) {
    payload.conversation = args.conversationId;
  }

  const response = await fetch(buildApiUrl(args.config, "/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.config.effectiveBearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      asString(asRecord(body).detail) ||
      asString(asRecord(body).error) ||
      `Calypso responses request failed with status ${response.status}.`;
    throw new Error(detail);
  }

  return parseGroundedRagResponse(body);
}
