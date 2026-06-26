# Interfact V0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Interfact v0, a local-first CLI/runtime that serves interactive HTML artifacts, queues browser events, and returns them to an agent through long-polling.

**Architecture:** Implement a small Node.js ESM CLI with an Express local server, JSON session store, browser shell, injected artifact SDK, and file watcher. The HTML artifact remains the durable UI state; Interfact session state is transient local queue/chat/presence data.

**Tech Stack:** Node.js ESM, Express, Chokidar, open, node:test, supertest, Playwright smoke test.

---

## Reference Spec

- `docs/superpowers/specs/2026-06-08-interfact-v0-design.md`

## File Structure

- `package.json` - npm scripts, CLI bin, runtime and test dependencies.
- `README.md` - v0 usage and artifact contract.
- `.gitignore` - ignore dependencies, local state, logs, and test output.
- `src/cli.js` - CLI command dispatch for `open`, `poll`, `reply`, `end`, `server`.
- `src/server.js` - Express app, session APIs, long-polling, shell routes, artifact serving, SSE reload/presence.
- `src/session-store.js` - JSON-backed session state and feedback queue.
- `src/paths.js` - state paths, default port, localhost constants.
- `src/html-transform.js` - inject Interfact SDK script into served artifact HTML.
- `src/artifact-sdk.js` - browser SDK injected into the artifact iframe.
- `src/shell-client.js` - browser shell behavior: queued event list, send, chat, presence, iframe reload.
- `src/shell.css` - compact shell/sidebar styles.
- `src/context.js` - lightweight context snapshot normalization.
- `skills/interfact/SKILL.md` - companion skill for artifact generation.
- `examples/triage.html` - working example artifact.
- `test/session-store.test.js` - unit tests for session state.
- `test/context.test.js` - unit tests for context extraction payloads.
- `test/server.test.js` - API/long-poll tests.
- `test/cli.test.js` - CLI behavior tests.
- `test/smoke.spec.js` - Playwright smoke test.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/paths.js`
- Create: `test/smoke.spec.js`

- [ ] **Step 1: Initialize git and npm project files**

Create `package.json`:

```json
{
  "name": "interfact",
  "version": "0.1.0",
  "description": "Interactive artifact interface for agents.",
  "type": "module",
  "bin": {
    "interfact": "./src/cli.js"
  },
  "scripts": {
    "test": "node --test test/*.test.js",
    "test:smoke": "playwright test test/smoke.spec.js",
    "check": "npm test && npm run test:smoke"
  },
  "dependencies": {
    "chokidar": "^4.0.3",
    "express": "^4.19.2",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.3",
    "supertest": "^7.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
.interfact/
playwright-report/
test-results/
*.log
.DS_Store
```

Create initial `README.md`:

````markdown
# Interfact

Interfact is an interactive artifact interface for agents.

V0 serves a local HTML artifact in a browser shell, injects a small SDK, queues human interactions, and returns structured events plus lightweight context through `interfact poll`.

## Commands

```bash
interfact open artifact.html
interfact poll artifact.html
interfact reply artifact.html "Updated the artifact."
interfact end artifact.html
```

## Artifact Contract

Native form/action capture:

```html
<form data-interfact-event="filters.changed">
  <select name="priority">
    <option value="P1">P1</option>
    <option value="P2">P2</option>
  </select>
</form>

<button data-interfact-action="issue.approved" data-interfact-entity-id="TASK-101">
  Approve
</button>
```

Custom event capture:

```js
window.interfact.emit({
  type: "decision.changed",
  entityId: "TASK-101",
  patch: { priority: "P1" }
});
```
````

- [ ] **Step 2: Add path utilities**

Create `src/paths.js`:

```js
import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export const LOOPBACK_HOST = "127.0.0.1";

export function defaultPort() {
  return Number(process.env.INTERFACT_PORT || 4397);
}

export function stateDir(cwd = process.cwd()) {
  return process.env.INTERFACT_STATE_DIR || path.join(cwd, ".interfact");
}

export async function ensureStateDir(cwd = process.cwd()) {
  const dir = stateDir(cwd);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function stateFile(cwd = process.cwd()) {
  return path.join(stateDir(cwd), "state.json");
}

export function serverLogFile(cwd = process.cwd()) {
  return path.join(stateDir(cwd), "server.log");
}

export function homeRelative(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
}
```

- [ ] **Step 3: Add temporary smoke test that verifies scaffold loads**

Create `test/smoke.spec.js`:

```js
import { test, expect } from "@playwright/test";

test("scaffold is wired", async () => {
  expect("interfact").toBe("interfact");
});
```

- [ ] **Step 4: Install dependencies and verify scaffold**

Run:

```bash
npm install
npm test
npm run test:smoke
```

Expected:

```text
npm test exits 0
npm run test:smoke exits 0
```

- [ ] **Step 5: Commit scaffold**

Run:

```bash
git init
git add package.json package-lock.json .gitignore README.md src/paths.js test/smoke.spec.js docs/superpowers/specs/2026-06-08-interfact-v0-design.md docs/superpowers/plans/2026-06-08-interfact-v0-implementation.md
git commit -m "chore: scaffold interfact project"
```

---

### Task 2: Session Store

**Files:**
- Create: `src/session-store.js`
- Create: `test/session-store.test.js`

- [ ] **Step 1: Write failing session store tests**

Create `test/session-store.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionStore, canonicalFile, sessionKey } from "../src/session-store.js";

test("canonicalFile resolves real absolute file paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const file = path.join(dir, "artifact.html");
  await writeFile(file, "<!doctype html><title>x</title>");
  assert.equal(await canonicalFile(file), file);
});

test("sessionKey is stable and compact", () => {
  assert.equal(sessionKey("/tmp/a.html"), sessionKey("/tmp/a.html"));
  assert.equal(sessionKey("/tmp/a.html").length, 16);
});

test("upsertSession creates a session and takeFeedback waits when empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html>");
  const store = new SessionStore(path.join(dir, "state.json"));

  const session = await store.upsertSession(artifact, "http://127.0.0.1:4397/session/key");

  assert.equal(session.file, artifact);
  assert.equal(session.status, "open");
  assert.deepEqual(await store.takeFeedback(session.key), { status: "waiting" });
});

test("queueEvents and takeFeedback drain queued feedback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(artifact, "http://127.0.0.1:4397/session/key");

  await store.queueFeedback(session.key, {
    events: [{ type: "filters.changed", data: { priority: "P1" } }],
    message: "Use this filter",
    context: { title: "Artifact" }
  });

  const feedback = await store.takeFeedback(session.key);
  assert.equal(feedback.status, "feedback");
  assert.equal(feedback.events.length, 1);
  assert.equal(feedback.message, "Use this filter");
  assert.equal(feedback.context.title, "Artifact");
  assert.deepEqual(await store.takeFeedback(session.key), { status: "waiting" });
});

test("reply and end update session state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(artifact, "http://127.0.0.1:4397/session/key");

  await store.addAgentReply(session.key, "Done");
  const withReply = await store.findByKey(session.key);
  assert.equal(withReply.chat[0].text, "Done");

  await store.endSession(session.key);
  assert.deepEqual(await store.takeFeedback(session.key), { status: "ended" });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test
```

Expected:

```text
FAIL test/session-store.test.js
Cannot find module '../src/session-store.js'
```

- [ ] **Step 3: Implement session store**

Create `src/session-store.js`:

```js
import crypto from "node:crypto";
import path from "node:path";
import { readFile, realpath, writeFile } from "node:fs/promises";

export class SessionStore {
  constructor(file) {
    this.file = file;
  }

  async listSessions() {
    const state = await this.readState();
    return Object.values(state.sessions).sort((a, b) => a.file.localeCompare(b.file));
  }

  async findByKey(key) {
    const state = await this.readState();
    return state.sessions[key] || null;
  }

  async upsertSession(file, url) {
    const absolute = await canonicalFile(file);
    const key = sessionKey(absolute);
    const state = await this.readState();
    const existing = state.sessions[key] || {};
    const session = {
      key,
      file: absolute,
      url,
      status: existing.status === "ended" ? "open" : existing.status || "open",
      events: existing.events || [],
      message: existing.message || "",
      context: existing.context || {},
      pending_events: existing.pending_events || 0,
      chat: existing.chat || [],
      updated_at: new Date().toISOString()
    };
    state.sessions[key] = session;
    await this.writeState(state);
    return session;
  }

  async queueFeedback(key, payload) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    const events = Array.isArray(payload.events) ? payload.events.map(normalizeEvent) : [];
    session.events = [...(session.events || []), ...events];
    session.message = String(payload.message || "");
    session.context = normalizeObject(payload.context);
    session.pending_events = session.events.length;
    session.status = "feedback";
    session.updated_at = new Date().toISOString();
    if (session.message) {
      session.chat = [...(session.chat || []), { role: "user", text: session.message, at: session.updated_at }];
    }
    await this.writeState(state);
    return session;
  }

  async takeFeedback(key) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return { status: "missing" };
    if (session.status === "ended") return { status: "ended" };
    if (!session.events?.length && !session.message) return { status: "waiting" };
    const result = {
      status: "feedback",
      events: session.events || [],
      message: session.message || "",
      context: session.context || {}
    };
    session.events = [];
    session.message = "";
    session.context = {};
    session.pending_events = 0;
    session.status = "open";
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return result;
  }

  async addAgentReply(key, text) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    session.chat = [...(session.chat || []), { role: "agent", text: String(text || ""), at: new Date().toISOString() }];
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return session;
  }

  async endSession(key) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    session.status = "ended";
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return session;
  }

  async readState() {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      return { sessions: parsed.sessions || {} };
    } catch (error) {
      if (error?.code === "ENOENT") return { sessions: {} };
      throw error;
    }
  }

  async writeState(state) {
    await writeFile(this.file, JSON.stringify(state, null, 2) + "\n");
  }
}

export async function canonicalFile(file) {
  const absolute = path.resolve(file);
  return realpath(absolute);
}

export function sessionKey(file) {
  return crypto.createHash("sha256").update(file).digest("hex").slice(0, 16);
}

function normalizeEvent(event) {
  const normalized = {
    type: String(event.type || ""),
    source: String(event.source || "unknown"),
    at: String(event.at || new Date().toISOString())
  };
  for (const key of ["entityId", "label", "action"]) {
    if (event[key] !== undefined) normalized[key] = String(event[key]);
  }
  for (const key of ["data", "patch", "target"]) {
    if (event[key] !== undefined) normalized[key] = normalizeObject(event[key]);
  }
  return normalized;
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test
```

Expected:

```text
PASS test/session-store.test.js
```

- [ ] **Step 5: Commit session store**

Run:

```bash
git add src/session-store.js test/session-store.test.js
git commit -m "feat: add session store"
```

---

### Task 3: Context Extraction

**Files:**
- Create: `src/context.js`
- Create: `test/context.test.js`

- [ ] **Step 1: Write failing context tests**

Create `test/context.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClientContext, normalizeClientEvent } from "../src/context.js";

test("normalizeClientEvent preserves source of truth fields", () => {
  const event = normalizeClientEvent({
    type: "decision.changed",
    source: "sdk",
    entityId: "TASK-101",
    label: "TASK-101: Workflow create loops forever",
    patch: { priority: "P1" }
  });

  assert.equal(event.type, "decision.changed");
  assert.equal(event.source, "sdk");
  assert.equal(event.entityId, "TASK-101");
  assert.deepEqual(event.patch, { priority: "P1" });
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("normalizeClientContext bounds outline and changed entities", () => {
  const context = normalizeClientContext({
    title: "Issue Triage",
    artifactKind: "triage-board",
    changedEntities: Array.from({ length: 10 }, (_, index) => ({ id: `TASK-${index}`, label: `Issue ${index}` })),
    outline: Array.from({ length: 80 }, (_, index) => `row ${index}`)
  });

  assert.equal(context.title, "Issue Triage");
  assert.equal(context.artifactKind, "triage-board");
  assert.equal(context.changedEntities.length, 10);
  assert.equal(context.outline.length, 50);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test
```

Expected:

```text
FAIL test/context.test.js
Cannot find module '../src/context.js'
```

- [ ] **Step 3: Implement context normalization**

Create `src/context.js`:

```js
export function normalizeClientEvent(event) {
  const normalized = {
    type: String(event?.type || ""),
    source: String(event?.source || "browser"),
    at: String(event?.at || new Date().toISOString())
  };
  for (const key of ["entityId", "label", "action"]) {
    if (event?.[key] !== undefined) normalized[key] = String(event[key]);
  }
  for (const key of ["data", "patch", "target"]) {
    if (event?.[key] !== undefined) normalized[key] = clonePlainObject(event[key]);
  }
  return normalized;
}

export function normalizeClientContext(context) {
  return {
    title: String(context?.title || ""),
    artifactKind: String(context?.artifactKind || ""),
    changedEntities: normalizeArray(context?.changedEntities, 20).map((entity) => ({
      id: String(entity?.id || ""),
      label: String(entity?.label || ""),
      state: clonePlainObject(entity?.state || {})
    })),
    visibleState: clonePlainObject(context?.visibleState || {}),
    outline: normalizeArray(context?.outline, 50).map((line) => String(line).slice(0, 240))
  };
}

function normalizeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
```

- [ ] **Step 4: Reuse context normalization in session store**

Modify `src/session-store.js` imports and normalization:

```js
import { normalizeClientContext, normalizeClientEvent } from "./context.js";
```

Replace `normalizeEvent` usage in `queueFeedback`:

```js
const events = Array.isArray(payload.events) ? payload.events.map(normalizeClientEvent) : [];
```

Replace context assignment:

```js
session.context = normalizeClientContext(payload.context);
```

Delete the local `normalizeEvent` function from `src/session-store.js`. Keep `normalizeObject` for internal use.

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
npm test
```

Expected:

```text
PASS test/context.test.js
PASS test/session-store.test.js
```

- [ ] **Step 6: Commit context extraction**

Run:

```bash
git add src/context.js src/session-store.js test/context.test.js
git commit -m "feat: normalize event context"
```

---

### Task 4: Server APIs and Long Polling

**Files:**
- Create: `src/server.js`
- Create: `test/server.test.js`

- [ ] **Step 1: Write failing server API tests**

Create `test/server.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { createApp } from "../src/server.js";
import { stateFile } from "../src/paths.js";

test("creates session and returns shell URL", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-server-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><title>Artifact</title>");
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });

  const res = await request(app).post("/api/sessions").send({ file: artifact }).expect(200);

  assert.equal(res.body.file, artifact);
  assert.match(res.body.url, /\/session\//);
  assert.equal(res.body.status, "opened");
});

test("poll waits until browser queues feedback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-server-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><title>Artifact</title>");
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });

  const session = await request(app).post("/api/sessions").send({ file: artifact }).expect(200);
  await request(app)
    .post(`/api/${session.body.key}/feedback`)
    .send({
      events: [{ type: "filters.changed", source: "form", data: { priority: "P1" } }],
      message: "Apply this",
      context: { title: "Artifact", outline: ["form filters"] }
    })
    .expect(200);

  const poll = await request(app).get("/api/poll").query({ file: artifact, timeoutMs: 10 }).expect(200);
  assert.equal(poll.body.status, "feedback");
  assert.equal(poll.body.events[0].type, "filters.changed");
  assert.equal(poll.body.context.title, "Artifact");
});

test("reply and end endpoints update session", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-server-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><title>Artifact</title>");
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });
  const session = await request(app).post("/api/sessions").send({ file: artifact }).expect(200);

  await request(app).post(`/api/${session.body.key}/reply`).send({ text: "Done" }).expect(200);
  await request(app).post(`/api/${session.body.key}/end`).send({}).expect(200);

  const poll = await request(app).get("/api/poll").query({ file: artifact, timeoutMs: 10 }).expect(200);
  assert.equal(poll.body.status, "ended");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test
```

Expected:

```text
FAIL test/server.test.js
Cannot find module '../src/server.js'
```

- [ ] **Step 3: Implement server APIs**

Create `src/server.js`:

```js
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";

import { LOOPBACK_HOST, stateFile } from "./paths.js";
import { canonicalFile, SessionStore, sessionKey } from "./session-store.js";

export function createApp({ stateFilePath = stateFile(), publicPort = 4397 } = {}) {
  const app = express();
  const store = new SessionStore(stateFilePath);
  const events = new EventEmitter();
  const activePolls = new Map();

  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (req, res) => {
    res.json({ ok: true, app: "interfact" });
  });

  app.post("/api/sessions", async (req, res, next) => {
    try {
      const file = await canonicalFile(String(req.body.file || ""));
      const key = sessionKey(file);
      const url = `http://${LOOPBACK_HOST}:${publicPort}/session/${key}`;
      const session = await store.upsertSession(file, url);
      res.json({ key, file, url, status: "opened", pending_events: session.pending_events });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/poll", async (req, res, next) => {
    try {
      const file = await canonicalFile(String(req.query.file || ""));
      const key = sessionKey(file);
      const timeoutMs = req.query.timeoutMs === undefined ? null : Math.max(0, Number(req.query.timeoutMs || 0));
      const immediate = await store.takeFeedback(key);
      if (immediate.status !== "waiting") {
        res.json(withNextStep(file, immediate));
        return;
      }
      activePolls.set(key, (activePolls.get(key) || 0) + 1);
      const timer = timeoutMs === null ? null : setTimeout(() => respond().catch(next), timeoutMs);
      const onFeedback = (changedKey) => {
        if (changedKey === key) respond().catch(next);
      };
      const cleanup = () => {
        events.off("feedback", onFeedback);
        events.off("ended", onFeedback);
        if (timer) clearTimeout(timer);
        const count = Math.max(0, (activePolls.get(key) || 1) - 1);
        if (count) activePolls.set(key, count);
        else activePolls.delete(key);
      };
      const respond = async () => {
        if (res.writableEnded) return;
        cleanup();
        res.json(withNextStep(file, await store.takeFeedback(key)));
      };
      events.on("feedback", onFeedback);
      events.on("ended", onFeedback);
      req.on("close", cleanup);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/:key/feedback", async (req, res, next) => {
    try {
      const session = await store.queueFeedback(req.params.key, req.body || {});
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      events.emit("feedback", req.params.key);
      res.json({ status: "queued", pending_events: session.pending_events });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/:key/reply", async (req, res, next) => {
    try {
      const session = await store.addAgentReply(req.params.key, String(req.body.text || ""));
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      events.emit("reply", req.params.key);
      res.json({ status: "sent" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/:key/end", async (req, res, next) => {
    try {
      await store.endSession(req.params.key);
      events.emit("ended", req.params.key);
      res.json({ status: "ended" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/session/:key", async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params.key);
      if (!session) {
        res.status(404).send("Session not found");
        return;
      }
      res.type("html").send(createShellHtml(session));
    } catch (error) {
      next(error);
    }
  });

  app.get("/artifact/:key/index.html", async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params.key);
      if (!session) {
        res.status(404).send("Session not found");
        return;
      }
      res.type("html").send(await readFile(session.file, "utf8"));
    } catch (error) {
      next(error);
    }
  });

  app.get(/^\/artifact\/([^/]+)\/(.+)$/, async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params[0]);
      if (!session) {
        res.status(404).send("Session not found");
        return;
      }
      const root = path.dirname(session.file);
      const file = path.resolve(root, req.params[1]);
      if (!path.relative(root, file).startsWith("..")) res.sendFile(file);
      else res.status(403).send("Forbidden");
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, _next) => {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });

  return app;
}

export function serve({ port, stateFilePath } = {}) {
  const app = createApp({ stateFilePath, publicPort: port });
  return new Promise((resolve) => {
    const server = app.listen(port, LOOPBACK_HOST, () => resolve(server));
  });
}

function createShellHtml(session) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Interfact</title></head>
<body>
<main>
<iframe id="artifact" src="/artifact/${session.key}/index.html"></iframe>
<aside>
<h1>Interfact</h1>
<p id="presence">waiting</p>
<ol id="queue"></ol>
<textarea id="message"></textarea>
<button id="send">Send to Agent</button>
<button id="end">End Session</button>
</aside>
</main>
<script id="interfact-session" type="application/json">${JSON.stringify({ key: session.key, chat: session.chat || [] }).replace(/</g, "\\u003c")}</script>
</body>
</html>`;
}

function withNextStep(file, response) {
  if (response.status === "feedback") {
    return {
      ...response,
      session: { file, status: "feedback" },
      next_step: `Apply the requested changes, then run \`interfact poll ${file} --agent-reply "Updated."\`.`
    };
  }
  return { ...response, session: { file, status: response.status || "waiting" } };
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test
```

Expected:

```text
PASS test/server.test.js
PASS test/session-store.test.js
PASS test/context.test.js
```

- [ ] **Step 5: Commit server APIs**

Run:

```bash
git add src/server.js test/server.test.js
git commit -m "feat: add local server feedback APIs"
```

---

### Task 5: Artifact SDK, Shell Client, and HTML Injection

**Files:**
- Create: `src/artifact-sdk.js`
- Create: `src/html-transform.js`
- Create: `src/shell-client.js`
- Create: `src/shell.css`
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing injection test**

Append to `test/server.test.js`:

```js
test("artifact route injects Interfact SDK", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-server-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><html><body><h1>Hello</h1></body></html>");
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });
  const session = await request(app).post("/api/sessions").send({ file: artifact }).expect(200);

  const res = await request(app).get(`/artifact/${session.body.key}/index.html`).expect(200);
  assert.match(res.text, /\/sdk.js\?key=/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test
```

Expected:

```text
FAIL artifact route injects Interfact SDK
```

- [ ] **Step 3: Implement HTML transform and artifact SDK**

Create `src/html-transform.js`:

```js
export function injectInterfactSdk(html, key) {
  const script = `<script src="/sdk.js?key=${encodeURIComponent(key)}"></script>`;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${script}</body>`);
  return `${html}\n${script}`;
}
```

Create `src/artifact-sdk.js`:

```js
export function createArtifactSdk() {
  const queued = [];

  function emit(event) {
    const normalized = {
      ...event,
      type: String(event?.type || ""),
      source: String(event?.source || "sdk"),
      at: new Date().toISOString()
    };
    queued.push(normalized);
    parent.postMessage({ type: "interfact:events", events: [normalized], context: snapshot() }, "*");
  }

  function snapshot() {
    const outline = [];
    for (const el of document.querySelectorAll("[data-interfact-entity-id],[data-interfact-section]")) {
      const id = el.getAttribute("data-interfact-entity-id") || "";
      const section = el.getAttribute("data-interfact-section") || "";
      const label = el.getAttribute("data-interfact-label") || el.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) || "";
      outline.push(`${section ? "section " + section : "entity " + id} ${label}`.trim());
      if (outline.length >= 50) break;
    }
    return {
      title: document.title || "",
      artifactKind: document.documentElement.getAttribute("data-interfact-kind") || document.body.getAttribute("data-interfact-kind") || "",
      changedEntities: [],
      visibleState: {},
      outline
    };
  }

  function serializeForm(form) {
    const data = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (data[key] === undefined) data[key] = value;
      else if (Array.isArray(data[key])) data[key].push(value);
      else data[key] = [data[key], value];
    }
    return data;
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const type = form.getAttribute("data-interfact-event");
    if (!type) return;
    event.preventDefault();
    emit({
      type,
      source: "form",
      entityId: form.getAttribute("data-interfact-entity-id") || undefined,
      label: form.getAttribute("data-interfact-label") || undefined,
      data: serializeForm(form)
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-interfact-action]") : null;
    if (!target) return;
    emit({
      type: target.getAttribute("data-interfact-action") || "",
      source: "action",
      entityId: target.getAttribute("data-interfact-entity-id") || undefined,
      label: target.getAttribute("data-interfact-label") || target.textContent?.trim() || undefined,
      action: target.getAttribute("data-interfact-action") || ""
    });
  });

  window.interfact = { emit, snapshot };
}
```

- [ ] **Step 4: Implement shell client and styles**

Create `src/shell-client.js`:

```js
const session = JSON.parse(document.getElementById("interfact-session")?.textContent || "{}");
const key = session.key;
const frame = document.getElementById("artifact");
const queueList = document.getElementById("queue");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send");
const endButton = document.getElementById("end");
const queued = [];
let context = {};

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const msg = event.data || {};
  if (msg.type === "interfact:events") {
    queued.push(...(Array.isArray(msg.events) ? msg.events : []));
    context = msg.context || context;
    renderQueue();
  }
});

sendButton.addEventListener("click", async () => {
  if (!queued.length && !messageInput.value.trim()) return;
  const response = await fetch(`/api/${key}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: queued, message: messageInput.value.trim(), context })
  });
  if (!response.ok) throw new Error("failed to send feedback");
  queued.splice(0, queued.length);
  messageInput.value = "";
  renderQueue();
});

endButton.addEventListener("click", async () => {
  await fetch(`/api/${key}/end`, { method: "POST" });
});

function renderQueue() {
  queueList.innerHTML = queued.map((event) => `<li><strong>${escapeHtml(event.type)}</strong><br>${escapeHtml(event.label || event.entityId || "")}</li>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
```

Create `src/shell.css`:

```css
html,
body {
  height: 100%;
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  height: 100%;
}

iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}

aside {
  border-left: 1px solid #d7dce2;
  padding: 12px;
  background: #f8fafc;
  overflow: auto;
}

h1 {
  margin: 0 0 12px;
  font-size: 16px;
}

textarea {
  width: 100%;
  min-height: 84px;
  box-sizing: border-box;
}

button {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
}

ol {
  padding-left: 20px;
}
```

- [ ] **Step 5: Serve injected SDK, shell client, and shell CSS**

Modify imports in `src/server.js`:

```js
import { createArtifactSdk } from "./artifact-sdk.js";
import { injectInterfactSdk } from "./html-transform.js";
```

Modify shell HTML head and body scripts:

```html
<link rel="stylesheet" href="/shell.css">
```

```html
<script src="/shell-client.js"></script>
```

Add routes before artifact routes:

```js
app.get("/sdk.js", (req, res) => {
  res.type("application/javascript").send(`(${createArtifactSdk.toString()})();`);
});

app.get("/shell-client.js", async (req, res, next) => {
  try {
    res.type("application/javascript").send(await readFile(new URL("./shell-client.js", import.meta.url), "utf8"));
  } catch (error) {
    next(error);
  }
});

app.get("/shell.css", async (req, res, next) => {
  try {
    res.type("text/css").send(await readFile(new URL("./shell.css", import.meta.url), "utf8"));
  } catch (error) {
    next(error);
  }
});
```

Modify artifact HTML response:

```js
const html = await readFile(session.file, "utf8");
res.type("html").send(injectInterfactSdk(html, session.key));
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```bash
npm test
```

Expected:

```text
PASS test/server.test.js
```

- [ ] **Step 7: Commit shell and SDK**

Run:

```bash
git add src/artifact-sdk.js src/html-transform.js src/shell-client.js src/shell.css src/server.js test/server.test.js
git commit -m "feat: add browser shell and artifact sdk"
```

---

### Task 6: CLI Commands

**Files:**
- Create: `src/cli.js`
- Create: `test/cli.test.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write failing CLI output tests**

Create `test/cli.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("CLI help lists core commands", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /interfact open/);
  assert.match(result.stdout, /interfact poll/);
});

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/cli.js", ...args], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test
```

Expected:

```text
FAIL test/cli.test.js
Cannot find module '/.../src/cli.js'
```

- [ ] **Step 3: Implement CLI**

Create `src/cli.js`:

```js
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import open from "open";

import { defaultPort, ensureStateDir, LOOPBACK_HOST, stateFile } from "./paths.js";
import { canonicalFile, sessionKey } from "./session-store.js";
import { serve } from "./server.js";

const command = process.argv[2];
const args = process.argv.slice(3);

try {
  if (!command || command === "--help" || command === "-h") printHelp();
  else if (command === "open") await openCommand(args);
  else if (command === "poll") await pollCommand(args);
  else if (command === "reply") await replyCommand(args);
  else if (command === "end") await endCommand(args);
  else if (command === "server") await serverCommand(args);
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}

function printHelp() {
  console.log(`interfact

Usage:
  interfact open <html-file>
  interfact poll <html-file> [--agent-reply "..."] [--timeout-ms 1000]
  interfact reply <html-file> "message"
  interfact end <html-file>
  interfact server
`);
}

async function openCommand(args) {
  const file = args.find((arg) => !arg.startsWith("-"));
  if (!file) throw new Error("HTML file path is required");
  if (!existsSync(file)) throw new Error(`HTML file does not exist: ${file}`);
  const absolute = await canonicalFile(file);
  const baseUrl = await ensureServer();
  const response = await postJson(`${baseUrl}/api/sessions`, { file: absolute });
  if (!args.includes("--no-open")) await open(response.url);
  printJson({
    session: { file: absolute, url: response.url, status: response.status },
    next_step: `Run \`interfact poll ${absolute}\` to wait for feedback.`
  });
}

async function pollCommand(args) {
  const file = args[0];
  if (!file) throw new Error("HTML file path is required");
  const absolute = await canonicalFile(file);
  const baseUrl = await ensureServer();
  const agentReply = flagValue(args, "--agent-reply");
  if (agentReply) await postJson(`${baseUrl}/api/${sessionKey(absolute)}/reply`, { text: agentReply });
  const timeoutMs = flagValue(args, "--timeout-ms");
  const timeoutQuery = timeoutMs ? `&timeoutMs=${encodeURIComponent(timeoutMs)}` : "";
  printJson(await fetchJson(`${baseUrl}/api/poll?file=${encodeURIComponent(absolute)}${timeoutQuery}`));
}

async function replyCommand(args) {
  const file = args[0];
  const text = args.slice(1).join(" ");
  if (!file || !text) throw new Error("Usage: interfact reply <html-file> \"message\"");
  const absolute = await canonicalFile(file);
  const baseUrl = await ensureServer();
  printJson(await postJson(`${baseUrl}/api/${sessionKey(absolute)}/reply`, { text }));
}

async function endCommand(args) {
  const file = args[0];
  if (!file) throw new Error("HTML file path is required");
  const absolute = await canonicalFile(file);
  const baseUrl = await ensureServer();
  printJson(await postJson(`${baseUrl}/api/${sessionKey(absolute)}/end`, {}));
}

async function serverCommand() {
  await ensureStateDir();
  const port = defaultPort();
  await serve({ port, stateFilePath: stateFile() });
  console.error(`interfact server listening on http://${LOOPBACK_HOST}:${port}`);
}

async function ensureServer() {
  await ensureStateDir();
  const port = defaultPort();
  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;
  try {
    await fetchJson(`${baseUrl}/health`);
    return baseUrl;
  } catch {
    const cliPath = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [cliPath, "server"], {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd()
    });
    child.unref();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await fetchJson(`${baseUrl}/health`);
        return baseUrl;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("Interfact server did not start");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : String(args[index + 1] || "");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
```

- [ ] **Step 4: Make CLI executable**

Run:

```bash
chmod +x src/cli.js
```

- [ ] **Step 5: Run CLI tests**

Run:

```bash
npm test
```

Expected:

```text
PASS test/cli.test.js
```

- [ ] **Step 6: Commit CLI**

Run:

```bash
git add src/cli.js test/cli.test.js package.json
git commit -m "feat: add interfact cli"
```

---

### Task 7: Companion Skill and Example Artifact

**Files:**
- Create: `skills/interfact/SKILL.md`
- Create: `examples/triage.html`
- Modify: `README.md`

- [ ] **Step 1: Create companion skill**

Create `skills/interfact/SKILL.md`:

````markdown
---
name: interfact
description: Generate interactive HTML artifacts that work with the Interfact runtime by using native forms, data-interfact attributes, and window.interfact.emit events.
---

# Interfact Artifact Authoring

Use this skill when creating an HTML artifact meant to be opened with `interfact open`.

## Contract

Interfact serves the HTML in an iframe and injects `window.interfact`.

The artifact should queue structured events. The outer Interfact shell owns **Send to Agent**.

## Native Forms

Use forms for structured input:

```html
<form data-interfact-event="filters.changed">
  <select name="priority">
    <option value="P1">P1</option>
    <option value="P2">P2</option>
  </select>
</form>
```

## Actions

Use action buttons for discrete decisions:

```html
<button
  data-interfact-action="issue.approved"
  data-interfact-entity-id="TASK-101"
  data-interfact-label="TASK-101: Workflow create loops forever">
  Approve
</button>
```

## Custom Events

Use the SDK for richer interactions:

```js
window.interfact.emit({
  type: "decision.changed",
  entityId: "TASK-101",
  label: "TASK-101: Workflow create loops forever",
  patch: { priority: "P1" }
});
```

## Guidance

- Give important rows/cards stable `data-interfact-entity-id` values.
- Add `data-interfact-label` so the agent gets human-readable context.
- Keep event payloads small and explicit.
- Distinguish draft edits from approved actions.
- Do not add your own primary Send to Agent button in v0.
````

- [ ] **Step 2: Create example artifact**

Create `examples/triage.html`:

```html
<!doctype html>
<html data-interfact-kind="triage-board">
<head>
  <meta charset="utf-8">
  <title>Interfact Triage Example</title>
  <style>
    body { font-family: ui-sans-serif, system-ui; margin: 24px; }
    article { border: 1px solid #d7dce2; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    label { display: block; margin: 8px 0; }
    button { margin-right: 8px; }
  </style>
</head>
<body>
  <h1 data-interfact-section="Triage Queue">Triage Queue</h1>

  <form data-interfact-event="filters.changed" data-interfact-label="Triage filters">
    <label>
      Priority filter
      <select name="priority">
        <option value="all">All</option>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
      </select>
    </label>
    <button type="submit">Queue filter change</button>
  </form>

  <article data-interfact-entity-id="TASK-101" data-interfact-label="TASK-101: Workflow create loops forever">
    <h2>TASK-101: Workflow create loops forever</h2>
    <p>Current priority: P2. Owner: unassigned.</p>
    <button data-interfact-action="issue.approved" data-interfact-entity-id="TASK-101" data-interfact-label="TASK-101: Workflow create loops forever">Approve</button>
    <button onclick="window.interfact.emit({ type: 'decision.changed', entityId: 'TASK-101', label: 'TASK-101: Workflow create loops forever', patch: { priority: 'P1' } })">Queue P1 change</button>
  </article>
</body>
</html>
```

- [ ] **Step 3: Update README with example run**

Append to `README.md`:

```markdown
## Try the Example

```bash
npm install
npx playwright install chromium
node src/cli.js open examples/triage.html
node src/cli.js poll examples/triage.html
```
```

- [ ] **Step 4: Commit skill and example**

Run:

```bash
git add skills/interfact/SKILL.md examples/triage.html README.md
git commit -m "docs: add companion skill and example artifact"
```

---

### Task 8: Browser Smoke Test

**Files:**
- Modify: `test/smoke.spec.js`

- [ ] **Step 1: Replace scaffold smoke test with end-to-end browser test**

Replace `test/smoke.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApp } from "../src/server.js";
import { stateFile } from "../src/paths.js";

test("browser queues form and action events for poll", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, `<!doctype html>
<html data-interfact-kind="smoke">
<head><title>Smoke Artifact</title></head>
<body>
  <form data-interfact-event="filters.changed" data-interfact-label="Filters">
    <select name="priority"><option value="P1">P1</option></select>
    <button type="submit">Queue filter</button>
  </form>
  <button data-interfact-action="item.approved" data-interfact-entity-id="A1" data-interfact-label="A1">Approve A1</button>
</body>
</html>`);

  const server = await startTestServer(dir, 5497);
  try {
    const created = await request.post("http://127.0.0.1:5497/api/sessions", { data: { file: artifact } });
    const session = await created.json();
    await page.goto(session.url);
    await page.frameLocator("#artifact").getByText("Queue filter").click();
    await page.frameLocator("#artifact").getByText("Approve A1").click();
    await expect(page.locator("#queue li")).toHaveCount(2);
    await page.getByText("Send to Agent").click();

    const poll = await request.get("http://127.0.0.1:5497/api/poll", { params: { file: artifact, timeoutMs: "10" } });
    const feedback = await poll.json();
    expect(feedback.status).toBe("feedback");
    expect(feedback.events.map((event) => event.type)).toEqual(["filters.changed", "item.approved"]);
    expect(feedback.context.title).toBe("Smoke Artifact");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function startTestServer(dir, port) {
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: port });
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}
```

- [ ] **Step 2: Run smoke test and verify pass**

Run:

```bash
npx playwright install chromium
npm run test:smoke
```

Expected:

```text
1 passed
```

- [ ] **Step 3: Run full check**

Run:

```bash
npm run check
```

Expected:

```text
npm test exits 0
npm run test:smoke exits 0
```

- [ ] **Step 4: Commit smoke coverage**

Run:

```bash
git add test/smoke.spec.js
git commit -m "test: add browser smoke coverage"
```

---

### Task 9: Final Verification and Package Polish

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Add package metadata**

Update `package.json` to include:

```json
{
  "license": "MIT",
  "keywords": ["agents", "artifacts", "html", "cli", "human-in-the-loop"],
  "files": ["src", "skills", "examples", "README.md"]
}
```

Keep all existing fields.

- [ ] **Step 2: Add v0 limitations to README**

Append to `README.md`:

```markdown
## V0 Limits

- The agent generates and edits the HTML artifact.
- Interfact does not stream events while the user edits.
- Interfact does not push state directly into the artifact from the agent.
- The HTML file is the durable artifact state.
- The shell owns Send to Agent.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run check
node src/cli.js --help
```

Expected:

```text
npm run check exits 0
node src/cli.js --help lists open, poll, reply, end, server
```

- [ ] **Step 4: Commit polish**

Run:

```bash
git add package.json README.md
git commit -m "docs: document v0 limits"
```

---

## Self-Review Checklist

- Spec coverage: every v0 requirement in `docs/superpowers/specs/2026-06-08-interfact-v0-design.md` maps to at least one task.
- Completeness scan: this plan contains no intentionally vague implementation steps.
- Type consistency: event fields are consistently `type`, `source`, `entityId`, `label`, `data`, `patch`, `target`, and `at`.
- Scope check: streaming events, push-state, domain-specific Jira logic, and artifact generation remain out of v0.
