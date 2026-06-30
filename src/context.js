export function normalizeClientEvent(event) {
  const normalized = {
    type: String(event?.type || ""),
    source: String(event?.source || "browser"),
    at: String(event?.at || new Date().toISOString())
  };
  for (const key of ["entityId", "label", "action"]) {
    if (event?.[key] !== undefined) normalized[key] = String(event[key]);
  }
  if (event?.artifactKind !== undefined) normalized.artifactKind = String(event.artifactKind);
  if (event?.decisions !== undefined) normalized.decisions = clonePlainObjectArray(event.decisions, 200);
  for (const key of ["data", "patch", "target"]) {
    if (event?.[key] !== undefined) normalized[key] = clonePlainObject(event[key]);
  }
  return normalized;
}

export function normalizeClientContext(context) {
  return {
    title: String(context?.title || ""),
    artifactKind: String(context?.artifactKind || ""),
    changedEntities: normalizeArray(context?.changedEntities, 20).map((entity) => ({
      id: String(entity?.id ?? ""),
      label: String(entity?.label ?? ""),
      state: clonePlainObject(entity?.state || {})
    })),
    visibleState: clonePlainObject(context?.visibleState || {}),
    outline: normalizeArray(context?.outline, 50).map((line) => String(line).slice(0, 240))
  };
}

function normalizeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function clonePlainObjectArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(clonePlainObject);
}
