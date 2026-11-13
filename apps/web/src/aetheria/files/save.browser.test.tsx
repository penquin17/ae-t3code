// Saving a blob (M10 Plan step 16, D7), in a real browser. Boundary: `saveBlob` against the browser's own object URLs and anchors, with the anchor's click observed instead of letting the browser
// open a download. It shows the link a person's click would follow (a local blob URL, the chosen name, no credential) and that the URL is released; it does not show a file landing on disk.
import { expect, it, vi } from "vitest";

import { saveBlob } from "./save";

it("clicks a hidden local link carrying the file name, then removes it and revokes the URL", async () => {
  using _mocks = { [Symbol.dispose]: () => vi.restoreAllMocks() };
  const seen: Array<{ href: string; download: string; rel: string; inDocument: boolean }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    seen.push({
      href: this.href,
      download: this.download,
      rel: this.rel,
      inDocument: document.body.contains(this),
    });
  });
  const revoked: string[] = [];
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
  saveBlob(new Blob(["hello"]), "report.md");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ download: "report.md", rel: "noopener", inDocument: true });
  expect(seen[0]!.href).toMatch(/^blob:/);
  expect(seen[0]!.href).not.toMatch(/token|bearer/i);
  expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  await expect.poll(() => revoked, { timeout: 3000 }).toEqual([seen[0]!.href]);
});
