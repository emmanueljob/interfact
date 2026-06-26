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

<button data-interfact-action="issue.approved" data-interfact-entity-id="TASK-101">
  Approve
</button>
```

Custom event capture:

```js
window.interfact.emit({
  type: "decision.changed",
  entityId: "TASK-101",
  patch: { priority: "P1" }
});
```

## Try the Example

```bash
npm install
npx playwright install chromium
node src/cli.js open examples/triage.html
node src/cli.js poll examples/triage.html
```

## Agent Skill

Interfact ships with a drop-in agent skill at [`skills/interfact/SKILL.md`](skills/interfact/SKILL.md). It teaches any coding agent when to reach for Interfact, how to set it up, the `open → poll → act → end` loop, and how to author compatible HTML artifacts. Point your agent at it (Claude Code reads it as a skill; other tools can read it as plain instructions).

## V0 Limits

- The agent generates and edits the HTML artifact.
- Interfact does not stream events while the user edits.
- Interfact does not push state directly into the artifact from the agent.
- The HTML file is the durable artifact state.
- The shell owns Send to Agent.

## License

MIT — see [LICENSE](LICENSE).
