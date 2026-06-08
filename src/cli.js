#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import openBrowser from "open";

import { ensureStateDir, LOOPBACK_HOST, defaultPort, stateFile } from "./paths.js";
import { serve } from "./server.js";
import { canonicalFile, sessionKey } from "./session-store.js";

const HELP = `Usage: interfact <command> [options]

Commands:
  interfact open <html-file> [--no-open]
  interfact poll <html-file> [--agent-reply "..."] [--timeout-ms N]
  interfact reply <html-file> "message"
  interfact end <html-file>
  interfact server

Options:
  -h, --help     Show this help
`;

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }

  if (command === "server") {
    await runServer();
    return;
  }

  if (command === "open") {
    await runOpen(args);
    return;
  }

  if (command === "poll") {
    await runPoll(args);
    return;
  }

  if (command === "reply") {
    await runReply(args);
    return;
  }

  if (command === "end") {
    await runEnd(args);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

async function runOpen(args) {
  const { values, flags } = parseArgs(args, new Set(["no-open"]));
  const file = await canonicalHtmlFile(values[0]);
  const baseUrl = await ensureServer();
  const session = await postJson(`${baseUrl}/api/sessions`, { file });

  if (!flags.has("no-open")) {
    await openBrowser(session.url);
  }

  printJson({
    session,
    next_step: `Run interfact poll ${JSON.stringify(file)} to wait for feedback.`
  });
}

async function runPoll(args) {
  const { values, options } = parseArgs(args, new Set(), new Set(["agent-reply", "timeout-ms"]));
  const file = await canonicalHtmlFile(values[0]);
  const baseUrl = await ensureServer();
  const key = sessionKey(file);

  if (options.has("agent-reply")) {
    await postJson(`${baseUrl}/api/${encodeURIComponent(key)}/reply`, { text: options.get("agent-reply") });
  }

  const timeoutMs = options.get("timeout-ms") ?? "30000";
  const url = new URL("/api/poll", baseUrl);
  url.searchParams.set("file", file);
  url.searchParams.set("timeoutMs", timeoutMs);
  printJson(await getJson(url));
}

async function runReply(args) {
  const file = await canonicalHtmlFile(args[0]);
  const message = args[1];
  if (typeof message !== "string") throw new Error("reply requires a message");

  const baseUrl = await ensureServer();
  const key = sessionKey(file);
  printJson(await postJson(`${baseUrl}/api/${encodeURIComponent(key)}/reply`, { text: message }));
}

async function runEnd(args) {
  const file = await canonicalHtmlFile(args[0]);
  const baseUrl = await ensureServer();
  const key = sessionKey(file);
  printJson(await postJson(`${baseUrl}/api/${encodeURIComponent(key)}/end`, {}));
}

async function runServer() {
  await ensureStateDir();
  const port = defaultPort();
  await serve({ port, stateFilePath: stateFile() });
  process.stderr.write(`interfact server listening on http://${LOOPBACK_HOST}:${port}\n`);
}

export async function ensureServer() {
  const port = defaultPort();
  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;
  if (await isHealthy(baseUrl)) return baseUrl;

  await ensureStateDir();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "server"], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: "ignore"
  });
  child.unref();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl)) return baseUrl;
    await delay(100);
  }

  throw new Error(`interfact server did not become healthy at ${baseUrl}/health`);
}

async function isHealthy(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function canonicalHtmlFile(file) {
  if (typeof file !== "string" || file.trim() === "") {
    throw new Error("html-file is required");
  }
  await access(file);
  return canonicalFile(file);
}

async function getJson(url) {
  return readJsonResponse(await fetch(url));
}

async function postJson(url, body) {
  return readJsonResponse(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

async function readJsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

function parseArgs(args, booleanFlags = new Set(), valueFlags = new Set()) {
  const values = [];
  const flags = new Set();
  const options = new Map();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split("=", 2);
      if (booleanFlags.has(name)) {
        flags.add(name);
        continue;
      }
      if (valueFlags.has(name)) {
        const value = inlineValue ?? args[++i];
        if (typeof value !== "string") throw new Error(`--${name} requires a value`);
        options.set(name, value);
        continue;
      }
    }
    values.push(arg);
  }

  return { values, flags, options };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}
