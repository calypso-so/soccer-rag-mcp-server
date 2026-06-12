import type { CalypsoRuntimeConfig } from "./config.js";

export type KnowledgeBucketStoreState = {
  alias?: string | null;
  gemini_store_name?: string | null;
  status?: string;
  file_count?: number;
  indexed_file_count?: number;
  pending_file_count?: number;
  member_count?: number;
  indexed_member_count?: number;
  pending_member_count?: number;
  last_synced_at?: unknown;
  last_error?: string | null;
};

export type KnowledgeBucketDescriptor = {
  id: string;
  teamId?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  status?: string;
  knowledgeIds: string[];
  fileIds: string[];
  fileKnowledgeIds: string[];
  filesCount?: number;
  memberCount?: number;
  rawMemberCount?: number;
  fileCount?: number;
  retrievableFileCount?: number;
  staleMemberCount?: number;
  activeNonFileMemberCount?: number;
  counts: Record<string, number>;
  bucketStore?: KnowledgeBucketStoreState | null;
};

export type KnowledgeBucketList = {
  team_id: string;
  buckets: KnowledgeBucketDescriptor[];
  request_id?: string;
};

export type ListKnowledgeBucketsOptions = {
  includeArchived?: boolean;
};

function buildApiUrl(
  config: CalypsoRuntimeConfig,
  relativePath: string,
): string {
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return new URL(normalizedPath, `${config.apiBaseUrl}/`).toString();
}

function requireApiKey(config: CalypsoRuntimeConfig): string {
  const apiKey = String(config.effectiveBearer || config.apiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "A Calypso bearer token is required to call Calypso tools, but it is not configured.",
    );
  }

  return apiKey;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatApiError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    if ("error" in body && body.error && typeof body.error === "object") {
      const error = body.error as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
      };
      const code = typeof error.code === "string" ? error.code : "api_error";
      const message =
        typeof error.message === "string" ? error.message : "Request failed.";
      const details =
        error.details && typeof error.details === "object"
          ? ` details=${JSON.stringify(error.details)}`
          : "";
      return `Request failed with status ${status}: ${code}: ${message}${details}`;
    }
    const maybeError =
      "message" in body && typeof body.message === "string"
        ? body.message
        : null;
    if (maybeError) {
      return `Request failed with status ${status}: ${maybeError}`;
    }
  }

  if (typeof body === "string" && body.trim()) {
    return `Request failed with status ${status}: ${body.trim()}`;
  }

  return `Request failed with status ${status}`;
}

function normalizeStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const out: string[] = [];
  const seen = new Set<string>();
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

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[key] = rawValue;
    }
  }
  return out;
}

function normalizeBucketStore(
  value: unknown,
): KnowledgeBucketStoreState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  return {
    alias: typeof raw.alias === "string" ? raw.alias : null,
    gemini_store_name:
      typeof raw.gemini_store_name === "string" ? raw.gemini_store_name : null,
    status:
      typeof raw.status === "string" && raw.status.trim()
        ? raw.status.trim()
        : undefined,
    file_count: typeof raw.file_count === "number" ? raw.file_count : undefined,
    indexed_file_count:
      typeof raw.indexed_file_count === "number"
        ? raw.indexed_file_count
        : undefined,
    pending_file_count:
      typeof raw.pending_file_count === "number"
        ? raw.pending_file_count
        : undefined,
    member_count:
      typeof raw.member_count === "number" ? raw.member_count : undefined,
    indexed_member_count:
      typeof raw.indexed_member_count === "number"
        ? raw.indexed_member_count
        : undefined,
    pending_member_count:
      typeof raw.pending_member_count === "number"
        ? raw.pending_member_count
        : undefined,
    last_synced_at: raw.last_synced_at,
    last_error: typeof raw.last_error === "string" ? raw.last_error : null,
  };
}

function normalizeBucket(value: unknown): KnowledgeBucketDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "").trim();
  if (!id) {
    return null;
  }
  const fileIds = normalizeStringArray(raw.fileIds);
  const fileKnowledgeIds = normalizeStringArray(raw.fileKnowledgeIds);
  return {
    id,
    teamId:
      typeof raw.teamId === "string" && raw.teamId.trim()
        ? raw.teamId.trim()
        : undefined,
    slug:
      typeof raw.slug === "string" && raw.slug.trim()
        ? raw.slug.trim()
        : undefined,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : undefined,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : null,
    status:
      typeof raw.status === "string" && raw.status.trim()
        ? raw.status.trim()
        : undefined,
    knowledgeIds: normalizeStringArray(raw.knowledgeIds),
    fileIds: fileIds.length > 0 ? fileIds : fileKnowledgeIds,
    fileKnowledgeIds: fileKnowledgeIds.length > 0 ? fileKnowledgeIds : fileIds,
    filesCount:
      typeof raw.filesCount === "number"
        ? raw.filesCount
        : typeof raw.fileCount === "number"
          ? raw.fileCount
          : undefined,
    memberCount:
      typeof raw.memberCount === "number" ? raw.memberCount : undefined,
    rawMemberCount:
      typeof raw.rawMemberCount === "number" ? raw.rawMemberCount : undefined,
    fileCount: typeof raw.fileCount === "number" ? raw.fileCount : undefined,
    retrievableFileCount:
      typeof raw.retrievableFileCount === "number"
        ? raw.retrievableFileCount
        : undefined,
    staleMemberCount:
      typeof raw.staleMemberCount === "number"
        ? raw.staleMemberCount
        : undefined,
    activeNonFileMemberCount:
      typeof raw.activeNonFileMemberCount === "number"
        ? raw.activeNonFileMemberCount
        : undefined,
    counts: normalizeNumberRecord(raw.counts),
    bucketStore: normalizeBucketStore(raw.bucketStore),
  };
}

export function normalizeKnowledgeBucketList(
  value: unknown,
): KnowledgeBucketList {
  if (!value || typeof value !== "object") {
    throw new Error("Bucket listing response must be a JSON object.");
  }
  const raw = value as Record<string, unknown>;
  const teamId = String(raw.team_id || "").trim();
  const seen = new Set<string>();
  const buckets = (Array.isArray(raw.buckets) ? raw.buckets : [])
    .map(normalizeBucket)
    .filter((bucket): bucket is KnowledgeBucketDescriptor => Boolean(bucket))
    .filter((bucket) => {
      if (seen.has(bucket.id)) {
        return false;
      }
      seen.add(bucket.id);
      return true;
    });

  return {
    team_id: teamId,
    buckets,
    request_id:
      typeof raw.request_id === "string" && raw.request_id.trim()
        ? raw.request_id.trim()
        : undefined,
  };
}

export async function listKnowledgeBuckets(
  config: CalypsoRuntimeConfig,
  options: ListKnowledgeBucketsOptions = {},
): Promise<KnowledgeBucketList> {
  const apiKey = requireApiKey(config);
  const query = options.includeArchived ? "?include_archived=true" : "";
  const response = await fetch(
    buildApiUrl(config, `/knowledge/buckets${query}`),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(formatApiError(response.status, body));
  }
  return normalizeKnowledgeBucketList(body);
}
