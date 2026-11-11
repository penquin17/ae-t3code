// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - plain Node script: the package build and its tests run it directly.
// Generates the Aetheria icon set the web app serves from /aetheria/, from the two marks in assets/:
//   aetheria-favicon.svg                   one SVG that follows the browser's light/dark theme
//   aetheria-mark-light.svg, ...-dark.svg  the marks as drawn, for the in-app wordmark
//   favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png (180)   rasterized from the light mark
//   favicon.ico                            16, 32 and 48 pixel PNG images of the light mark
// The light mark is drawn into transparent canvases by the Chromium that Playwright already provides;
// nothing is fetched and nothing outside this package is read. The same engine gives the same bytes.
//
// Usage: node scripts/build-icons.ts [--out <dir>]

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium } from "playwright";

import { buildAdaptiveFavicon } from "../src/favicon.ts";
import { encodeIco } from "../src/ico.ts";

const packageRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const LIGHT_MARK = "aetheria-mark-light.svg";
const DARK_MARK = "aetheria-mark-dark.svg";
const PNG_SIZES = [16, 32, 48, 180] as const;

async function rasterize(svg: string): Promise<ReadonlyMap<number, Uint8Array>> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(
      async ({ markup, sizes }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        await image.decode();
        const out: Record<number, string> = {};
        for (const size of sizes) {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          canvas.getContext("2d")!.drawImage(image, 0, 0, size, size);
          out[size] = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
        }
        return out;
      },
      { markup: svg, sizes: [...PNG_SIZES] },
    );
    return new Map(
      PNG_SIZES.map((size) => [size, new Uint8Array(Buffer.from(encoded[size]!, "base64"))]),
    );
  } finally {
    await browser.close();
  }
}

/** Every generated file's name and bytes, from the marks in `assetsDir`. */
export async function buildIcons(assetsDir: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const light = NodeFS.readFileSync(NodePath.join(assetsDir, LIGHT_MARK), "utf8");
  const dark = NodeFS.readFileSync(NodePath.join(assetsDir, DARK_MARK), "utf8");
  const png = await rasterize(light);
  const text = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));
  return new Map<string, Uint8Array>([
    ["aetheria-favicon.svg", text(buildAdaptiveFavicon(light, dark))],
    [LIGHT_MARK, text(light)],
    [DARK_MARK, text(dark)],
    ["favicon-16x16.png", png.get(16)!],
    ["favicon-32x32.png", png.get(32)!],
    ["apple-touch-icon.png", png.get(180)!],
    ["favicon.ico", encodeIco([16, 32, 48].map((size) => ({ size, png: png.get(size)! })))],
  ]);
}

async function main(argv: readonly string[]): Promise<void> {
  let out = NodePath.resolve(packageRoot, "../../apps/web/public/aetheria");
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== "--out" || argv[index + 1] === undefined) {
      throw new Error("usage: build-icons.ts [--out dir]");
    }
    out = NodePath.resolve(argv[index + 1]!);
  }
  const files = await buildIcons(NodePath.join(packageRoot, "assets"));
  NodeFS.mkdirSync(out, { recursive: true });
  for (const [name, bytes] of files) NodeFS.writeFileSync(NodePath.join(out, name), bytes);
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`build-icons: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
