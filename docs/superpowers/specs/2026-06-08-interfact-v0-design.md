# Interfact V0 Design

## Summary

Interfact is a local-first runtime for interactive HTML artifacts that can exchange structured state with an agent through a CLI polling loop.

The agent supplies or edits an HTML artifact. Interfact serves that artifact in a browser shell, injects a small SDK, captures human interactions as queued events, and returns those events plus lightweight context when the agent runs `interfact poll`.

## Product Boundary

Interfact v0 is not an HTML generator. The agent remains responsible for creating and editing `artifact.html`.

Interfact v0 is responsible for:

- serving a local HTML artifact in an iframe
- injecting the Interfact SDK into the artifact
- capturing native HTML interactions by convention
- accepting explicit SDK events from custom interactions
- queueing events locally in the browser shell
- sending queued events only when the human clicks **Send to Agent**
- returning queued events plus lightweight context to the agent through CLI long-polling
- showing agent replies in the shell sidebar
- live-reloading the artifact when the HTML file changes

Interfact v0 intentionally does not include:

- streaming/live events while the human edits
- a browser push-state API from agent to artifact
- domain-specific Jira behavior
- cloud sync or remote collaboration
- built-in artifact generation

## User Model

The user sees an interactive HTML artifact and a compact Interfact sidebar.

The artifact is where the human does the work: forms, tables, cards, filters, approvals, comments, or custom controls.

The Interfact sidebar is where the human reviews queued events, optionally adds a freeform message, sends the batch to the agent, sees agent replies, and ends the session.

## Agent Model

The agent only needs shell access.

Primary commands:

```bash
interfact open artifact.html
interfact poll artifact.html
interfact reply artifact.html "Updated the artifact."
interfact end artifact.html
```

Expected loop:

1. Agent writes or updates `artifact.html`.
2. Agent runs `interfact open artifact.html`.
3. Human interacts with the page.
4. Human clicks **Send to Agent**.
5. Agent receives feedback from `interfact poll artifact.html`.
6. Agent acts by editing `artifact.html` and optionally sending a sidebar reply.
7. Agent polls again.

## Browser Shell

The v0 shell contains:

- artifact iframe
- compact right sidebar
- agent presence: `waiting`, `listening`, or `working`
- queued event list
- freeform message box
- **Send to Agent** button
- agent replies/chat log
- **End Session** button

The shell owns the send action. Artifacts can queue events, but v0 artifacts do not render their own canonical **Send to Agent** button.

## Artifact Authoring Contract

Interfact supports a hybrid interaction model.

### Native HTML Capture

Agents should use explicit `data-interfact-*` attributes for native controls.

Form example:

```html
<form data-interfact-event="filters.changed">
  <label>
    Priority
    <select name="priority">
      <option value="P1">P1</option>
      <option value="P2">P2</option>
      <option value="P3">P3</option>
    </select>
  </label>
</form>
```

Action example:

```html
<button
  data-interfact-action="issue.approved"
  data-interfact-entity-id="MOJO-123"
  data-interfact-label="MOJO-123: Workflow create loops forever">
  Approve
</button>
```

Entity container example:

```html
<article
  data-interfact-entity-id="MOJO-123"
  data-interfact-label="MOJO-123: Workflow create loops forever">
  <h2>Workflow create loops forever</h2>
  <select name="priority">
    <option value="P1">P1</option>
    <option value="P2" selected>P2</option>
  </select>
</article>
```

### Explicit SDK Events

For richer interactions, artifacts can call the injected SDK.

```js
window.interfact.emit({
  type: "decision.changed",
  entityId: "MOJO-123",
  label: "MOJO-123: Workflow create loops forever",
  patch: { priority: "P1", owner: "Evan" }
});
```

SDK events queue locally. They are not delivered to the agent until the human clicks **Send to Agent** in the Interfact shell.

## Poll Payload

The `poll` response returns structured events plus bounded context.

Events are the source of truth. Context is supporting evidence that helps the agent understand what happened without scraping the whole page.

Example:

```json
{
  "session": {
    "file": "/path/artifact.html",
    "status": "feedback"
  },
  "events": [
    {
      "type": "decision.changed",
      "entityId": "MOJO-123",
      "label": "MOJO-123: Workflow create loops forever",
      "source": "sdk",
      "patch": {
        "priority": "P1",
        "owner": "Evan"
      },
      "at": "2026-06-08T12:00:00.000Z"
    }
  ],
  "message": "I think this should be P1.",
  "context": {
    "title": "Mojo Jira Triage",
    "artifactKind": "triage-board",
    "changedEntities": [
      {
        "id": "MOJO-123",
        "label": "MOJO-123: Workflow create loops forever",
        "state": {
          "priority": "P1",
          "owner": "Evan"
        }
      }
    ],
    "visibleState": {
      "selectedCount": 1
    },
    "outline": [
      "section Triage Queue",
      "entity MOJO-123 Workflow create loops forever priority=P1 owner=Evan"
    ]
  },
  "next_step": "Apply the requested changes by editing the artifact or taking the approved external action, then run `interfact poll /path/artifact.html --agent-reply \"...\"`."
}
```

## Context Snapshot Rules

V0 context should be compact and predictable.

Capture:

- document title
- optional artifact metadata from `data-interfact-kind`
- changed entity IDs and labels
- form state for changed entities
- visible labels around changed controls
- compact outline of marked sections/entities

Do not capture:

- full HTML source
- large table dumps
- hidden secrets
- arbitrary script state
- full DOM text when no event points to it

## State Model

The HTML artifact file is the durable source of artifact UI state.

Interfact session state is transient and local:

- queued events
- freeform message
- chat/replies
- active session status
- presence status

The agent updates the UI by editing the HTML file. Interfact reloads the iframe after file changes.

## Companion Skill

Interfact should ship with a companion skill that teaches agents how to generate compatible artifacts.

The skill should instruct agents to:

- use native forms for structured user input
- mark important controls with `data-interfact-event` or `data-interfact-action`
- give important entities stable `data-interfact-entity-id` values
- include `data-interfact-label` for human-readable context
- distinguish draft UI state from approved actions
- rely on the outer Interfact shell for **Send to Agent**
- use `window.interfact.emit(...)` for richer domain-specific events
- include enough event payload context for the agent to act without scraping the DOM

## Implementation Shape

Recommended stack:

- Node.js CLI
- Express local server
- static browser shell
- iframe artifact host
- injected browser SDK
- JSON file session store under `.interfact/`
- file watcher for artifact reload

The implementation should be small and dependency-light.

## Testing Strategy

V0 should be tested at three levels:

- unit tests for session state, event normalization, and context extraction
- HTTP/API tests for open, poll, reply, end, and browser event submission
- one browser smoke test that opens an example artifact, queues a form/action event, sends it, and verifies poll output

## Open Later

Future versions may add:

- streaming/browser-live events
- in-artifact send buttons
- browser push-state from agent to artifact
- reusable artifact templates
- cloud session sharing
- richer visual event inspection
- domain-specific companion skills
