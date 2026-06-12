import {
  CALYPSO_RAG_AGENT,
  CALYPSO_WORLDCUP_MODEL,
  type CalypsoRuntimeConfig,
} from "./config.js";

export type CalypsoRagModelDescriptor = {
  id: string;
  base_model?: string;
  profile_id?: string | null;
  source?: string;
  enabled?: boolean;
  bucket_ids: string[];
  buckets: CalypsoRagBucketDescriptor[];
  missing_bucket_ids: string[];
};

export type CalypsoRagBucketDescriptor = {
  id: string;
  name?: string;
  slug?: string;
  status?: string;
  member_count?: number;
};

export type CalypsoRagModelCatalog = {
  models: CalypsoRagModelDescriptor[];
  defaultModel: string;
  fetchedAt: string | null;
  source: "api" | "fallback";
  error?: string;
};

type RagAgentModelsResponse = {
  object?: string;
  data?: unknown;
};

const DISCOVERY_TIMEOUT_MS = 2000;

export function fallbackRagModelCatalog(
  error?: unknown,
  options?: { demoMode?: boolean },
): CalypsoRagModelCatalog {
  const demoMode = options?.demoMode === true;
  const defaultModel = demoMode ? CALYPSO_WORLDCUP_MODEL : CALYPSO_RAG_AGENT;
  return {
    models: [
      {
        id: defaultModel,
        base_model: CALYPSO_RAG_AGENT,
        profile_id: demoMode ? "worldcup" : null,
        source: demoMode ? "named_profile" : "default_policy",
        enabled: true,
        bucket_ids: [],
        buckets: [],
        missing_bucket_ids: [],
      },
    ],
    defaultModel,
    fetchedAt: null,
    source: "fallback",
    error:
      error instanceof Error
        ? error.message
        : error
          ? String(error)
          : undefined,
  };
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

function normalizeModelDescriptor(
  value: unknown,
): CalypsoRagModelDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    base_model:
      typeof raw.base_model === "string" && raw.base_model.trim()
        ? raw.base_model.trim()
        : undefined,
    profile_id:
      typeof raw.profile_id === "string" && raw.profile_id.trim()
        ? raw.profile_id.trim()
        : raw.profile_id === null
          ? null
          : undefined,
    source:
      typeof raw.source === "string" && raw.source.trim()
        ? raw.source.trim()
        : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    bucket_ids: normalizeStringArray(raw.bucket_ids),
    buckets: normalizeBuckets(raw.buckets),
    missing_bucket_ids: normalizeStringArray(raw.missing_bucket_ids),
  };
}

function normalizeStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeBuckets(value: unknown): CalypsoRagBucketDescriptor[] {
  const buckets = Array.isArray(value) ? value : [];
  return buckets
    .map(normalizeBucket)
    .filter((bucket): bucket is CalypsoRagBucketDescriptor => Boolean(bucket));
}

function normalizeBucket(value: unknown): CalypsoRagBucketDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : undefined,
    slug:
      typeof raw.slug === "string" && raw.slug.trim()
        ? raw.slug.trim()
        : undefined,
    status:
      typeof raw.status === "string" && raw.status.trim()
        ? raw.status.trim()
        : undefined,
    member_count:
      typeof raw.member_count === "number" ? raw.member_count : undefined,
  };
}

function normalizeCatalog(
  response: RagAgentModelsResponse,
  options?: { demoMode?: boolean },
): CalypsoRagModelCatalog {
  const demoMode = options?.demoMode === true;
  const data = Array.isArray(response.data) ? response.data : [];
  const seen = new Set<string>();
  let models = data
    .map(normalizeModelDescriptor)
    .filter((model): model is CalypsoRagModelDescriptor => Boolean(model))
    .filter((model) => !demoMode || model.id === CALYPSO_WORLDCUP_MODEL)
    .filter((model) => {
      if (seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });

  if (
    demoMode &&
    !models.some((model) => model.id === CALYPSO_WORLDCUP_MODEL)
  ) {
    models = fallbackRagModelCatalog(undefined, { demoMode: true }).models;
  }

  if (!demoMode && !models.some((model) => model.id === CALYPSO_RAG_AGENT)) {
    models.unshift({
      id: CALYPSO_RAG_AGENT,
      base_model: CALYPSO_RAG_AGENT,
      profile_id: null,
      source: "default_policy",
      enabled: true,
      bucket_ids: [],
      buckets: [],
      missing_bucket_ids: [],
    });
  }

  return {
    models,
    defaultModel: demoMode ? CALYPSO_WORLDCUP_MODEL : CALYPSO_RAG_AGENT,
    fetchedAt: new Date().toISOString(),
    source: "api",
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function loadRagModelCatalog(
  config: CalypsoRuntimeConfig,
): Promise<CalypsoRagModelCatalog> {
  const apiKey = String(config.effectiveBearer || config.apiKey || "").trim();
  const demoMode = config.authMode === "demo";
  if (!apiKey) {
    return fallbackRagModelCatalog("No bearer token is configured.", {
      demoMode,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(buildApiUrl(config, "/rag-agent/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Model discovery failed with status ${response.status}.`);
    }
    return normalizeCatalog(body as RagAgentModelsResponse, { demoMode });
  } catch (error) {
    return fallbackRagModelCatalog(error, { demoMode });
  } finally {
    clearTimeout(timeout);
  }
}

export function modelIdsFromCatalog(catalog: CalypsoRagModelCatalog): string[] {
  return catalog.models.map((model) => model.id);
}
