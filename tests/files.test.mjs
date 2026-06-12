import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildKnowledgeBatchManifest,
  resolveUploadContent,
  stripDataUriPrefix,
  uploadKnowledgeFile,
  uploadKnowledgeFilesBatch,
  waitForKnowledgeBatchReady,
  waitForKnowledgeFileIndexed,
} from "../dist/files.js";

function getRequestHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === "function") {
    return headers.get(name) ?? undefined;
  }

  const normalizedName = name.toLowerCase();
  if (Array.isArray(headers)) {
    const entry = headers.find(
      ([key]) => String(key).toLowerCase() === normalizedName,
    );
    return entry ? String(entry[1]) : undefined;
  }

  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === normalizedName,
  );
  if (!entry) {
    return undefined;
  }

  return Array.isArray(entry[1]) ? entry[1].join(", ") : String(entry[1]);
}

test("stripDataUriPrefix removes data URI metadata", () => {
  assert.equal(
    stripDataUriPrefix("data:text/plain;base64,aGVsbG8="),
    "aGVsbG8=",
  );
  assert.equal(stripDataUriPrefix("aGVsbG8="), "aGVsbG8=");
});

test("resolveUploadContent decodes base64 content", async () => {
  const content = await resolveUploadContent({
    filename: "hello.txt",
    mimeType: "text/plain",
    contentBase64: "data:text/plain;base64,aGVsbG8=",
  });

  assert.equal(content.filename, "hello.txt");
  assert.equal(content.mimeType, "text/plain");
  assert.equal(Buffer.from(content.bytes).toString("utf8"), "hello");
});

test("resolveUploadContent reads local file paths", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "soccer-rag-mcp-"));
  const filePath = path.join(tempDir, "local.txt");

  try {
    await writeFile(filePath, "local file");
    const content = await resolveUploadContent({
      mimeType: "text/plain",
      filePath,
    });

    assert.equal(content.filename, "local.txt");
    assert.equal(content.mimeType, "text/plain");
    assert.equal(Buffer.from(content.bytes).toString("utf8"), "local file");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveUploadContent explains hosted attachment filePath failures", async () => {
  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "The-History-of-AI_Avicena.pdf",
        mimeType: "application/pdf",
        filePath: "/mnt/user-data/uploads/The-History-of-AI_Avicena.pdf",
      }),
    /hosted-agent attachment path.*contentBase64/s,
  );
});

test("resolveUploadContent requires exactly one content source", async () => {
  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
      }),
    /Provide exactly one/,
  );

  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        filePath: "/tmp/invalid.txt",
      }),
    /Provide exactly one/,
  );
});

test("buildKnowledgeBatchManifest generates unique Firestore-safe client_file_id values", () => {
  const { manifest, clientFileIds } = buildKnowledgeBatchManifest({
    batchIdempotencyKey: "batch-1",
    bucket: "docs",
    items: [
      {
        filename: "Fall of the Berlin Wall.html",
        mimeType: "text/html",
        contentBase64: "PGgxPkE8L2gxPg==",
      },
      {
        filename: "Fall of the Berlin Wall.html",
        mimeType: "text/html",
        contentBase64: "PGgxPkI8L2gxPg==",
      },
    ],
  });

  assert.equal(manifest.version, 1);
  assert.equal(manifest.batch_idempotency_key, "batch-1");
  assert.equal(new Set(clientFileIds).size, 2);
  for (const clientFileId of clientFileIds) {
    assert.match(clientFileId, /^[A-Za-z0-9_.-]+$/);
    assert.equal(clientFileId.startsWith("__"), false);
  }
  assert.deepEqual(
    manifest.items.map((item) => item.client_file_id),
    clientFileIds,
  );
});

test("buildKnowledgeBatchManifest rejects batches without bucket destinations", () => {
  assert.throws(
    () =>
      buildKnowledgeBatchManifest({
        batchIdempotencyKey: "no-bucket",
        items: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            contentBase64: "aGVsbG8=",
          },
        ],
      }),
    /bucket destination/,
  );
});

test("buildKnowledgeBatchManifest rejects batches over 100 files", () => {
  assert.throws(
    () =>
      buildKnowledgeBatchManifest({
        batchIdempotencyKey: "too-many",
        items: Array.from({ length: 101 }, (_, index) => ({
          filename: `file-${index}.txt`,
          mimeType: "text/plain",
          contentBase64: "aGVsbG8=",
        })),
      }),
    /at most 100 files/,
  );
});

test("buildKnowledgeBatchManifest includes shared and per-item bucket fields", () => {
  const { manifest } = buildKnowledgeBatchManifest({
    batchIdempotencyKey: "bucketed",
    bucket: "shared-bucket",
    bucketSlugs: ["shared-slug"],
    createMissingBuckets: true,
    items: [
      {
        filename: "shared.txt",
        mimeType: "text/plain",
        contentBase64: "c2hhcmVk",
      },
      {
        filename: "override.txt",
        mimeType: "text/plain",
        contentBase64: "b3ZlcnJpZGU=",
        bucket: "item-bucket",
        bucketIds: ["bucket-id-1"],
        createMissingBuckets: false,
      },
    ],
  });

  assert.equal(manifest.bucket, "shared-bucket");
  assert.deepEqual(manifest.bucket_slugs, ["shared-slug"]);
  assert.equal(manifest.create_missing_buckets, true);
  assert.equal(manifest.items[1].bucket, "item-bucket");
  assert.deepEqual(manifest.items[1].bucket_ids, ["bucket-id-1"]);
  assert.equal(manifest.items[1].create_missing_buckets, false);
});

test("uploadKnowledgeFile uses upload session flow", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).endsWith("/knowledge/files/upload-session")) {
      const body = JSON.parse(init.body);
      assert.equal(body.filename, "hello.txt");
      assert.equal(body.content_type, "text/plain");
      assert.equal(body.size_bytes, 5);
      assert.deepEqual(body.bucket_ids, ["bucket-1"]);
      return new Response(
        JSON.stringify({
          session_id: "sess-123",
          upload_url: "https://storage.example.test/upload/sess-123",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url) === "https://storage.example.test/upload/sess-123") {
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["Content-Type"], "text/plain");
      assert.equal(init.headers["Content-Range"], "bytes 0-4/5");
      assert.equal(Buffer.from(init.body).toString("utf8"), "hello");
      return new Response("", { status: 200 });
    }

    return new Response(
      JSON.stringify({
        id: "file-123",
        object: "knowledge_file",
        status: "queued",
        title: "hello",
        filename: "hello.txt",
        content_type: "text/plain",
        size_bytes: 5,
        task: { id: "task-123", status: "queued" },
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadKnowledgeFile(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        filename: "hello.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        bucketIds: ["bucket-1"],
        idempotencyKey: "upload-hello",
      },
    );

    assert.equal(result.file.id, "file-123");
    assert.equal(calls.length, 3);
    assert.equal(
      calls[0].url,
      "https://api.example.test/v1/knowledge/files/upload-session",
    );
    assert.equal(
      calls[2].url,
      "https://api.example.test/v1/knowledge/files/upload-session/sess-123/finalize",
    );
    assert.equal(
      getRequestHeader(calls[0].init.headers, "Authorization"),
      "Bearer sk-test",
    );
    assert.equal(
      getRequestHeader(calls[0].init.headers, "Content-Type"),
      "application/json",
    );
    assert.equal(
      getRequestHeader(calls[0].init.headers, "Idempotency-Key"),
      "upload-hello",
    );
    assert.equal(
      getRequestHeader(calls[2].init.headers, "Authorization"),
      "Bearer sk-test",
    );
    assert.equal(
      getRequestHeader(calls[2].init.headers, "Content-Type"),
      "application/json",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadKnowledgeFile rejects missing bucket destination", async () => {
  await assert.rejects(
    () =>
      uploadKnowledgeFile(
        {
          apiBaseUrl: "https://api.example.test/v1",
          apiKey: "sk-test",
        },
        {
          filename: "hello.txt",
          mimeType: "text/plain",
          contentBase64: "aGVsbG8=",
        },
      ),
    /bucketIds, bucketSlugs, or bucket/,
  );
});

test("uploadKnowledgeFilesBatch uses batch upload session flow", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).endsWith("/knowledge/files:batch/upload-session")) {
      const body = JSON.parse(init.body);
      assert.equal(body.manifest.version, 1);
      assert.equal(body.manifest.bucket, "rag1");
      assert.equal(body.files[0].filename, "hello.txt");
      assert.equal(body.files[0].size_bytes, 5);
      return new Response(
        JSON.stringify({
          batch_id: "batch_123",
          upload_strategy: "gcs_resumable",
          accepted: [
            {
              client_file_id: body.files[0].client_file_id,
              session_id: "sess-batch-1",
              upload_url: "https://storage.example.test/upload/sess-batch-1",
            },
          ],
          rejected: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url) === "https://storage.example.test/upload/sess-batch-1") {
      assert.equal(init.method, "PUT");
      assert.equal(Buffer.from(init.body).toString("utf8"), "hello");
      return new Response("", { status: 200 });
    }

    return new Response(
      JSON.stringify({
        batch_id: "batch_123",
        status: "finalized",
        finalized: [
          {
            client_file_id: "hello_txt_abc",
            session_id: "sess-batch-1",
            knowledge_id: "file-123",
            task_id: "task-123",
          },
        ],
        pending: [],
        failed: [],
        replayed: [],
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadKnowledgeFilesBatch(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        batchIdempotencyKey: "batch-upload",
        bucket: "rag1",
        items: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            contentBase64: "aGVsbG8=",
          },
        ],
      },
    );

    assert.equal(result.id, "batch_123");
    assert.equal(calls.length, 3);
    assert.equal(
      calls[0].url,
      "https://api.example.test/v1/knowledge/files:batch/upload-session",
    );
    assert.equal(
      calls[2].url,
      "https://api.example.test/v1/knowledge/files:batch/upload-session/batch_123/finalize",
    );
    assert.equal(
      getRequestHeader(calls[0].init.headers, "Authorization"),
      "Bearer sk-test",
    );
    assert.equal(
      getRequestHeader(calls[0].init.headers, "Content-Type"),
      "application/json",
    );
    assert.equal(
      getRequestHeader(calls[2].init.headers, "Authorization"),
      "Bearer sk-test",
    );
    assert.equal(
      getRequestHeader(calls[2].init.headers, "Content-Type"),
      "application/json",
    );
    assert.deepEqual(JSON.parse(calls[2].init.body), {
      mode: "finalize_uploaded",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadKnowledgeFilesBatch polls batch status with include_items=true", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).endsWith("/knowledge/files:batch/upload-session")) {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          batch_id: "batch_poll",
          accepted: [
            {
              client_file_id: body.files[0].client_file_id,
              session_id: "sess-poll-1",
              upload_url: "https://storage.example.test/upload/sess-poll-1",
            },
          ],
          rejected: [],
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (String(url) === "https://storage.example.test/upload/sess-poll-1") {
      return new Response("", { status: 200 });
    }

    if (
      String(url).endsWith(
        "/knowledge/files:batch/upload-session/batch_poll/finalize",
      )
    ) {
      return new Response(
        JSON.stringify({
          batch_id: "batch_poll",
          status: "finalized",
          finalized: [
            {
              client_file_id: "one",
              session_id: "sess-poll-1",
              knowledge_id: "file-1",
              task_id: "task-1",
            },
          ],
          pending: [],
          failed: [],
          replayed: [],
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "batch_poll",
        status: "active",
        items: [{ client_file_id: "one", status: "active" }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadKnowledgeFilesBatch(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        batchIdempotencyKey: "batch-poll",
        bucket: "rag1",
        waitForBatchReady: true,
        items: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            contentBase64: "aGVsbG8=",
          },
        ],
      },
    );

    assert.equal(result.status, "active");
    assert.equal(calls.length, 4);
    assert.equal(
      calls[3].url,
      "https://api.example.test/v1/knowledge/batches/batch_poll?include_items=true",
    );
    assert.equal(calls[3].init.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForKnowledgeFileIndexed explains queued public upload timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("/knowledge/files/file-queued")) {
      return new Response(
        JSON.stringify({
          id: "file-queued",
          object: "knowledge_file",
          status: "queued",
          task: { id: "task-queued", status: "queued" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        id: "task-queued",
        object: "knowledge_indexing_task",
        status: "queued",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    await assert.rejects(
      () =>
        waitForKnowledgeFileIndexed(
          {
            apiBaseUrl: "https://api.example.test/v1",
            apiKey: "sk-test",
          },
          "file-queued",
          "task-queued",
        ),
      /AIcore knowledge index worker is running.*file_id=file-queued.*task_id=task-queued/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("waitForKnowledgeBatchReady returns actionable timeout message", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "batch-queued",
        status: "accepted",
        queued: 2,
        indexing: 1,
        active: 0,
        failed: 0,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    const result = await waitForKnowledgeBatchReady(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      "batch-queued",
    );

    assert.equal(result.status, "accepted");
    assert.match(result.message, /Batch batch-queued was accepted/);
    assert.match(result.message, /queued=2 indexing=1 active=0 failed=0/);
    assert.match(result.message, /AIcore knowledge index worker is running/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
