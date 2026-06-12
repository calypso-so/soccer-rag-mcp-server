# Batch Upload Feature Comparison: Calypso MCP vs RAG Anything MCP

## Executive Summary

The Calypso MCP and `rag-anything-mcp` both let users ingest multiple documents for RAG, but they solve different user problems.

Calypso MCP is a hosted, durable knowledge ingestion surface. Its batch upload tool, `calypso-upload-knowledge-files-batch`, creates upload sessions for 1 to 100 files, uploads bytes directly to storage, finalizes durable knowledge records, assigns files to buckets, returns batch status, and can poll until the batch reaches a terminal indexing state.

`rag-anything-mcp` is a local workspace ingestion server built on RAGAnything and LightRAG. Its closest batch feature is `process_directory`, which scans a local folder and processes matching files into a local shared workspace with multimodal parsing and graph-backed querying.

In short: Calypso MCP is stronger for production/team knowledge operations; `rag-anything-mcp` is stronger for local exploratory directory ingestion.

## Side-By-Side User-Facing Comparison

| Area | Calypso MCP Batch Uploads | `rag-anything-mcp` Directory Ingestion |
| --- | --- | --- |
| Main user-facing batch tool | `calypso-upload-knowledge-files-batch` | `process_directory` |
| Batch model | Explicit list of files that become one batch upload-session flow. | Local directory scan over matching file extensions. |
| File input | Each item supports `contentBase64` or `filePath`. | Uses local `directory_path`; single-file flow uses local `file_path`. |
| Remote execution fit | Strong. `contentBase64` works well for Smithery and remote MCP clients. | Limited. Requires MCP server access to the local filesystem path. |
| Batch size | Client-side max of 100 files per request. | No explicit MCP-level batch size cap; practical limits depend on machine, memory, parser, and `max_workers`. |
| Concurrency | Backend handles durable acceptance and queues indexing. User controls request size, not parser workers. | User controls local parser concurrency through `max_workers`, defaulting to 4. |
| Status model | Returns batch id, item statuses, accepted/rejected counts, queued/indexing/active/failed counters, and optional polling with `waitForBatchReady`. | Returns a final text message after `process_folder_complete`; no public per-file batch id or polling contract. |
| Query readiness | Explicitly distinguishes accepted/queued from indexed and bucket-ready states. | Processing call is expected to complete before querying; readiness is mostly implicit. |
| Idempotency | Requires `batchIdempotencyKey`; each item gets deterministic or supplied `clientFileId`. | Avoids reprocessing by checking already ingested documents by filename, but does not expose a user-facing idempotency key. |
| Dry run | No dry-run tool; upload-session creation validates metadata before bytes are finalized. | No equivalent dry-run workflow in the MCP tool. |
| Bucket or collection assignment | Supports shared and per-item `bucketIds`, `bucketSlugs`, `bucket`, and `createMissingBuckets`. | No team bucket concept. Everything lands in the configured local workspace. |
| Per-item metadata | Supports `title`, `tags`, and `metadata` per item, plus shared bucket defaults. | Does not expose comparable per-file metadata fields in `process_directory`. |
| Storage model | Hosted Calypso/AIcore durable storage, Firestore catalog, queue jobs, Gemini File Search indexing, and bucket stores. | Local `SHARED_WORKDIR` plus `OUTPUT_DIR`, backed by LightRAG/RAGAnything local storage. |
| Retrieval target | Calypso RAG agent and bucket-scoped retrieval policies. | `query_workspace` and `query_with_multimodal` over the local shared workspace. |
| Multimodal processing | Calypso positions the hosted layer for PDFs, docs, screenshots, charts, diagrams, images, and internal knowledge through Gemini File Search and Calypso RAG. | Directly exposes RAGAnything multimodal extraction for images, tables, equations, charts, and mixed content. |
| Operational dependency | Requires Calypso API key and an AIcore deployment with the durable indexing worker running. | Requires `OPENAI_API_KEY`, local dependencies, local CPU/GPU resources, and filesystem access. |
| Team/shared use | Designed for team-scoped hosted knowledge and reusable buckets. | Designed around one local shared workspace per MCP server process/config. |
| Failure visibility | API errors preserve codes such as `batch_too_large`, `duplicate_client_file_id`, `missing_file_parts`, and indexing status per batch item. | Mostly returns tool-level strings/errors; fewer structured per-file failure details in the MCP surface. |
| Destructive operations | Batch upload is additive; separate tools handle querying. | Includes `clear_all_data(confirm=True)`, which deletes local workspace/output data. |

## Workflow Comparison

### Calypso MCP Batch Workflow

1. User calls `calypso-upload-knowledge-files-batch`.
2. User provides `items`, `batchIdempotencyKey`, and optional shared bucket defaults.
3. Each item supplies either `contentBase64` or `filePath`.
4. Calypso creates upload sessions and returns direct storage upload URLs.
5. The MCP uploads each file directly to storage and finalizes the batch session.
6. Tool returns a batch object with finalized/pending/failed item details.
7. If `waitForBatchReady` is true, the tool polls `GET /v1/knowledge/batches/{batch_id}?include_items=true`.
8. Files become useful for retrieval after indexing reaches active and bucket sync is active.

```mermaid
flowchart LR
  userCall["MCP Client"] --> calypsoTool["calypso-upload-knowledge-files-batch"]
  calypsoTool --> sessionApi["Calypso batch upload-session API"]
  sessionApi --> directStorage["Direct storage uploads"]
  directStorage --> finalize["Finalize batch session"]
  finalize --> durableQueue["Durable Index Queue"]
  durableQueue --> indexWorker["AIcore Index Worker"]
  indexWorker --> bucketStore["Bucket Retrieval Store"]
  bucketStore --> ragAgent["Calypso RAG Agent"]
```

### RAG Anything MCP Directory Workflow

1. User calls `process_directory`.
2. User provides a local `directory_path`, optional `file_extensions`, `recursive`, and `max_workers`.
3. MCP scans the local directory for matching files.
4. Already-ingested files are skipped by filename check.
5. New or changed files are processed through `rag.process_folder_complete`.
6. User queries the shared workspace with `query_workspace` or `query_with_multimodal`.

```mermaid
flowchart LR
  userCall["MCP Client"] --> processDirectory["process_directory"]
  processDirectory --> localScan["Local Directory Scan"]
  localScan --> ragAnything["RAGAnything Processing"]
  ragAnything --> lightRag["LightRAG Workspace"]
  lightRag --> queryWorkspace["query_workspace"]
```

## Strengths And Gaps

### Calypso MCP Strengths

- Production-friendly hosted ingestion with API-key authentication.
- Durable batch ids, item ids, idempotency, and explicit status polling.
- Supports both local desktop `filePath` and remote `contentBase64` clients.
- Supports bucket assignment, bucket creation, and bucket-ready status.
- Better fit for team knowledge bases, hosted agents, and MCP registry distribution.

### Calypso MCP Gaps

- Batch size is intentionally capped at 100 files per request.
- It depends on AIcore worker health for accepted files to become query-ready.
- It does not currently expose a local directory scan helper like `process_directory`.
- Rich document parsing is abstracted behind the hosted Calypso/Gemini path rather than user-tunable parser flags.

### `rag-anything-mcp` Strengths

- Very natural local batch ingestion: point it at a folder and process matching files.
- User can tune local processing concurrency with `max_workers`.
- Strong local multimodal parsing story through RAGAnything: images, tables, equations, charts, and mixed content.
- Simple local workspace mental model for exploratory research.
- Includes local query modes such as `hybrid`, `local`, `global`, `naive`, `mix`, and `bypass`.

### `rag-anything-mcp` Gaps

- Not a remote durable upload API.
- No explicit public batch id, per-item batch status, or polling endpoint.
- No team-scoped bucket assignment, bucket sync, or hosted catalog semantics.
- Relies on local filesystem access, local dependencies, and local machine capacity.
- Idempotency is implicit filename-based skip behavior, not a retry-safe request contract.

## Recommendation

Use Calypso MCP when the user needs production-grade hosted ingestion: team knowledge bases, bucketed retrieval, repeatable API uploads, remote MCP execution, status visibility, and durable queue-backed indexing.

Use `rag-anything-mcp` when the user needs local exploratory analysis: processing a directory of files already on disk, experimenting with multimodal extraction, and querying a local LightRAG workspace.

The best feature cross-pollination would be:

- Add a Calypso MCP convenience helper that accepts a local directory, chunks it into 100-file batch requests, and reuses `calypso-upload-knowledge-files-batch` internally.
- Add explicit batch ids, per-file status, and idempotency semantics to `rag-anything-mcp` if it becomes a production-facing ingestion surface.

## Bottom Line

Calypso MCP is the stronger user-facing choice for production batch uploads. `rag-anything-mcp` is the stronger user-facing choice for local directory ingestion and parser-heavy multimodal experimentation.
