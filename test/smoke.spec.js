import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { createApp } from "../src/server.js";
import { stateFile } from "../src/paths.js";

test("queues artifact events and sends them to the agent", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(
    artifact,
    `<!doctype html>
<html data-interfact-kind="smoke">
  <head>
    <meta charset="utf-8">
    <title>Smoke Artifact</title>
  </head>
  <body>
    <form data-interfact-event="filters.changed" data-interfact-label="Filters">
      <select name="priority">
        <option>P1</option>
      </select>
      <button type="submit">Queue filter</button>
    </form>
    <button
      data-interfact-action="item.approved"
      data-interfact-entity-id="A1"
      data-interfact-label="A1"
      type="button"
    >Approve A1</button>
  </body>
</html>
`,
    "utf8"
  );

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();
    expect(session.url.startsWith(`${baseURL}/session/`)).toBe(true);

    await page.goto(session.url);
    const frame = page.frameLocator("#artifact");
    await frame.getByRole("button", { name: "Queue filter" }).click();
    await frame.getByRole("button", { name: "Approve A1" }).click();

    await expect(page.locator("#queue li")).toHaveCount(2);
    await page.getByRole("button", { name: "Send to Agent" }).click();

    const pollResponse = await request.get(`${baseURL}/api/poll`, {
      params: { file: artifact, timeoutMs: "10" }
    });
    expect(pollResponse.ok()).toBe(true);
    const feedback = await pollResponse.json();

    expect(feedback.status).toBe("feedback");
    expect(feedback.events.map((event) => event.type)).toEqual(["filters.changed", "item.approved"]);
    expect(feedback.context.title).toBe("Smoke Artifact");
  } finally {
    await closeServer(server);
  }
});

test("reloads the artifact iframe when the artifact file changes", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, artifactHtml("Original Title", "Original body"), "utf8");

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    await expect(page.frameLocator("#artifact").getByRole("heading", { name: "Original Title" })).toBeVisible();

    await writeFile(artifact, artifactHtml("Updated Title", "Updated body"), "utf8");

    const frame = page.frameLocator("#artifact");
    await expect(frame.getByRole("heading", { name: "Updated Title" })).toBeVisible();
    await expect(frame.getByText("Updated body")).toBeVisible();
  } finally {
    await closeServer(server);
  }
});

test("shows agent replies in the sidebar", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, artifactHtml("Reply Artifact", "Body"), "utf8");

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    await expect(page.locator("#chat")).toBeVisible();

    const replyResponse = await request.post(`${baseURL}/api/${session.key}/reply`, {
      data: { text: "I updated the artifact." }
    });
    expect(replyResponse.ok()).toBe(true);

    await expect(page.locator("#chat")).toContainText("I updated the artifact.");
  } finally {
    await closeServer(server);
  }
});

test("includes changed entity form state in submitted context", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(
    artifact,
    `<!doctype html>
<html>
  <head><title>Entity Form</title></head>
  <body>
    <section data-interfact-entity-id="TASK-101" data-interfact-label="Workflow bug">
      <form data-interfact-event="issue.changed">
        <input name="priority" value="P0">
        <textarea name="summary">Reload gap</textarea>
        <button type="submit">Queue issue change</button>
      </form>
    </section>
  </body>
</html>
`,
    "utf8"
  );

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    await page.frameLocator("#artifact").getByRole("button", { name: "Queue issue change" }).click();
    await page.getByRole("button", { name: "Send to Agent" }).click();

    const pollResponse = await request.get(`${baseURL}/api/poll`, {
      params: { file: artifact, timeoutMs: "10" }
    });
    expect(pollResponse.ok()).toBe(true);
    const feedback = await pollResponse.json();

    expect(feedback.context.changedEntities).toEqual([
      {
        id: "TASK-101",
        label: "Workflow bug",
        state: { priority: "P0", summary: "Reload gap" }
      }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("batches changed entity contexts for multiple queued forms", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(
    artifact,
    `<!doctype html>
<html>
  <head><title>Batched Entities</title></head>
  <body>
    <section data-interfact-entity-id="TASK-101" data-interfact-label="Reload bug">
      <form data-interfact-event="issue.changed">
        <input name="priority" value="P0">
        <button type="submit">Queue reload change</button>
      </form>
    </section>
    <section data-interfact-entity-id="TASK-102" data-interfact-label="Reply bug">
      <form data-interfact-event="issue.changed">
        <input name="owner" value="Sam">
        <button type="submit">Queue reply change</button>
      </form>
    </section>
  </body>
</html>
`,
    "utf8"
  );

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    const frame = page.frameLocator("#artifact");
    await frame.getByRole("button", { name: "Queue reload change" }).click();
    await frame.getByRole("button", { name: "Queue reply change" }).click();
    await page.getByRole("button", { name: "Send to Agent" }).click();

    const pollResponse = await request.get(`${baseURL}/api/poll`, {
      params: { file: artifact, timeoutMs: "10" }
    });
    expect(pollResponse.ok()).toBe(true);
    const feedback = await pollResponse.json();

    expect(feedback.events).toEqual([
      expect.objectContaining({
        type: "issue.changed",
        entityId: "TASK-101",
        label: "Reload bug",
        data: { priority: "P0" }
      }),
      expect.objectContaining({
        type: "issue.changed",
        entityId: "TASK-102",
        label: "Reply bug",
        data: { owner: "Sam" }
      })
    ]);
    expect(feedback.context.changedEntities).toEqual([
      { id: "TASK-101", label: "Reload bug", state: { priority: "P0" } },
      { id: "TASK-102", label: "Reply bug", state: { owner: "Sam" } }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("collects registered artifact snapshot when sending to the agent", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(
    artifact,
    `<!doctype html>
<html data-interfact-kind="snapshot-triage">
  <head><title>Snapshot Triage</title></head>
  <body>
    <select id="decision">
      <option value="keep">Keep</option>
      <option value="assign">Assign</option>
    </select>
    <textarea id="notes"></textarea>
    <script>
      const decisions = new Map();
      const decision = document.querySelector("#decision");
      const notes = document.querySelector("#notes");

      function sync() {
        if (decision.value === "keep" && notes.value.trim() === "") {
          decisions.delete("TASK-1");
        } else {
          decisions.set("TASK-1", {
            key: "TASK-1",
            decision: decision.value,
            notes: notes.value.trim()
          });
        }
      }

      decision.addEventListener("change", sync);
      notes.addEventListener("input", sync);
      window.addEventListener("load", () => {
        window.interfact.registerSnapshot(() => ({
          type: "jira.triage.snapshot",
          artifactKind: "snapshot-triage",
          decisions: Array.from(decisions.values())
        }));
      });
    </script>
  </body>
</html>
`,
    "utf8"
  );

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    const frame = page.frameLocator("#artifact");
    await frame.locator("#decision").selectOption("assign");
    await frame.locator("#notes").fill("Give this to Alex");
    await page.getByRole("button", { name: "Send to Agent" }).click();
    await expect(page.locator("#send-status")).toContainText("Sent to agent");

    const pollResponse = await request.get(`${baseURL}/api/poll`, {
      params: { file: artifact, timeoutMs: "10" }
    });
    expect(pollResponse.ok()).toBe(true);
    const feedback = await pollResponse.json();

    expect(feedback.events).toEqual([
      expect.objectContaining({
        type: "jira.triage.snapshot",
        source: "snapshot",
        artifactKind: "snapshot-triage",
        decisions: [{ key: "TASK-1", decision: "assign", notes: "Give this to Alex" }]
      })
    ]);
    expect(feedback.context.title).toBe("Snapshot Triage");
    expect(feedback.context.artifactKind).toBe("snapshot-triage");
  } finally {
    await closeServer(server);
  }
});

test("replaces queued artifact snapshots with the latest snapshot on send", async ({ page, request }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-smoke-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(
    artifact,
    `<!doctype html>
<html data-interfact-kind="snapshot-triage">
  <head><title>Snapshot Replace</title></head>
  <body>
    <textarea id="notes"></textarea>
    <button id="queue-stale" type="button">Queue stale snapshot</button>
    <script>
      const notes = document.querySelector("#notes");
      document.querySelector("#queue-stale").addEventListener("click", () => {
        window.interfact.emit({
          type: "jira.triage.snapshot",
          source: "snapshot",
          artifactKind: "snapshot-triage",
          decisions: [{ key: "TASK-1", decision: "assign", notes: "stale" }]
        });
      });
      window.addEventListener("load", () => {
        window.interfact.registerSnapshot(() => ({
          type: "jira.triage.snapshot",
          artifactKind: "snapshot-triage",
          decisions: [{ key: "TASK-1", decision: "assign", notes: notes.value.trim() }]
        }));
      });
    </script>
  </body>
</html>
`,
    "utf8"
  );

  const { server, baseURL } = await startTestServer(dir);

  try {
    const sessionResponse = await request.post(`${baseURL}/api/sessions`, {
      data: { file: artifact }
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();

    await page.goto(session.url);
    const frame = page.frameLocator("#artifact");
    await frame.getByRole("button", { name: "Queue stale snapshot" }).click();
    await frame.locator("#notes").fill("fresh");

    await expect(page.locator("#queue li")).toHaveCount(1);
    await page.getByRole("button", { name: "Send to Agent" }).click();
    await expect(page.locator("#send-status")).toContainText("Sent to agent");

    const pollResponse = await request.get(`${baseURL}/api/poll`, {
      params: { file: artifact, timeoutMs: "10" }
    });
    expect(pollResponse.ok()).toBe(true);
    const feedback = await pollResponse.json();

    expect(feedback.events).toHaveLength(1);
    expect(feedback.events[0]).toEqual(
      expect.objectContaining({
        type: "jira.triage.snapshot",
        artifactKind: "snapshot-triage",
        decisions: [{ key: "TASK-1", decision: "assign", notes: "fresh" }]
      })
    );
  } finally {
    await closeServer(server);
  }
});

function artifactHtml(title, body) {
  return `<!doctype html>
<html>
  <head><title>${title}</title></head>
  <body>
    <h1>${title}</h1>
    <p>${body}</p>
  </body>
</html>
`;
}

async function startTestServer(dir) {
  let app;
  const server = await new Promise((resolve, reject) => {
    const listener = createServer((req, res) => app(req, res));
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve(listener));
  });

  const { port } = server.address();
  app = createApp({ stateFilePath: stateFile(dir), publicPort: port });
  return { server, baseURL: `http://127.0.0.1:${port}` };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
