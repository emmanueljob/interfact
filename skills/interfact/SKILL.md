---
name: interfact
description: Use when a task needs a human to review, edit, approve, or steer structured work through a browser UI and send that feedback back to you — triage boards, approval queues, draft editors, config builders. Interfact serves an HTML artifact in a local browser shell, captures the human's interactions as structured events, and returns them to you via a CLI polling loop. Not for one-way dashboards, visualizations, or games with no agent feedback loop.
---

# Interfact

Interfact lets you put an interactive HTML artifact ("an interfact") in front of a human, let them work in it, and get their decisions back as structured events — all from the shell. You generate and edit the HTML; Interfact handles serving it, injecting an SDK, capturing interactions, and delivering them to you when the human hits **Send to Agent**.

## When to use this

Use Interfact when the work is **human-in-the-loop**: the human needs to review, edit, approve, or steer something through a UI, and that feedback has to come back to you so you can act on it. Examples:

- a triage board where the human re-prioritizes or approves issues
- an approval queue (deploys, PRs, content) the human accepts/rejects
- a draft editor where the human revises text or config you generated
- a settings/config builder the human fills in before you proceed

**Do not use it for** one-way output with no feedback loop — dashboards, charts, data visualizations, slideshows, or games. If you just need to *show* the human something, write a plain HTML file. Interfact's whole value is the round trip.

## Setup

Interfact is a Node CLI (Node 20+). The browser shell uses Chromium.

Run it without installing, straight from GitHub:

```bash
npx github:emmanueljob/interfact <command> [args]
```

The first browser session needs Chromium available:

```bash
npx playwright install chromium
```

**Local checkout fallback** (offline, or working on Interfact itself): clone the repo and call the CLI by path — `node path/to/interfact/src/cli.js <command> [args]`. Everything below works the same; just substitute that for `npx github:emmanueljob/interfact`.

In the examples below, `interfact` stands for whichever invocation you're using.

## The loop

This is the core workflow. You drive it entirely from the shell.

1. **Write or edit `artifact.html`** — you own the HTML (see *Authoring* below).
2. **`interfact open artifact.html`** — serves the artifact in a browser shell and opens it. Pass `--no-open` to skip launching a browser (e.g. headless/CI).
3. **The human works in the page** and clicks **Send to Agent** in the shell when ready.
4. **`interfact watch artifact.html`** — blocks and keeps long-polling until the human sends feedback, then prints their events + context as JSON. (Prefer `watch` over a single `poll` — a lone poll that times out empty makes the UI feel like Send did nothing.)
5. **You act** — edit `artifact.html` to reflect changes, take whatever external action they approved, and optionally reply in the sidebar with `interfact reply` (or `poll --agent-reply`).
6. **Watch again** — repeat until done.
7. **`interfact end artifact.html`** — close the session.

```bash
interfact open artifact.html
interfact watch artifact.html
interfact reply artifact.html "Bumped TASK-101 to P1 and updated the board."
interfact end artifact.html
```

### watch vs. poll

- **`watch`** — long-polls in a loop, suppressing empty `waiting` ticks, and prints only when real feedback arrives. This is the default way to wait for a human. `--timeout-ms N` sets the per-poll block (default 300000).
- **`poll`** — a single long-poll that returns once (with feedback, or `status: "waiting"` on timeout). Use it for one-shot checks or when you want to drive the loop yourself. `--agent-reply "..."` posts a sidebar reply before waiting; `--timeout-ms N` sets the block (default 30000).

### Reading the poll payload

`poll` returns JSON. **Events are the source of truth** — they're what the human explicitly did. **Context is supporting evidence** (a bounded snapshot) so you can understand the events without scraping the DOM.

```json
{
  "session": { "file": "/path/artifact.html", "status": "feedback" },
  "events": [
    {
      "type": "decision.changed",
      "entityId": "TASK-101",
      "label": "TASK-101: Workflow create loops forever",
      "source": "sdk",
      "patch": { "priority": "P1", "owner": "Alex" },
      "at": "2026-06-08T12:00:00.000Z"
    }
  ],
  "message": "I think this should be P1.",
  "context": {
    "title": "Issue Triage",
    "artifactKind": "triage-board",
    "changedEntities": [
      { "id": "TASK-101", "label": "TASK-101: Workflow create loops forever",
        "state": { "priority": "P1", "owner": "Alex" } }
    ],
    "visibleState": { "selectedCount": 1 },
    "outline": ["section Triage Queue", "entity TASK-101 ... priority=P1 owner=Alex"]
  }
}
```

Drive your next action off `events` and the freeform `message`; lean on `context` only to disambiguate.

## Authoring the artifact

You generate the HTML. Make controls legible to Interfact using the conventions below — a hybrid of native HTML attributes (for ordinary forms/buttons) and an injected SDK (for richer events). Interfact serves the page in an iframe and injects `window.interfact`. Queued interactions are delivered to you only when the human clicks **Send to Agent** — so in v0, **do not put your own "Send to Agent" button in the artifact**; the shell owns that.

### Native forms

Use a native form with `data-interfact-event` for draft edits, filters, and structured state changes. Field `name`s become the event payload.

```html
<form data-interfact-event="filters.changed" data-interfact-label="Triage filters">
  <label>
    Priority
    <select name="priority">
      <option value="P1">P1</option>
      <option value="P2">P2</option>
    </select>
  </label>
  <button type="submit">Queue filter change</button>
</form>
```

### Action buttons

Use `data-interfact-action` for explicit actions tied to a stable entity. Always include a stable `data-interfact-entity-id` and a human-readable `data-interfact-label`.

```html
<button
  type="button"
  data-interfact-action="issue.approved"
  data-interfact-entity-id="TASK-101"
  data-interfact-label="TASK-101: Workflow create loops forever"
>
  Approve issue
</button>
```

### Custom SDK events

Use `window.interfact.emit(...)` when the event needs a custom payload.

```html
<button
  type="button"
  onclick='window.interfact.emit({ type:"decision.changed", entityId:"TASK-101", label:"TASK-101: Workflow create loops forever", patch:{priority:"P1"} })'
>
  Escalate to P1
</button>
```

You can also group an entity's controls under a container so changes are attributed correctly:

```html
<article data-interfact-entity-id="TASK-101" data-interfact-label="TASK-101: Workflow create loops forever">
  ...controls...
</article>
```

### Snapshot mode (recommended for multi-entity boards)

`emit` is a stream of *gestures* — good for "the human clicked Approve on TASK-101." But when the artifact is a **board where only the final state matters** (a triage list where the human sets priorities, changes their mind, leaves notes across many rows), use **snapshot mode** instead: register one function that returns the *current* decision for every changed row, and the shell calls it once when the human clicks **Send to Agent**.

```html
<script>
  window.addEventListener("load", () => {
    if (!window.interfact?.registerSnapshot) return; // older runtime → fall back to emit()
    window.interfact.registerSnapshot(() => ({
      type: "triage.snapshot",
      artifactKind: "triage-board",
      decisions: collectDecisions()   // [{ entityId, label, patch:{...} }, ...] — your current state
    }));
  });
</script>
```

How it behaves:

- The provider runs **on Send**, so it always reflects the latest UI — no need to re-emit on every change, no duplicate events to dedupe.
- The shell delivers one event whose `type` ends in `.snapshot` (or `source: "snapshot"`); on resend it **replaces** the prior snapshot rather than appending. Your `decisions` array rides through to the poll payload intact.
- Guard with `if (window.interfact?.registerSnapshot)` so the file still works on older runtimes (and opens cleanly as a plain file).
- Whitelisted snapshot fields that survive to the agent: `type, entityId, label, action, artifactKind, decisions, data, patch, target`. Put anything else inside `data`.

Use `emit` for one-off actions; use `registerSnapshot` for "here is my whole board."

### Authoring guidance

- Give important entities stable `data-interfact-entity-id`s so queued events join back to the right record.
- Include `data-interfact-label`s that give you enough context to act without re-reading the page.
- Keep payloads small, structured, and explicit.
- Distinguish *draft edits* from *approved actions* in your event names and controls (e.g. `decision.changed` vs `issue.approved`).
- Don't add a primary **Send to Agent** button — the shell owns it in v0.

## v0 limits

- You generate and edit the HTML artifact; Interfact does not generate it.
- No event streaming while the human edits — feedback arrives only on **Send to Agent**.
- No agent→artifact push-state; you update the UI by editing the HTML file, and Interfact live-reloads the iframe.
- The HTML file is the durable artifact state; session state (queued events, replies) is transient.

## Reference

A complete working artifact lives at `examples/triage.html` in the Interfact repo — open it with `interfact open examples/triage.html` to see the conventions in action.
