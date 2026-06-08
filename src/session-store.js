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
  await realpath(absolute);
  return absolute;
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
