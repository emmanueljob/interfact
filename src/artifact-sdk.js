export function createArtifactSdk() {
  const queued = [];

  function snapshot() {
    const root = document.documentElement;
    const body = document.body;
    const artifactKind = root?.getAttribute("data-interfact-kind") || body?.getAttribute("data-interfact-kind") || "";
    const outline = Array.from(document.querySelectorAll("[data-interfact-entity-id], [data-interfact-section]"))
      .slice(0, 50)
      .map((element) => outlineLabel(element))
      .filter(Boolean);

    return {
      title: document.title || "",
      artifactKind,
      changedEntities: [],
      visibleState: {},
      outline
    };
  }

  function emit(event) {
    const normalized = normalizeEvent(event);
    queued.push(normalized);
    window.parent?.postMessage(
      { type: "interfact:events", events: [normalized], context: snapshot() },
      "*"
    );
    return normalized;
  }

  function normalizeEvent(event) {
    const value = event && typeof event === "object" ? event : { type: event };
    return {
      ...value,
      type: String(value.type || ""),
      source: String(value.source || "sdk"),
      at: String(value.at || new Date().toISOString())
    };
  }

  function outlineLabel(element) {
    const label = normalizeText(element.getAttribute("data-interfact-label") || element.textContent || "");
    const id = element.getAttribute("data-interfact-entity-id");
    const section = element.getAttribute("data-interfact-section");
    if (id && label) return `${id}: ${label}`;
    if (id) return id;
    if (section && label) return `${section}: ${label}`;
    return section || label;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function formDataObject(form) {
    const data = {};
    for (const [key, value] of new FormData(form).entries()) {
      const normalized = typeof File !== "undefined" && value instanceof File ? value.name : value;
      if (data[key] === undefined) {
        data[key] = normalized;
      } else if (Array.isArray(data[key])) {
        data[key].push(normalized);
      } else {
        data[key] = [data[key], normalized];
      }
    }
    return data;
  }

  document.addEventListener("submit", (event) => {
    const form = event.target?.closest?.("form[data-interfact-event]");
    if (!form) return;
    event.preventDefault();
    emit({
      source: "form",
      type: form.getAttribute("data-interfact-event") || "",
      entityId: form.getAttribute("data-interfact-entity-id") || undefined,
      label: form.getAttribute("data-interfact-label") || undefined,
      data: formDataObject(form)
    });
  });

  document.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-interfact-action]");
    if (!action) return;
    const actionType = action.getAttribute("data-interfact-action") || "";
    emit({
      source: "action",
      type: actionType,
      action: actionType,
      entityId: action.getAttribute("data-interfact-entity-id") || undefined,
      label: action.getAttribute("data-interfact-label") || normalizeText(action.textContent || "") || undefined
    });
  });

  window.interfact = { emit, snapshot };
  return window.interfact;
}
