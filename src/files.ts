import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CalypsoRuntimeConfig } from "./config.js";

export type KnowledgeTaskObject = {
  id: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
};

export type KnowledgeFileObject = {
  id: string;
  object?: string;
  status?: string;
  title?: string;
  filename?: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
  task?: KnowledgeTaskObject;
  source?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  request_id?: string;
  [key: string]: unknown;
};

export type KnowledgeBatchItemObject = {
  client_file_id?: string;
  clientFileId?: string;
  status?: string;
  file?: KnowledgeFileObject;
  knowledgeId?: string;
  taskId?: string;
  canonicalStatus?: string;
  bucketSyncStatus?: string;
  bucketSync?: Record<string, unknown>;
  error?: Record<string, unknown>;
  [key: string]: unknown;
};

export type KnowledgeBatchObject = {
  id: string;
  object?: "knowledge_batch";
  status?: string;
  message?: string;
  total?: number;
  accepted?: number;
  rejected?: number;
  queued?: number;
  indexing?: number;
  active?: number;
  partialFailedCount?: number;
  failed?: number;
  items?: KnowledgeBatchItemObject[];
  request_id?: string;
  [key: string]: unknown;
};

export type UploadKnowledgeFileParams = {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  filePath?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
  idempotencyKey?: string;
  waitForIndexing?: boolean;
};

export type UploadKnowledgeBatchItemParams = {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  filePath?: string;
  clientFileId?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
};

export type UploadKnowledgeFilesBatchParams = {
  items: UploadKnowledgeBatchItemParams[];
  batchIdempotencyKey: string;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
  waitForBatchReady?: boolean;
};

export type KnowledgeUploadResult = {
  file: KnowledgeFileObject;
  task?: KnowledgeTaskObject | null;
};

type SingleUploadSessionCreateResponse = {
  session_id: string;
  upload_strategy?: string;
  upload_url: string;
  expires_at?: string;
  request_id?: string;
};

type BatchUploadSessionCreateResponse = {
  batch_id: string;
  upload_strategy?: string;
  accepted?: Array<{
    client_file_id: string;
    session_id: string;
    upload_url: string;
    expires_at?: string;
    [key: string]: unknown;
  }>;
  rejected?: Array<Record<string, unknown>>;
  request_id?: string;
  [key: string]: unknown;
};

type BatchUploadSessionFinalizeResponse = {
  batch_id: string;
  status?: string;
  finalized?: Array<{
    client_file_id?: string;
    session_id?: string;
    knowledge_id?: string;
    task_id?: string;
    [key: string]: unknown;
  }>;
  pending?: Array<Record<string, unknown>>;
  failed?: Array<Record<string, unknown>>;
  replayed?: Array<Record<string, unknown>>;
  request_id?: string;
  [key: string]: unknown;
};

const DEFAULT_MIME_TYPE = "application/octet-stream";
const KNOWLEDGE_READY_STATE = "indexed";
const KNOWLEDGE_ERROR_STATES = new Set(["failed", "deleted"]);
const KNOWLEDGE_POLL_MAX_ATTEMPTS = 40;
const KNOWLEDGE_BATCH_MAX_FILES = 100;
const POLL_INITIAL_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 4000;
const POLL_BACKOFF_MULTIPLIER = 1.5;
const REMOTE_ATTACHMENT_PATH_PREFIXES = [
  "/mnt/user-data/",
  "/mnt/data/",
  "/mnt/attachments/",
  "/tmp/claude-uploads/",
];

type UploadContentSource = {
  filename?: string;
  mimeType?: string;
  contentBase64?: string;
  filePath?: string;
};

type ResolvedUploadContent = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function looksLikeRemoteAttachmentPath(filePath: string): boolean {
  return REMOTE_ATTACHMENT_PATH_PREFIXES.some((prefix) =>
    filePath.startsWith(prefix),
  );
}

function createFilePathReadError(filePath: string, error: unknown): Error {
  const baseMessage =
    error instanceof Error ? error.message : "The file could not be read.";
  const sharedGuidance =
    "`filePath` must be readable by the machine running the Calypso MCP server. If this file came from Claude, ChatGPT, Smithery, a browser upload, or another hosted agent sandbox, pass the file bytes as `contentBase64` instead.";

  if (looksLikeRemoteAttachmentPath(filePath)) {
    return new Error(
      `The file path \`${filePath}\` looks like a hosted-agent attachment path, but the Calypso MCP server cannot read that sandbox path. Use \`contentBase64\` for hosted or remote uploads, or run the MCP server in the same environment where the path exists.`,
    );
  }

  if (isNodeError(error) && error.code === "ENOENT") {
    return new Error(
      `The file path \`${filePath}\` does not exist from the Calypso MCP server's point of view. ${sharedGuidance}`,
    );
  }

  return new Error(
    `The Calypso MCP server could not read \`${filePath}\`: ${baseMessage}. ${sharedGuidance}`,
  );
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
        retryable?: unknown;
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
      "error" in body && typeof body.error === "string"
        ? body.error
        : "message" in body && typeof body.message === "string"
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

async function requestJson<T>(
  config: CalypsoRuntimeConfig,
  relativePath: string,
  init: RequestInit & { headers?: HeadersInit },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireApiKey(config)}`);

  const response = await fetch(buildApiUrl(config, relativePath), {
    ...init,
    headers,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(formatApiError(response.status, body));
  }

  return body as T;
}

export function stripDataUriPrefix(value: string): string {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return value;
  }

  return value.slice(markerIndex + marker.length);
}

export async function resolveUploadContent(
  input: UploadContentSource,
): Promise<ResolvedUploadContent> {
  const hasContentBase64 =
    typeof input.contentBase64 === "string" &&
    input.contentBase64.trim().length > 0;
  const hasFilePath =
    typeof input.filePath === "string" && input.filePath.trim().length > 0;

  if (hasContentBase64 === hasFilePath) {
    throw new Error("Provide exactly one of `contentBase64` or `filePath`.");
  }

  const filename =
    (input.filename || "").trim() ||
    (hasFilePath && input.filePath ? path.basename(input.filePath) : "");
  if (!filename) {
    throw new Error("A filename is required.");
  }

  const mimeType = (input.mimeType || "").trim() || DEFAULT_MIME_TYPE;

  if (hasFilePath) {
    const uploadFilePath = String(input.filePath);
    let bytes: Buffer;
    try {
      bytes = await readFile(uploadFilePath);
    } catch (error) {
      throw createFilePathReadError(uploadFilePath, error);
    }
    return {
      bytes,
      filename,
      mimeType,
    };
  }

  const normalizedBase64 = stripDataUriPrefix(
    String(input.contentBase64).trim(),
  );
  const bytes = Buffer.from(normalizedBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("The provided `contentBase64` value could not be decoded.");
  }

  return {
    bytes,
    filename,
    mimeType,
  };
}

function sanitizeClientFileId(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 80);
  return sanitized && !sanitized.startsWith("__") ? sanitized : "file";
}

function uniqueClientFileId(
  item: UploadKnowledgeBatchItemParams,
  index: number,
  seen: Set<string>,
): string {
  const explicit = String(item.clientFileId || "").trim();
  if (explicit) {
    if (
      explicit.length > 128 ||
      explicit.startsWith("__") ||
      !/^[A-Za-z0-9_.-]+$/.test(explicit)
    ) {
      throw new Error("clientFileId must be Firestore-safe.");
    }
    if (seen.has(explicit)) {
      throw new Error("clientFileId values must be unique.");
    }
    seen.add(explicit);
    return explicit;
  }

  const seed = explicit || `${index}:${item.filename}:${item.filePath || ""}`;
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  const base = sanitizeClientFileId(explicit || item.filename || "file");
  let candidate = `${base}_${digest}`.slice(0, 128);
  let suffix = 2;

  while (seen.has(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${candidate.slice(0, 128 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  seen.add(candidate);
  return candidate;
}

function compactStringArray(values?: string[]): string[] | undefined {
  const out = (values || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function hasBucketDestination(source: {
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
}): boolean {
  return Boolean(
    compactStringArray(source.bucketIds) ||
      compactStringArray(source.bucketSlugs) ||
      String(source.bucket || "").trim(),
  );
}

function applyBucketFields(
  target: Record<string, unknown>,
  source: {
    bucketIds?: string[];
    bucketSlugs?: string[];
    bucket?: string;
    createMissingBuckets?: boolean;
  },
): void {
  const bucketIds = compactStringArray(source.bucketIds);
  const bucketSlugs = compactStringArray(source.bucketSlugs);
  const bucket = String(source.bucket || "").trim();

  if (bucketIds) target.bucket_ids = bucketIds;
  if (bucketSlugs) target.bucket_slugs = bucketSlugs;
  if (bucket) target.bucket = bucket;
  if (typeof source.createMissingBuckets === "boolean") {
    target.create_missing_buckets = source.createMissingBuckets;
  }
}

export function buildKnowledgeBatchManifest(
  params: UploadKnowledgeFilesBatchParams,
): { manifest: Record<string, unknown>; clientFileIds: string[] } {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new Error("Batch upload requires at least one item.");
  }

  if (params.items.length > KNOWLEDGE_BATCH_MAX_FILES) {
    throw new Error(
      `Batch upload supports at most ${KNOWLEDGE_BATCH_MAX_FILES} files.`,
    );
  }

  const batchIdempotencyKey = String(params.batchIdempotencyKey || "").trim();
  if (!batchIdempotencyKey) {
    throw new Error("batchIdempotencyKey is required for batch uploads.");
  }

  const seen = new Set<string>();
  const clientFileIds: string[] = [];
  const manifest: Record<string, unknown> = {
    version: 1,
    batch_idempotency_key: batchIdempotencyKey,
  };
  applyBucketFields(manifest, params);
  const hasSharedBucketDestination = hasBucketDestination(params);

  manifest.items = params.items.map((item, index) => {
    if (!hasSharedBucketDestination && !hasBucketDestination(item)) {
      throw new Error(
        "Batch knowledge uploads require a shared bucket destination or a bucket destination on every item.",
      );
    }
    const clientFileId = uniqueClientFileId(item, index, seen);
    clientFileIds.push(clientFileId);
    const payload: Record<string, unknown> = {
      client_file_id: clientFileId,
      filename: item.filename,
    };

    if (item.title?.trim()) payload.title = item.title.trim();
    const tags = compactStringArray(item.tags);
    if (tags) payload.tags = tags;
    if (item.metadata && Object.keys(item.metadata).length > 0) {
      payload.metadata = item.metadata;
    }
    applyBucketFields(payload, item);
    return payload;
  });

  return { manifest, clientFileIds };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractKnowledgeStatus(result: KnowledgeUploadResult): string {
  return String(result.file.status || result.task?.status || "")
    .trim()
    .toLowerCase();
}

function isKnowledgeReady(result: KnowledgeUploadResult): boolean {
  return extractKnowledgeStatus(result) === KNOWLEDGE_READY_STATE;
}

function getKnowledgeError(result: KnowledgeUploadResult): string | null {
  const status = extractKnowledgeStatus(result);
  if (!status) {
    return null;
  }

  if (KNOWLEDGE_ERROR_STATES.has(status)) {
    return `Knowledge indexing entered terminal status \`${status}\`.`;
  }

  return null;
}

function describeKnowledgeQueuedTimeout(
  result?: KnowledgeUploadResult,
): string {
  const fileId = result?.file?.id ? ` file_id=${result.file.id}` : "";
  const taskId = result?.task?.id ? ` task_id=${result.task.id}` : "";
  const status = extractKnowledgeStatus(
    result || ({ file: {} } as KnowledgeUploadResult),
  );
  const statusText = status ? ` Last status: ${status}.` : "";
  return `Upload accepted but indexing did not start or finish before timeout.${statusText} Ensure the AIcore knowledge index worker is running for public /v1 uploads.${fileId}${taskId}`;
}

function describeBatchQueuedTimeout(
  batchId: string,
  batch?: KnowledgeBatchObject,
): string {
  const status = String(batch?.status || "timeout");
  const queued = Number(batch?.queued || 0);
  const indexing = Number(batch?.indexing || 0);
  const active = Number(batch?.active || 0);
  const failed = Number(batch?.failed || 0);
  return `Batch ${batchId} was accepted but did not finish before timeout. Last status: ${status}. queued=${queued} indexing=${indexing} active=${active} failed=${failed}. Ensure the AIcore knowledge index worker is running for public /v1 uploads.`;
}

export async function getKnowledgeFile(
  config: CalypsoRuntimeConfig,
  fileId: string,
): Promise<KnowledgeFileObject> {
  return requestJson<KnowledgeFileObject>(
    config,
    `/knowledge/files/${encodeURIComponent(fileId)}`,
    {
      method: "GET",
    },
  );
}

export async function getKnowledgeTask(
  config: CalypsoRuntimeConfig,
  taskId: string,
): Promise<KnowledgeTaskObject> {
  return requestJson<KnowledgeTaskObject>(
    config,
    `/knowledge/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
    },
  );
}

async function resolveKnowledgeResult(
  config: CalypsoRuntimeConfig,
  fileId: string,
  taskId?: string | null,
): Promise<KnowledgeUploadResult> {
  const file = await getKnowledgeFile(config, fileId);
  const task = taskId
    ? await getKnowledgeTask(config, taskId)
    : file.task || null;
  return { file, task };
}

export async function waitForKnowledgeFileIndexed(
  config: CalypsoRuntimeConfig,
  fileId: string,
  taskId?: string | null,
): Promise<KnowledgeUploadResult> {
  let delayMs = POLL_INITIAL_DELAY_MS;
  let last: KnowledgeUploadResult | undefined;

  for (let attempt = 0; attempt < KNOWLEDGE_POLL_MAX_ATTEMPTS; attempt += 1) {
    last = await resolveKnowledgeResult(config, fileId, taskId);
    const readinessError = getKnowledgeError(last);
    if (readinessError) {
      throw new Error(readinessError);
    }

    if (isKnowledgeReady(last)) {
      return last;
    }

    if (attempt < KNOWLEDGE_POLL_MAX_ATTEMPTS - 1) {
      await sleep(delayMs);
      delayMs = Math.min(
        POLL_MAX_DELAY_MS,
        Math.round(delayMs * POLL_BACKOFF_MULTIPLIER),
      );
    }
  }

  throw new Error(describeKnowledgeQueuedTimeout(last));
}

async function uploadBytesToSessionTarget(
  uploadUrl: string,
  content: ResolvedUploadContent,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": content.mimeType || DEFAULT_MIME_TYPE,
      "Content-Range": `bytes 0-${content.bytes.byteLength - 1}/${content.bytes.byteLength}`,
    },
    body: content.bytes as BodyInit,
  });

  if (!response.ok) {
    const body = await parseResponseBody(response);
    throw new Error(formatApiError(response.status, body));
  }
}

export async function uploadKnowledgeFile(
  config: CalypsoRuntimeConfig,
  params: UploadKnowledgeFileParams,
): Promise<KnowledgeUploadResult> {
  if (!hasBucketDestination(params)) {
    throw new Error(
      "Knowledge file uploads require bucketIds, bucketSlugs, or bucket.",
    );
  }
  const content = await resolveUploadContent(params);
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (params.idempotencyKey?.trim()) {
    headers.set("Idempotency-Key", params.idempotencyKey.trim());
  }

  const createBody: Record<string, unknown> = {
    filename: content.filename,
    content_type: content.mimeType || DEFAULT_MIME_TYPE,
    size_bytes: content.bytes.byteLength,
  };
  if (params.title?.trim()) createBody.title = params.title.trim();
  const tags = compactStringArray(params.tags);
  if (tags) createBody.tags = tags;
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    createBody.metadata = params.metadata;
  }
  applyBucketFields(createBody, params);

  const session = await requestJson<SingleUploadSessionCreateResponse>(
    config,
    "/knowledge/files/upload-session",
    {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
    },
  );

  await uploadBytesToSessionTarget(session.upload_url, content);

  const file = await requestJson<KnowledgeFileObject>(
    config,
    `/knowledge/files/upload-session/${encodeURIComponent(session.session_id)}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

  const initialResult: KnowledgeUploadResult = {
    file,
    task: file.task || null,
  };

  if (params.waitForIndexing !== true) {
    return initialResult;
  }

  return waitForKnowledgeFileIndexed(config, file.id, file.task?.id || null);
}

export async function uploadKnowledgeFilesBatch(
  config: CalypsoRuntimeConfig,
  params: UploadKnowledgeFilesBatchParams,
): Promise<KnowledgeBatchObject> {
  const { manifest, clientFileIds } = buildKnowledgeBatchManifest(params);
  const contents: ResolvedUploadContent[] = [];

  for (const [index, item] of params.items.entries()) {
    const content = await resolveUploadContent(item);
    contents[index] = content;
  }

  const files = contents.map((content, index) => ({
    client_file_id: clientFileIds[index],
    filename: content.filename,
    content_type: content.mimeType || DEFAULT_MIME_TYPE,
    size_bytes: content.bytes.byteLength,
  }));

  const sessionBatch = await requestJson<BatchUploadSessionCreateResponse>(
    config,
    "/knowledge/files:batch/upload-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, files }),
    },
  );

  const sessionsByClientFileId = new Map(
    (sessionBatch.accepted || []).map((item) => [item.client_file_id, item]),
  );
  for (const [index, clientFileId] of clientFileIds.entries()) {
    const session = sessionsByClientFileId.get(clientFileId);
    if (!session) continue;
    await uploadBytesToSessionTarget(session.upload_url, contents[index]);
  }

  const finalized = await requestJson<BatchUploadSessionFinalizeResponse>(
    config,
    `/knowledge/files:batch/upload-session/${encodeURIComponent(sessionBatch.batch_id)}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "finalize_uploaded" }),
    },
  );

  if (params.waitForBatchReady !== true) {
    return {
      id: finalized.batch_id,
      status: finalized.status,
      accepted:
        (finalized.finalized?.length || 0) + (finalized.replayed?.length || 0),
      rejected: finalized.failed?.length || 0,
      items: [
        ...(finalized.finalized || []).map((item) => ({
          client_file_id: item.client_file_id,
          status: "queued",
          knowledgeId: item.knowledge_id,
          taskId: item.task_id,
        })),
        ...(finalized.replayed || []).map((item) => ({
          client_file_id: item.client_file_id,
          status: "replayed",
          knowledgeId: item.knowledge_id,
          taskId: item.task_id,
        })),
        ...(finalized.pending || []).map((item) => ({
          ...item,
          status: "pending",
        })),
        ...(finalized.failed || []).map((item) => ({
          ...item,
          status: "failed",
        })),
      ],
      request_id: finalized.request_id,
      upload_session_finalize: finalized,
    };
  }

  return waitForKnowledgeBatchReady(config, finalized.batch_id);
}

export async function getKnowledgeBatch(
  config: CalypsoRuntimeConfig,
  batchId: string,
  includeItems = true,
): Promise<KnowledgeBatchObject> {
  const id = String(batchId || "").trim();
  if (!id) {
    throw new Error("batchId is required.");
  }

  const query = includeItems ? "?include_items=true" : "";
  return requestJson<KnowledgeBatchObject>(
    config,
    `/knowledge/batches/${encodeURIComponent(id)}${query}`,
    {
      method: "GET",
    },
  );
}

function isKnowledgeBatchTerminal(batch: KnowledgeBatchObject): boolean {
  return ["active", "partially_active", "partially_failed", "failed"].includes(
    String(batch.status || "")
      .trim()
      .toLowerCase(),
  );
}

export async function waitForKnowledgeBatchReady(
  config: CalypsoRuntimeConfig,
  batchId: string,
): Promise<KnowledgeBatchObject> {
  let delayMs = POLL_INITIAL_DELAY_MS;
  let last: KnowledgeBatchObject | undefined;

  for (let attempt = 0; attempt < KNOWLEDGE_POLL_MAX_ATTEMPTS; attempt += 1) {
    last = await getKnowledgeBatch(config, batchId, true);
    if (isKnowledgeBatchTerminal(last)) {
      return last;
    }

    if (attempt < KNOWLEDGE_POLL_MAX_ATTEMPTS - 1) {
      await sleep(delayMs);
      delayMs = Math.min(
        POLL_MAX_DELAY_MS,
        Math.round(delayMs * POLL_BACKOFF_MULTIPLIER),
      );
    }
  }

  return {
    ...(last || { id: batchId }),
    status: last?.status || "timeout",
    message: describeBatchQueuedTimeout(batchId, last),
  };
}
