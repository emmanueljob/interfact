export function createArtifactSdk() {
  const queued = [];

  function snapshot(sourceElement, eventData) {
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
      changedEntities: changedEntity(sourceElement, eventData),
      visibleState: {},
      outline
    };
  }

  function emit(event) {
    return emitEvent(event);
  }

  function emitEvent(event, sourceElement) {
    const normalized = normalizeEvent(event);
    queued.push(normalized);
    window.parent?.postMessage(
      { type: "interfact:events", events: [normalized], context: snapshot(sourceElement, normalized) },
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

  function changedEntity(sourceElement, eventData) {
    const element = sourceElement?.closest?.("[data-interfact-entity-id]");
    const id = eventData?.entityId ?? element?.getAttribute("data-interfact-entity-id");
    if (id === undefined || id === null || id === "") return [];

    const label =
      eventData?.label ??
      element?.getAttribute("data-interfact-label") ??
      normalizeText(element?.textContent || "");
    return [
      {
        id: String(id),
        label: String(label || ""),
        state: changedEntityState(sourceElement, eventData)
      }
    ];
  }

  function changedEntityState(sourceElement, eventData) {
    if (isPlainObject(eventData?.patch)) return eventData.patch;
    if (sourceElement?.matches?.("form") && isPlainObject(eventData?.data)) return eventData.data;
    return {};
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    const entity = form.closest("[data-interfact-entity-id]");
    emitEvent({
      source: "form",
      type: form.getAttribute("data-interfact-event") || "",
      entityId: form.getAttribute("data-interfact-entity-id") || entity?.getAttribute("data-interfact-entity-id") || undefined,
      label: form.getAttribute("data-interfact-label") || entity?.getAttribute("data-interfact-label") || undefined,
      data: formDataObject(form)
    }, form);
  });

  document.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-interfact-action]");
    if (!action) return;
    const actionType = action.getAttribute("data-interfact-action") || "";
    emitEvent({
      source: "action",
      type: actionType,
      action: actionType,
      entityId: action.getAttribute("data-interfact-entity-id") || undefined,
      label: action.getAttribute("data-interfact-label") || normalizeText(action.textContent || "") || undefined
    }, action);
  });

  window.interfact = { emit, snapshot };
  return window.interfact;
}
