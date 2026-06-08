---
name: interfact
description: Generate interactive HTML artifacts that work with the Interfact runtime by using native forms, data-interfact attributes, and window.interfact.emit events.
---

# Interfact

Use this skill when creating an HTML artifact meant to be opened with `interfact open`.

Interfact serves the HTML artifact in an iframe and injects `window.interfact` into the page. The artifact should queue structured events for the outer Interfact shell. The outer shell owns Send to Agent; artifacts should provide focused interaction controls and event payloads.

## Native Forms

Use native forms with `data-interfact-event` for draft edits, filters, and other structured state changes.

```html
<form data-interfact-event="filters.changed">
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

## Action Buttons

Use `data-interfact-action` for explicit user actions tied to stable entities.

```html
<button
  type="button"
  data-interfact-action="issue.approved"
  data-interfact-entity-id="MOJO-123"
  data-interfact-label="MOJO-123: Workflow create loops forever"
>
  Approve issue
</button>
```

## Custom SDK Events

Use `window.interfact.emit` when the event needs a custom payload.

```html
<button
  type="button"
  onclick='window.interfact.emit({ type:"decision.changed", entityId:"MOJO-123", label:"MOJO-123: Workflow create loops forever", patch:{priority:"P1"} })'
>
  Escalate to P1
</button>
```

## Guidance

- Use stable entity IDs so queued events can be joined back to the right record.
- Include labels that give the agent enough context to understand the event.
- Keep payloads small, structured, and explicit.
- Distinguish draft edits from approved actions in event names and controls.
- Do not add a primary Send to Agent button in v0; the outer Interfact shell owns that action.
