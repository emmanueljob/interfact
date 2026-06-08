import crypto from "node:crypto";
import path from "node:path";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";

import { normalizeClientContext, normalizeClientEvent } from "./context.js";

const SKIP_WRITE = Symbol("skipWrite");

export class SessionStore {
  constructor(file) {
    this.file = file;
    this.mutationQueue = Promise.resolve();
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
    return this.updateState((state) => {
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
      return session;
    });
  }

  async queueFeedback(key, payload) {
    return this.updateState((state) => {
      const session = state.sessions[key];
      if (!session) return null;
      const events = Array.isArray(payload.events) ? payload.events.map(normalizeClientEvent) : [];
      session.events = [...(session.events || []), ...events];
      session.message = String(payload.message || "");
      session.context = normalizeClientContext(payload.context);
      session.pending_events = session.events.length;
      session.status = "feedback";
      session.updated_at = new Date().toISOString();
      if (session.message) {
        session.chat = [...(session.chat || []), { role: "user", text: session.message, at: session.updated_at }];
      }
      return session;
    });
  }

  async takeFeedback(key) {
    return this.updateState((state) => {
      const session = state.sessions[key];
      if (!session) return skipWrite({ status: "missing" });
      if (session.status === "ended") return skipWrite({ status: "ended" });
      if (!session.events?.length && !session.message) return skipWrite({ status: "waiting" });
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
      return result;
    });
  }

  async addAgentReply(key, text) {
    return this.updateState((state) => {
      const session = state.sessions[key];
      if (!session) return null;
      session.chat = [...(session.chat || []), { role: "agent", text: String(text || ""), at: new Date().toISOString() }];
      session.updated_at = new Date().toISOString();
      return session;
    });
  }

  async endSession(key) {
    return this.updateState((state) => {
      const session = state.sessions[key];
      if (!session) return null;
      session.status = "ended";
      session.updated_at = new Date().toISOString();
      return session;
    });
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

  async updateState(fn) {
    const operation = this.mutationQueue.then(async () => {
      const state = await this.readState();
      const result = await fn(state);
      if (result?.[SKIP_WRITE]) return result.value;
      await this.writeState(state);
      return result;
    });
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }

  async writeState(state) {
    const tempFile = `${this.file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(state, null, 2) + "\n");
    await rename(tempFile, this.file);
  }
}

export async function canonicalFile(file) {
  const absolute = path.resolve(file);
  return realpath(absolute);
}

export function sessionKey(file) {
  return crypto.createHash("sha256").update(file).digest("hex").slice(0, 16);
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function skipWrite(value) {
  return { [SKIP_WRITE]: true, value };
}
