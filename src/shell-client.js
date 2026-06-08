(function () {
  const sessionElement = document.querySelector("#interfact-session");
  const session = JSON.parse(sessionElement?.textContent || "{}");
  const artifact = document.querySelector("#artifact");
  const queueElement = document.querySelector("#queue");
  const chatElement = document.querySelector("#chat");
  const messageForm = document.querySelector("#message");
  const messageInput = messageForm?.querySelector('textarea[name="message"]');
  const endButton = document.querySelector("#end");
  const queued = [];
  let lastContext = {};
  const chat = Array.isArray(session.chat) ? [...session.chat] : [];

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

  const source = new EventSource(`/api/${encodeURIComponent(session.key)}/events`);
  source.addEventListener("reload", () => {
    if (!artifact) return;
    artifact.src = `/artifact/${encodeURIComponent(session.key)}/index.html?t=${Date.now()}`;
  });
  source.addEventListener("reply", (event) => {
    const payload = parseEventPayload(event);
    if (payload.reply) {
      chat.push(payload.reply);
      renderChat();
    }
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

  function renderChat() {
    if (!chatElement) return;
    if (!chat.length) {
      chatElement.innerHTML = '<p class="empty">No replies yet</p>';
      return;
    }
    chatElement.innerHTML = `<ol>${chat.map(renderChatMessage).join("")}</ol>`;
  }

  function renderChatMessage(message) {
    const role = message.role === "agent" ? "Agent" : "You";
    return `<li class="chat-message chat-message-${escapeAttribute(message.role || "user")}"><strong>${role}</strong><p>${escapeHtml(message.text || "")}</p></li>`;
  }

  function parseEventPayload(event) {
    try {
      return JSON.parse(event.data || "{}");
    } catch {
      return {};
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return String(value).replace(/[^a-z0-9_-]/gi, "");
  }

  renderChat();
  renderQueue();
})();
