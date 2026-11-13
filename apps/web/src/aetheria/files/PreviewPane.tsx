// A preview of bytes the person fetched on purpose (M10 Plan step 16; step 15's verdicts). Everything shown comes from a blob made from the Backend's authorized reply: text and markdown are shown as
// plain source (a link in them is never followed, so no viewer path outside the offered set opens), HTML goes through T3's document frame (an opaque-origin sandbox, never allow-same-origin), PDF is
// T3's PDF.js viewer mounted directly (never BrowserDocumentFrame, whose native-PDF path is an unsandboxed iframe that would share the app's origin on a blob URL; step 15's `preview.pdf` verdict),
// and image, audio and video are the browser's own elements. Props in, markup out; no Backend access, and no object URL is made or revoked here.
import { lazy, Suspense } from "react";

import { BrowserDocumentFrame } from "../../components/files/BrowserDocumentFrame";
import { FileSurfaceLoading } from "../../components/files/fileSurfaceChrome";
import type { PreviewContent } from "./useFetches";

const PdfViewer = lazy(() => import("../../components/files/PdfViewer"));

export function PreviewPane({
  content,
  title,
}: {
  readonly content: PreviewContent;
  readonly title: string;
}) {
  switch (content.mode) {
    case "text":
    case "markdown":
      return (
        <div data-preview={content.mode} className="flex min-w-0 flex-col gap-1">
          {content.mode === "markdown" ? (
            <p className="text-xs text-muted-foreground">
              Markdown is shown as source; links in it are not followed here.
            </p>
          ) : null}
          <pre
            tabIndex={0}
            aria-label={`Preview of ${title}`}
            className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground"
          >
            {content.text}
          </pre>
        </div>
      );
    case "html":
      return (
        <div
          data-preview="html"
          className="flex h-96 min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border"
        >
          <BrowserDocumentFrame src={content.url} title={`Preview of ${title}`} pdf={false} />
        </div>
      );
    case "pdf":
      return (
        <div
          data-preview="pdf"
          className="flex h-96 min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border"
        >
          <Suspense fallback={<FileSurfaceLoading />}>
            <PdfViewer src={content.url} title={`Preview of ${title}`} />
          </Suspense>
        </div>
      );
    case "image":
      return (
        <div
          data-preview="image"
          className="flex min-w-0 justify-center rounded-lg bg-muted/40 p-2"
        >
          <img
            src={content.url}
            alt={`Preview of ${title}`}
            className="max-h-96 max-w-full object-contain"
          />
        </div>
      );
    case "audio":
      return (
        <div data-preview="audio" className="min-w-0">
          <audio controls src={content.url} aria-label={`Preview of ${title}`} className="w-full" />
        </div>
      );
    case "video":
      return (
        <div data-preview="video" className="min-w-0">
          <video
            controls
            src={content.url}
            aria-label={`Preview of ${title}`}
            className="max-h-96 w-full rounded-lg bg-black"
          />
        </div>
      );
  }
}
