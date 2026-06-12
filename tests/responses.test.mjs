import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatGroundedAnswer,
  parseGroundedRagResponse,
} from "../dist/responses.js";

test("parseGroundedRagResponse extracts answer text and grounded sources", () => {
  const parsed = parseGroundedRagResponse({
    id: "resp_123",
    conversation: { id: "conv_123" },
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Brazil won the 2002 final.",
          },
        ],
      },
    ],
    metadata: {
      _aicore: {
        grounded_sources: [
          {
            label: "results.csv",
            snippet: "Brazil 2-0 Germany, 2002-06-30",
          },
        ],
        grounding_supports: [
          {
            support_index: 1,
            chunks: [1],
            text: "Brazil won the 2002 final.",
          },
        ],
      },
    },
  });

  assert.equal(parsed.text, "Brazil won the 2002 final.");
  assert.equal(parsed.responseId, "resp_123");
  assert.equal(parsed.conversationId, "conv_123");
  assert.equal(parsed.sources[0], "results.csv");
  assert.match(parsed.formattedText, /--- Sources ---/);
  assert.match(parsed.formattedText, /results\.csv/);
});

test("formatGroundedAnswer falls back to source titles", () => {
  const formatted = formatGroundedAnswer({
    text: "Answer body",
    sources: ["results.csv"],
    groundedSources: [],
    groundingSupports: [],
  });

  assert.match(formatted, /Answer body/);
  assert.match(formatted, /results\.csv/);
});
