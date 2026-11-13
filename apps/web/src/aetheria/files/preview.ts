// What may be previewed, and how (M10 Plan step 16; step 15's verdicts: previews ADAPT on blob URLs fetched from step 14's route, Office is "cannot preview — download only"). Pure: a kind and a size in,
// a plan out. Nothing here fetches or opens anything. `kindOfPath` is a display hint for an offered edit path (the Backend declares a card's kind itself); it picks a viewer for bytes the person has
// already chosen to fetch, and an unlisted extension is download only.
import type { DeliverableKind } from "@t3tools/aetheria-contracts";

/** T3's own text-preview bound (packages/shared filePreview, 1 MiB): a larger text is not read into the page. */
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;

export type PreviewPlan =
  | { readonly mode: "text" | "markdown" | "html" | "pdf" | "image" | "audio" | "video" }
  | { readonly mode: "download-only"; readonly reason: string };

export function previewPlan(kind: DeliverableKind, size: number): PreviewPlan {
  switch (kind) {
    case "office":
      // oxlint-disable-next-line t3code/no-em-dash-copy -- the accepted U3 wording (design D11): "cannot preview — download only", shown exactly
      return { mode: "download-only", reason: "Cannot preview — download only." };
    case "other":
      return { mode: "download-only", reason: "No preview for this kind of file; download it." };
    case "text":
    case "markdown":
      return size > TEXT_PREVIEW_LIMIT
        ? {
            mode: "download-only",
            reason: "Too large to preview here (limit 1 MiB); download it.",
          }
        : { mode: kind };
    default:
      return { mode: kind };
  }
}

const extensionOf = (path: string): string => {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
};
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** The type a blob needs so a frame or viewer opens it; empty lets the browser sniff (an image of an unlisted extension). */
export function mimeFor(path: string, kind: DeliverableKind): string {
  const extension = extensionOf(path);
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "text":
      return "text/plain;charset=utf-8";
    case "image":
      return IMAGE_MIME[extension] ?? "";
    case "audio":
      return AUDIO_MIME[extension] ?? "";
    case "video":
      return VIDEO_MIME[extension] ?? "";
    default:
      return "application/octet-stream";
  }
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "tsv",
  "xml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "sh",
  "bash",
  "zsh",
  "css",
  "scss",
  "sql",
  "tex",
  "bib",
  "rst",
  "diff",
  "patch",
  "env",
  "conf",
  "cfg",
  "lock",
]);
const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
]);

/** A kind read from an extension only; anything unlisted is `other`, which is download only. */
export function kindOfPath(path: string): DeliverableKind {
  const extension = extensionOf(path);
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "pdf") return "pdf";
  if (Object.hasOwn(IMAGE_MIME, extension)) return "image";
  if (Object.hasOwn(AUDIO_MIME, extension)) return "audio";
  if (Object.hasOwn(VIDEO_MIME, extension)) return "video";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "other";
}

/** The name a saved file gets: the last path segment with nothing a file system or a header would mind; `download` when nothing usable is left. */
export function filenameOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const cleaned = name.replace(/[\u0000-\u001f\u007f"<>:*?|]/g, "_").trim();
  return cleaned === "" || /^\.+$/.test(cleaned) ? "download" : cleaned;
}
