export function injectInterfactSdk(html, key) {
  const script = `<script src="/sdk.js?key=${encodeURIComponent(key)}"></script>`;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${script}</body>`);
  }
  return `${html}${script}`;
}
