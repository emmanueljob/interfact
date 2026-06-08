import { EventEmitter } from "node:events";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import chokidar from "chokidar";
import express from "express";

import { createArtifactSdk } from "./artifact-sdk.js";
import { injectInterfactSdk } from "./html-transform.js";
import { LOOPBACK_HOST, stateFile } from "./paths.js";
import { canonicalFile, SessionStore, sessionKey } from "./session-store.js";

export function createApp({ stateFilePath = stateFile(), publicPort = 4397 } = {}) {
  const app = express();
  const store = new SessionStore(stateFilePath);
  const events = new EventEmitter();
  const activePolls = new Map();
  const eventClients = new Map();
  const artifactWatchers = new Map();

  events.setMaxListeners(0);
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (req, res) => {
    res.json({ ok: true, app: "interfact" });
  });

  app.post("/api/sessions", async (req, res, next) => {
    try {
      const file = await canonicalRequestFile(req.body?.file);
      const key = sessionKey(file);
      const url = `http://${LOOPBACK_HOST}:${publicPort}/session/${key}`;
      await ensureStateParent(stateFilePath);
      const session = await store.upsertSession(file, url);
      await watchArtifact(session, artifactWatchers, eventClients);
      res.json({
        key,
        file: session.file,
        url,
        status: "opened",
        pending_events: session.pending_events || 0
      });
    } catch (error) {
      if (sendFileNotFound(error, res)) return;
      next(error);
    }
  });

  app.get("/api/poll", async (req, res, next) => {
    try {
      const file = await canonicalRequestFile(req.query.file);
      const key = sessionKey(file);
      const immediate = await store.takeFeedback(key);
      if (immediate.status !== "waiting") {
        res.json(withNextStep(file, immediate));
        return;
      }

      const timeoutMs = parseTimeoutMs(req.query.timeoutMs);
      activePolls.set(key, (activePolls.get(key) || 0) + 1);
      let finished = false;

      const finish = async () => {
        if (finished || res.destroyed) return;
        finished = true;
        cleanup();
        try {
          if (res.writableEnded || res.destroyed) return;
          res.json(withNextStep(file, await store.takeFeedback(key)));
        } catch (error) {
          if (res.destroyed) return;
          next(error);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        events.off(`feedback:${key}`, finish);
        events.off(`ended:${key}`, finish);
        req.off("close", onClose);
        req.off("aborted", onClose);
        const count = (activePolls.get(key) || 1) - 1;
        if (count > 0) activePolls.set(key, count);
        else activePolls.delete(key);
      };
      const onClose = () => {
        if (finished) return;
        finished = true;
        cleanup();
      };
      const timer = setTimeout(finish, timeoutMs);
      events.once(`feedback:${key}`, finish);
      events.once(`ended:${key}`, finish);
      req.once("close", onClose);
      req.once("aborted", onClose);
    } catch (error) {
      if (sendFileNotFound(error, res)) return;
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
      events.emit(`feedback:${req.params.key}`);
      res.json({ status: "queued", pending_events: session.pending_events || 0 });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/:key/reply", async (req, res, next) => {
    try {
      const session = await store.addAgentReply(req.params.key, req.body?.text || "");
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      const reply = session.chat?.at(-1) || null;
      sendSessionEvent(eventClients, req.params.key, "reply", { reply });
      res.json({ status: "sent" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/:key/events", async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params.key);
      if (!session) {
        res.status(404).end();
        return;
      }
      await watchArtifact(session, artifactWatchers, eventClients);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(": connected\n\n");

      const clients = eventClients.get(req.params.key) || new Set();
      clients.add(res);
      eventClients.set(req.params.key, clients);

      const cleanup = () => {
        clients.delete(res);
        if (!clients.size) eventClients.delete(req.params.key);
      };
      req.once("close", cleanup);
      req.once("aborted", cleanup);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/:key/end", async (req, res, next) => {
    try {
      const session = await store.endSession(req.params.key);
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      events.emit(`ended:${req.params.key}`);
      await unwatchArtifact(req.params.key, artifactWatchers);
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

  app.get("/artifact/:key/index.html", async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params.key);
      if (!session) {
        res.status(404).send("Session not found");
        return;
      }
      const html = await readFile(session.file, "utf8");
      res.type("html").send(injectInterfactSdk(html, session.key));
    } catch (error) {
      next(error);
    }
  });

  app.get("/artifact/:key/*", async (req, res, next) => {
    try {
      const session = await store.findByKey(req.params.key);
      if (!session) {
        res.status(404).send("Session not found");
        return;
      }
      const root = path.dirname(session.file);
      const assetPath = path.resolve(root, req.params[0] || "");
      if (!isPathInside(root, assetPath)) {
        res.status(403).send("Forbidden");
        return;
      }
      let rootReal;
      let assetReal;
      try {
        [rootReal, assetReal] = await Promise.all([realpath(root), realpath(assetPath)]);
      } catch (error) {
        if (error?.code === "ENOENT") {
          res.status(404).send("Not found");
          return;
        }
        throw error;
      }
      if (!isPathInside(rootReal, assetReal)) {
        res.status(403).send("Forbidden");
        return;
      }
      res.sendFile(assetReal);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: error?.message || String(error) });
  });

  return app;
}

export async function serve({ port = 4397, stateFilePath } = {}) {
  const app = createApp({ stateFilePath, publicPort: port });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, LOOPBACK_HOST, () => resolve(server));
    server.once("error", reject);
  });
}

export function createShellHtml(session) {
  const sessionJson = JSON.stringify({ key: session.key, chat: session.chat || [] }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Interfact</title>
    <link rel="stylesheet" href="/shell.css">
    <script src="/shell-client.js" defer></script>
  </head>
  <body>
    <iframe id="artifact" src="/artifact/${encodeURIComponent(session.key)}/index.html"></iframe>
    <aside>
      <section id="presence">Connected</section>
      <section id="chat" aria-label="Chat"></section>
      <section id="queue"></section>
      <form id="message">
        <textarea name="message"></textarea>
        <button type="submit">Send to Agent</button>
      </form>
      <button id="end" type="button">End</button>
    </aside>
    <script id="interfact-session" type="application/json">${sessionJson}</script>
  </body>
</html>`;
}

async function watchArtifact(session, artifactWatchers, eventClients) {
  if (artifactWatchers.has(session.key)) return;

  const watcher = chokidar.watch(session.file, {
    ignoreInitial: true,
    persistent: false
  });
  const entry = { watcher };
  artifactWatchers.set(session.key, entry);

  watcher.on("change", () => {
    sendSessionEvent(eventClients, session.key, "reload", { at: new Date().toISOString() });
  });
  watcher.once("error", () => {
    artifactWatchers.delete(session.key);
  });
}

async function unwatchArtifact(key, artifactWatchers) {
  const entry = artifactWatchers.get(key);
  if (!entry) return;
  artifactWatchers.delete(key);
  await entry.watcher.close();
}

function sendSessionEvent(eventClients, key, type, payload = {}) {
  const clients = eventClients.get(key);
  if (!clients?.size) return;
  const data = JSON.stringify(payload).replace(/\u2028|\u2029/g, "");
  for (const client of clients) {
    client.write(`event: ${type}\n`);
    client.write(`data: ${data}\n\n`);
  }
}

export function withNextStep(file, response) {
  const status = response.status;
  const body = {
    ...response,
    session: { file, status }
  };

  if (status === "feedback") {
    body.next_step = `Run interfact poll ${JSON.stringify(file)} --agent-reply "<message>" after handling this feedback.`;
  }

  return body;
}

function parseTimeoutMs(value) {
  const timeoutMs = Number(value ?? 30000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return 30000;
  return timeoutMs;
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function ensureStateParent(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function canonicalRequestFile(file) {
  if (typeof file !== "string" || file.trim() === "") {
    throw fileNotFoundError();
  }

  try {
    return await canonicalFile(file);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw fileNotFoundError();
    }
    throw error;
  }
}

function fileNotFoundError() {
  const error = new Error("file not found");
  error.status = 400;
  return error;
}

function sendFileNotFound(error, res) {
  if (error?.status !== 400 || error?.message !== "file not found") return false;
  res.status(400).json({ error: "file not found" });
  return true;
}
