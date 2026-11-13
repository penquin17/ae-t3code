// PreviewPane's document previews in a real browser (M10 review 2, finding 1; step 15's verdicts for `preview.pdf` and `preview.html`). Boundary: the rendered DOM of a PDF and of an HTML preview on app-made
// blob URLs, with the browser's native-PDF capability switched on (the flag T3's frame checks). It shows that a PDF mounts the PDF.js viewer and that no iframe on the blob URL is left unsandboxed, and
// that HTML stays in a sandbox without `allow-same-origin`. It does not show the PDF.js render itself beyond its first page canvas, nor how a given browser's own PDF plugin would behave.
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

// Same stand-in as T3's PdfViewer test: a blob of the raw worker avoids the dev-server transform cost.
vi.mock(import("pdfjs-dist/build/pdf.worker.min.mjs?url"), async () => {
  const { default: source } = await import("pdfjs-dist/build/pdf.worker.min.mjs?raw");
  return {
    default: URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
  };
});

import { PreviewPane } from "./PreviewPane";

function onePagePdf(): Blob {
  const text = "BT /F1 24 Tf 30 70 Td (Quarterly outlook) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 140] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([source], { type: "application/pdf" });
}

// The capability T3's frame reads (`navigator.pdfViewerEnabled`), forced on for one test and put back when the test ends.
function nativePdfSupport() {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "pdfViewerEnabled");
  Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", {
    configurable: true,
    get: () => true,
  });
  expect(navigator.pdfViewerEnabled).toBe(true);
  return {
    [Symbol.dispose]: () => {
      if (original !== undefined)
        Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", original);
    },
  };
}

const unsandboxedOn = (url: string) =>
  [...document.querySelectorAll("iframe")].filter(
    (frame) =>
      frame.getAttribute("src")?.startsWith(url.split("#", 1)[0]!) &&
      !frame.hasAttribute("sandbox"),
  );

it("mounts the PDF.js viewer and no unsandboxed frame for a PDF, even where native PDF support is on", async () => {
  using _native = nativePdfSupport();
  const url = URL.createObjectURL(onePagePdf());
  try {
    const container = document.createElement("div");
    container.style.cssText = "display:flex;width:500px;height:600px";
    await using screen = await render(
      <PreviewPane content={{ mode: "pdf", url }} title="plan.pdf" />,
      { container },
    );
    await expect.element(screen.getByText("1 / 1 pages"), { timeout: 10_000 }).toBeVisible();
    expect(document.querySelector('canvas[aria-label="Page 1"]')).not.toBeNull();
    expect(unsandboxedOn(url)).toEqual([]);
    expect(
      [...document.querySelectorAll("iframe")].filter((frame) =>
        (frame.getAttribute("src") ?? "").startsWith("blob:"),
      ),
    ).toEqual([]);
  } finally {
    URL.revokeObjectURL(url);
  }
});

it("keeps an HTML preview in a sandbox that never grants the app's origin", async () => {
  using _native = nativePdfSupport();
  const url = URL.createObjectURL(new Blob(["<p>hi</p>"], { type: "text/html" }));
  try {
    await using _screen = await render(
      <PreviewPane content={{ mode: "html", url }} title="page.html" />,
    );
    const frames = [...document.querySelectorAll("iframe")];
    expect(frames).toHaveLength(1);
    const sandbox = frames[0]!.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    expect(sandbox!.split(/\s+/)).not.toContain("allow-same-origin");
    expect(unsandboxedOn(url)).toEqual([]);
  } finally {
    URL.revokeObjectURL(url);
  }
});
