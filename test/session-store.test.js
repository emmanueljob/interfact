import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionStore, canonicalFile, sessionKey } from "../src/session-store.js";

test("canonicalFile resolves real absolute file paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const file = path.join(dir, "artifact.html");
  await writeFile(file, "<!doctype html><title>x</title>");
  assert.equal(await canonicalFile(file), await realpath(file));
});

test("canonicalFile resolves symlink paths to real target paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const target = path.join(dir, "artifact.html");
  const link = path.join(dir, "artifact-link.html");
  await writeFile(target, "<!doctype html><title>x</title>");
  await symlink(target, link);
  assert.equal(await canonicalFile(link), await realpath(target));
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

  assert.equal(session.file, await realpath(artifact));
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

test("concurrent queueFeedback calls preserve all events and chat messages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-store-"));
  const artifact = path.join(dir, "artifact.html");
  const stateFile = path.join(dir, "state.json");
  await writeFile(artifact, "<!doctype html>");
  const store = new SessionStore(stateFile);
  const session = await store.upsertSession(artifact, "http://127.0.0.1:4397/session/key");

  await Promise.all([
    store.queueFeedback(session.key, {
      events: [{ type: "filters.changed", data: { priority: "P1" } }],
      message: "Use the P1 filter"
    }),
    store.queueFeedback(session.key, {
      events: [{ type: "selection.changed", data: { id: "row-2" } }],
      message: "Select row 2"
    })
  ]);

  const feedback = await store.takeFeedback(session.key);
  assert.equal(feedback.status, "feedback");
  assert.deepEqual(
    feedback.events.map((event) => event.type).sort(),
    ["filters.changed", "selection.changed"]
  );

  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const chatMessages = state.sessions[session.key].chat
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.text)
    .sort();
  assert.deepEqual(chatMessages, ["Select row 2", "Use the P1 filter"]);
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
