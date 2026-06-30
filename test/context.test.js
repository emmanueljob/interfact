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

test("normalizeClientEvent preserves snapshot payload fields", () => {
  const event = normalizeClientEvent({
    type: "jira.triage.snapshot",
    source: "snapshot",
    artifactKind: "snapshot-triage",
    decisions: [{ key: "TASK-1", decision: "assign", notes: "Give this to Alex" }]
  });

  assert.equal(event.type, "jira.triage.snapshot");
  assert.equal(event.source, "snapshot");
  assert.equal(event.artifactKind, "snapshot-triage");
  assert.deepEqual(event.decisions, [{ key: "TASK-1", decision: "assign", notes: "Give this to Alex" }]);
});

test("normalizeClientContext bounds outline and changed entities", () => {
  const context = normalizeClientContext({
    title: "Issue Triage",
    artifactKind: "triage-board",
    changedEntities: Array.from({ length: 25 }, (_, index) => ({ id: `TASK-${index}`, label: `Issue ${index}` })),
    outline: Array.from({ length: 80 }, (_, index) => `row ${index}`)
  });

  assert.equal(context.title, "Issue Triage");
  assert.equal(context.artifactKind, "triage-board");
  assert.equal(context.changedEntities.length, 20);
  assert.equal(context.outline.length, 50);
});

test("normalizeClientContext preserves falsy changed entity scalar fields", () => {
  const context = normalizeClientContext({
    changedEntities: [{ id: 0, label: false }]
  });

  assert.equal(context.changedEntities[0].id, "0");
  assert.equal(context.changedEntities[0].label, "false");
});
