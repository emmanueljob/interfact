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
    <section data-interfact-entity-id="MOJO-123" data-interfact-label="Workflow bug">
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
        id: "MOJO-123",
        label: "Workflow bug",
        state: { priority: "P0", summary: "Reload gap" }
      }
    ]);
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
