# Interfact

Interfact is an interactive artifact interface for agents.

V0 serves a local HTML artifact in a browser shell, injects a small SDK, queues human interactions, and returns structured events plus lightweight context through `interfact poll`.

## Commands

```bash
interfact open artifact.html
interfact poll artifact.html
interfact reply artifact.html "Updated the artifact."
interfact end artifact.html
```

## Artifact Contract

Native form/action capture:

```html
<form data-interfact-event="filters.changed">
  <select name="priority">
    <option value="P1">P1</option>
    <option value="P2">P2</option>
  </select>
</form>

<button data-interfact-action="issue.approved" data-interfact-entity-id="MOJO-123">
  Approve
</button>
```

Custom event capture:

```js
window.interfact.emit({
  type: "decision.changed",
  entityId: "MOJO-123",
  patch: { priority: "P1" }
});
```
