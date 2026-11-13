// Hand a blob to the person as a saved file (M10 Plan step 16, D7): a local object URL behind a temporary link with a `download` name, revoked soon after the click. The URL never leaves the page,
// carries no credential, and is not kept.
const REVOKE_AFTER_MS = 1000;

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
