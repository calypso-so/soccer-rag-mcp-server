import { Blob } from "node:buffer";
import { File, FormData, fetch, Headers, Request, Response } from "undici";

const globalObject = globalThis as Record<string, unknown>;

function installMissingGlobal(name: string, value: unknown): void {
  if (typeof globalObject[name] !== "undefined") {
    return;
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

installMissingGlobal("fetch", fetch);
installMissingGlobal("Headers", Headers);
installMissingGlobal("Request", Request);
installMissingGlobal("Response", Response);
installMissingGlobal("FormData", FormData);
installMissingGlobal("Blob", Blob);
installMissingGlobal("File", File);
