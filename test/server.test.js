import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { createApp } from "../src/server.js";
import { stateFile } from "../src/paths.js";

async function createArtifact() {
  const dir = await mkdtemp(path.join(await realpath(os.tmpdir()), "interfact-server-"));
  const file = path.join(dir, "artifact.html");
  await writeFile(file, "<!doctype html><title>Artifact</title>");
  return { dir, file };
}

test("POST /api/sessions opens an artifact session", async () => {
  const { dir, file } = await createArtifact();
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });

  const response = await request(app).post("/api/sessions").send({ file }).expect(200);

  assert.equal(response.body.file, file);
  assert.match(response.body.url, /\/session\//);
  assert.equal(response.body.status, "opened");
});

test("poll returns queued feedback with normalized context", async () => {
  const { dir, file } = await createArtifact();
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });
  const opened = await request(app).post("/api/sessions").send({ file }).expect(200);

  await request(app)
    .post(`/api/${opened.body.key}/feedback`)
    .send({
      events: [{ type: "filters.changed", data: { priority: "P1" } }],
      message: "Use this filter",
      context: { title: "Artifact" }
    })
    .expect(200);

  const response = await request(app).get("/api/poll").query({ file, timeoutMs: 10 }).expect(200);

  assert.equal(response.body.status, "feedback");
  assert.equal(response.body.events[0].type, "filters.changed");
  assert.equal(response.body.context.title, "Artifact");
});

test("poll returns ended after reply and end", async () => {
  const { dir, file } = await createArtifact();
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });
  const opened = await request(app).post("/api/sessions").send({ file }).expect(200);

  await request(app).post(`/api/${opened.body.key}/reply`).send({ text: "Done" }).expect(200);
  await request(app).post(`/api/${opened.body.key}/end`).expect(200);

  const response = await request(app).get("/api/poll").query({ file, timeoutMs: 10 }).expect(200);

  assert.equal(response.body.status, "ended");
});

test("sessions returns stable 400 for a missing artifact file", async () => {
  const { dir } = await createArtifact();
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });

  const response = await request(app)
    .post("/api/sessions")
    .send({ file: path.join(dir, "missing.html") })
    .expect(400);

  assert.deepEqual(response.body, { error: "file not found" });
});

test("poll returns stable 400 for a missing artifact file", async () => {
  const { dir } = await createArtifact();
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });

  const response = await request(app)
    .get("/api/poll")
    .query({ file: path.join(dir, "missing.html"), timeoutMs: 10 })
    .expect(400);

  assert.deepEqual(response.body, { error: "file not found" });
});

test("artifact assets cannot escape the artifact directory through symlinks", async () => {
  const { dir, file } = await createArtifact();
  const outside = path.join(await mkdtemp(path.join(await realpath(os.tmpdir()), "interfact-outside-")), "secret.txt");
  await writeFile(outside, "secret");
  await symlink(outside, path.join(dir, "linked-secret.txt"));
  const app = createApp({ stateFilePath: stateFile(dir), publicPort: 4397 });
  const opened = await request(app).post("/api/sessions").send({ file }).expect(200);

  await request(app).get(`/artifact/${opened.body.key}/linked-secret.txt`).expect(403);
});
