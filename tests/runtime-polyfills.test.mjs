import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("runtime polyfills install missing Web Fetch API globals", () => {
  const script = `
    import assert from "node:assert/strict";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";

    const globals = [
      "fetch",
      "Headers",
      "Request",
      "Response",
      "FormData",
      "Blob",
      "File",
    ];

    for (const name of globals) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }

    const polyfillUrl = pathToFileURL(
      join(process.cwd(), "dist", "runtime-polyfills.js"),
    ).href;
    await import(polyfillUrl);

    for (const name of globals) {
      assert.notEqual(typeof globalThis[name], "undefined", name);
    }

    const headers = new Headers({ Authorization: "Bearer sk-test" });
    assert.equal(headers.get("Authorization"), "Bearer sk-test");
    assert.equal(new Response("ok").status, 200);
    assert.equal(new FormData().constructor.name, "FormData");
    assert.equal(new Blob(["ok"]).size, 2);
    assert.equal(
      new File(["ok"], "hello.txt", { type: "text/plain" }).name,
      "hello.txt",
    );
    assert.equal(typeof fetch, "function");
  `;

  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    `polyfill child process failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
