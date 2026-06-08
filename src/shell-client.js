(function () {
  const sessionElement = document.querySelector("#interfact-session");
  const session = JSON.parse(sessionElement?.textContent || "{}");
  const artifact = document.querySelector("#artifact");
  const queueElement = document.querySelector("#queue");
  const messageForm = document.querySelector("#message");
  const messageInput = messageForm?.querySelector('textarea[name="message"]');
  const endButton = document.querySelector("#end");
  const queued = [];
  let lastContext = {};

  window.addEventListener("message", (event) => {
    if (!artifact?.contentWindow || event.source !== artifact.contentWindow) return;
    if (event.data?.type !== "interfact:events") return;

    if (Array.isArray(event.data.events)) queued.push(...event.data.events);
    lastContext = event.data.context || {};
    renderQueue();
  });

  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = messageInput?.value || "";
    const response = await fetch(`/api/${encodeURIComponent(session.key)}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: queued, message, context: lastContext })
    });
    if (!response.ok) return;
    queued.splice(0, queued.length);
    if (messageInput) messageInput.value = "";
    renderQueue();
  });

  endButton?.addEventListener("click", async () => {
    await fetch(`/api/${encodeURIComponent(session.key)}/end`, { method: "POST" });
  });

  function renderQueue() {
    if (!queueElement) return;
    if (!queued.length) {
      queueElement.innerHTML = '<p class="empty">No queued events</p>';
      return;
    }
    queueElement.innerHTML = `<ol>${queued.map(renderEvent).join("")}</ol>`;
  }

  function renderEvent(event) {
    const label = [event.type, event.label].filter(Boolean).join(" · ");
    return `<li><strong>${escapeHtml(label || "event")}</strong><pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre></li>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  renderQueue();
})();
