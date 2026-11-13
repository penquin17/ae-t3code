// What may be previewed, and how (M10 Plan step 16, step 15's verdicts: previews ADAPT on blob URLs; Office is download only). Pure: a kind and a size in, a plan out.
import { DELIVERABLE_KINDS } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import { filenameOf, kindOfPath, mimeFor, previewPlan, TEXT_PREVIEW_LIMIT } from "./preview";

describe("previewPlan", () => {
  it("every kind the Backend can declare has a plan", () => {
    for (const kind of DELIVERABLE_KINDS) {
      expect(previewPlan(kind, 10).mode).toBeTruthy();
    }
  });

  it("text, markdown, html, pdf, image, audio and video preview in their own way", () => {
    expect(previewPlan("text", 10).mode).toBe("text");
    expect(previewPlan("markdown", 10).mode).toBe("markdown");
    expect(previewPlan("html", 10).mode).toBe("html");
    expect(previewPlan("pdf", 10).mode).toBe("pdf");
    expect(previewPlan("image", 10).mode).toBe("image");
    expect(previewPlan("audio", 10).mode).toBe("audio");
    expect(previewPlan("video", 10).mode).toBe("video");
  });

  it("Office cannot be previewed and says download only; other kinds have no preview", () => {
    const office = previewPlan("office", 10);
    expect(office).toEqual({ mode: "download-only", reason: "Cannot preview — download only." });
    expect(previewPlan("other", 10).mode).toBe("download-only");
  });

  it("text over the preview limit is download only, and the limit is T3's 1 MiB", () => {
    expect(TEXT_PREVIEW_LIMIT).toBe(1024 * 1024);
    expect(previewPlan("text", TEXT_PREVIEW_LIMIT).mode).toBe("text");
    const big = previewPlan("markdown", TEXT_PREVIEW_LIMIT + 1);
    expect(big.mode).toBe("download-only");
    expect(big.mode === "download-only" && big.reason).toContain("1 MiB");
  });
});

describe("mime, kind and file name", () => {
  it("a blob gets the type its kind needs, so a frame or viewer can open it", () => {
    expect(mimeFor("/w/a.pdf", "pdf")).toBe("application/pdf");
    expect(mimeFor("/w/a.html", "html")).toBe("text/html");
    expect(mimeFor("/w/a.PNG", "image")).toBe("image/png");
    expect(mimeFor("/w/a.mp3", "audio")).toBe("audio/mpeg");
    expect(mimeFor("/w/a.mp4", "video")).toBe("video/mp4");
    expect(mimeFor("/w/a.md", "markdown")).toBe("text/markdown;charset=utf-8");
    expect(mimeFor("/w/a.txt", "text")).toBe("text/plain;charset=utf-8");
    expect(mimeFor("/w/a.unknownimg", "image")).toBe("");
    expect(mimeFor("/w/a.xlsx", "office")).toBe("application/octet-stream");
  });

  it("an offered path's kind is read from its extension only", () => {
    expect(kindOfPath("/w/src/a.ts")).toBe("text");
    expect(kindOfPath("/w/README.md")).toBe("markdown");
    expect(kindOfPath("/w/a.html")).toBe("html");
    expect(kindOfPath("/w/a.docx")).toBe("office");
    expect(kindOfPath("/w/a.png")).toBe("image");
    expect(kindOfPath("/w/noextension")).toBe("other");
    expect(kindOfPath("/w/archive.zip")).toBe("other");
  });

  it("the saved file name is the last segment, with nothing a file system or a header would mind", () => {
    expect(filenameOf("/work/report.md")).toBe("report.md");
    expect(filenameOf("C:\\work\\report final.pdf")).toBe("report final.pdf");
    expect(filenameOf('/w/a"b<c>:d.txt')).toBe("a_b_c__d.txt");
    expect(filenameOf("/w/trailing/")).toBe("download");
    expect(filenameOf("")).toBe("download");
    expect(filenameOf("/w/..")).toBe("download");
  });
});
