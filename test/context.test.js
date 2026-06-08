import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClientContext, normalizeClientEvent } from "../src/context.js";

test("normalizeClientEvent preserves source of truth fields", () => {
  const event = normalizeClientEvent({
    type: "decision.changed",
    source: "sdk",
    entityId: "MOJO-123",
    label: "MOJO-123: Workflow create loops forever",
    patch: { priority: "P1" }
  });

  assert.equal(event.type, "decision.changed");
  assert.equal(event.source, "sdk");
  assert.equal(event.entityId, "MOJO-123");
  assert.deepEqual(event.patch, { priority: "P1" });
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("normalizeClientContext bounds outline and changed entities", () => {
  const context = normalizeClientContext({
    title: "Mojo Triage",
    artifactKind: "triage-board",
    changedEntities: Array.from({ length: 25 }, (_, index) => ({ id: `MOJO-${index}`, label: `Issue ${index}` })),
    outline: Array.from({ length: 80 }, (_, index) => `row ${index}`)
  });

  assert.equal(context.title, "Mojo Triage");
  assert.equal(context.artifactKind, "triage-board");
  assert.equal(context.changedEntities.length, 20);
  assert.equal(context.outline.length, 50);
});
