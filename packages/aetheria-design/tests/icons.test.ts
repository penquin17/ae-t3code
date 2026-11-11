// @effect-diagnostics nodeBuiltinImport:off - reads the package's own assets and the web app's generated icons.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { buildIcons } from "../scripts/build-icons.ts";
import { buildAdaptiveFavicon } from "../src/favicon.ts";
import { encodeIco, readIco, readPngSize } from "../src/ico.ts";

const packageRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const assetsDir = NodePath.join(packageRoot, "assets");
const publicDir = NodePath.join(packageRoot, "../../apps/web/public/aetheria");
const sha256 = (bytes: Uint8Array | string) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");

// The marks as copied once from artifacts/aetheria-logo-transparent-2026-11-03/ (outer commit dc209220).
const LIGHT_MARK_SHA256 = "27bac7bb842ddc7a3a46a7fcad92dbea7cfe7ef39284794d2dffd298bdebfc9a";
const DARK_MARK_SHA256 = "8df1219fb7b710d37ca3edd7c2118b533a33501fd5c5216a5b98509573a67bc5";

const light = NodeFS.readFileSync(NodePath.join(assetsDir, "aetheria-mark-light.svg"), "utf8");
const dark = NodeFS.readFileSync(NodePath.join(assetsDir, "aetheria-mark-dark.svg"), "utf8");

/** The smallest byte string readPngSize accepts: signature, then an IHDR chunk of the given size. */
function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("the source marks", () => {
  it("are the copied artwork, unchanged", () => {
    expect(sha256(light)).toBe(LIGHT_MARK_SHA256);
    expect(sha256(dark)).toBe(DARK_MARK_SHA256);
  });

  it("are 64 by 64, transparent (no tile, no raster) and self-contained", () => {
    for (const [name, svg] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      expect(svg, name).toContain('viewBox="0 0 64 64"');
      expect(svg, name).not.toMatch(/<rect|<image|href=|<script|url\(#tile\)/);
    }
  });
});

describe("the .ico writer", () => {
  it("writes a header, a directory and the payloads at the offsets it records", () => {
    const images = [16, 32, 48].map((size) => ({ size, png: fakePng(size, size) }));
    const ico = encodeIco(images);
    const entries = readIco(ico);
    expect(entries.map((entry) => entry.size)).toEqual([16, 32, 48]);
    expect(entries[0]!.offset).toBe(6 + 16 * 3);
    let end = 6 + 16 * 3;
    for (const [index, entry] of entries.entries()) {
      expect(entry.offset).toBe(end);
      expect(entry.length).toBe(images[index]!.png.length);
      expect(Array.from(ico.subarray(entry.offset, entry.offset + entry.length))).toEqual(
        Array.from(images[index]!.png),
      );
      end += entry.length;
    }
    expect(end).toBe(ico.length);
  });

  it("refuses an empty set, a bad size, a size that differs from the PNG, and a non-PNG", () => {
    expect(() => encodeIco([])).toThrow(/at least one/);
    expect(() => encodeIco([{ size: 0, png: fakePng(0, 0) }])).toThrow(/1 to 256/);
    expect(() => encodeIco([{ size: 300, png: fakePng(300, 300) }])).toThrow(/1 to 256/);
    expect(() => encodeIco([{ size: 16, png: fakePng(32, 32) }])).toThrow(
      /16px icon entry holds a 32x32/,
    );
    expect(() => encodeIco([{ size: 16, png: new Uint8Array(40) }])).toThrow(/not a PNG/);
    expect(() => readIco(new Uint8Array(4))).toThrow(/not an .ico/);
    const truncated = encodeIco([{ size: 16, png: fakePng(16, 16) }]).subarray(0, 40);
    expect(() => readIco(truncated)).toThrow(/runs past the file/);
  });
});

describe("the adaptive favicon", () => {
  const svg = buildAdaptiveFavicon(light, dark);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!);

  it("is one SVG that switches marks on the browser's dark scheme, not the app's", () => {
    expect(svg.match(/<svg\b/g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain("@media (prefers-color-scheme:dark)");
    expect(svg).toContain('<g id="ae-light">');
    expect(svg).toContain('<g id="ae-dark">');
    expect(svg).not.toMatch(/<script|<image|href=|role=|aria-label/);
  });

  it("gives every gradient of each mark its own id, and every reference resolves", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("ae-l-")).length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith("ae-d-")).length).toBe(
      ids.filter((id) => id.startsWith("ae-l-")).length,
    );
    for (const match of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
  });

  it("is deterministic and keeps both marks' artwork", () => {
    expect(buildAdaptiveFavicon(light, dark)).toBe(svg);
    expect(svg).toContain("#2563EB");
    expect(svg).toContain("#DBEAFE");
    expect(() => buildAdaptiveFavicon("<div/>", dark)).toThrow(/not a single <svg>/);
  });
});

describe("the generated icon set", () => {
  const names = [
    "aetheria-favicon.svg",
    "aetheria-mark-light.svg",
    "aetheria-mark-dark.svg",
    "favicon-16x16.png",
    "favicon-32x32.png",
    "apple-touch-icon.png",
    "favicon.ico",
  ];

  it("is committed exactly as the generator writes it, and a second run agrees", async () => {
    const first = await buildIcons(assetsDir);
    const second = await buildIcons(assetsDir);
    expect([...first.keys()]).toEqual(names);
    for (const name of names) {
      expect(sha256(second.get(name)!), `${name} differs between two runs`).toBe(
        sha256(first.get(name)!),
      );
      const committed = NodeFS.readFileSync(NodePath.join(publicDir, name));
      expect(sha256(committed), `${name} is stale; run build:icons`).toBe(sha256(first.get(name)!));
    }
  });

  it("has the PNG dimensions the page and the manifest promise", () => {
    const size = (name: string) => readPngSize(NodeFS.readFileSync(NodePath.join(publicDir, name)));
    expect(size("favicon-16x16.png")).toEqual({ width: 16, height: 16 });
    expect(size("favicon-32x32.png")).toEqual({ width: 32, height: 32 });
    expect(size("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("has an .ico of 16, 32 and 48 pixel PNG images at consistent offsets", () => {
    const ico = NodeFS.readFileSync(NodePath.join(publicDir, "favicon.ico"));
    const entries = readIco(ico);
    expect(entries.map((entry) => entry.size)).toEqual([16, 32, 48]);
    for (const entry of entries) {
      const png = ico.subarray(entry.offset, entry.offset + entry.length);
      expect(readPngSize(png)).toEqual({ width: entry.size, height: entry.size });
    }
  });

  it("decodes in Chromium: transparent corners, drawn centres, and the favicon follows the browser scheme", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const decoded = await page.evaluate(
        async (files) => {
          const out: Record<string, { w: number; h: number; corner: number; middle: number }> = {};
          for (const [name, dataUrl] of Object.entries(files)) {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true })!;
            context.drawImage(image, 0, 0);
            const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]!;
            out[name] = {
              w: image.naturalWidth,
              h: image.naturalHeight,
              corner: alpha(0, 0),
              middle: alpha(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.2)),
            };
          }
          return out;
        },
        Object.fromEntries(
          ["favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "favicon.ico"].map(
            (name) => [
              name,
              `data:${name.endsWith(".ico") ? "image/x-icon" : "image/png"};base64,${NodeFS.readFileSync(NodePath.join(publicDir, name)).toString("base64")}`,
            ],
          ),
        ),
      );
      expect(decoded["favicon-16x16.png"]).toMatchObject({ w: 16, h: 16, corner: 0 });
      expect(decoded["favicon-32x32.png"]).toMatchObject({ w: 32, h: 32, corner: 0 });
      expect(decoded["apple-touch-icon.png"]).toMatchObject({ w: 180, h: 180, corner: 0 });
      expect(decoded["favicon.ico"]!.corner).toBe(0);
      for (const name of ["favicon-32x32.png", "apple-touch-icon.png"]) {
        expect(decoded[name]!.middle, `${name} has a drawn star`).toBeGreaterThan(0);
      }

      const favicon = NodeFS.readFileSync(NodePath.join(publicDir, "aetheria-favicon.svg"), "utf8");
      const star = async (colorScheme: "light" | "dark") => {
        await page.emulateMedia({ colorScheme });
        return page.evaluate(async (markup) => {
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const context = canvas.getContext("2d", { willReadFrequently: true })!;
          context.drawImage(image, 0, 0, 64, 64);
          return Array.from(context.getImageData(32, 12, 1, 1).data);
        }, favicon);
      };
      const [lightRed, , lightBlue] = await star("light");
      const [darkRed, , darkBlue] = await star("dark");
      expect(lightBlue!).toBeGreaterThan(lightRed! + 100);
      expect(darkRed!).toBeGreaterThan(lightRed! + 100);
      expect(darkBlue!).toBeGreaterThan(200);
    } finally {
      await browser.close();
    }
  });
});
