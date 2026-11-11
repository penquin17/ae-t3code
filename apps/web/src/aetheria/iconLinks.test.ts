// @effect-diagnostics nodeBuiltinImport:off - reads the web app's page, manifest and icon files.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const webDir = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const publicDir = NodePath.join(webDir, "public");
const html = NodeFS.readFileSync(NodePath.join(webDir, "index.html"), "utf8");
const manifest = JSON.parse(
  NodeFS.readFileSync(NodePath.join(publicDir, "manifest.webmanifest"), "utf8"),
) as {
  icons: ReadonlyArray<{ src: string; sizes: string; type: string }>;
};

interface LinkTag {
  readonly rel: string;
  readonly href: string;
  readonly type: string | null;
  readonly sizes: string | null;
}

function linkTags(): LinkTag[] {
  const head = html.slice(0, html.indexOf("<script>"));
  return [...head.matchAll(/<link\b([^>]*)>/g)].map((match) => {
    const attribute = (name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(match[1]!)?.[1] ?? null;
    return {
      rel: attribute("rel")!,
      href: attribute("href")!,
      type: attribute("type"),
      sizes: attribute("sizes"),
    };
  });
}

function pngSize(file: string): string {
  const bytes = NodeFS.readFileSync(file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

const served = (href: string) => NodePath.join(publicDir, href.replace(/^\//, ""));

describe("the page's icon links (R4)", () => {
  const links = linkTags();
  const icons = links.filter((link) => link.rel === "icon");

  it("put the adaptive SVG first among the icons, then the .ico and the 32 and 16 pixel PNGs", () => {
    expect(icons.map((link) => link.href)).toEqual([
      "/aetheria/aetheria-favicon.svg",
      "/aetheria/favicon.ico",
      "/aetheria/favicon-32x32.png",
      "/aetheria/favicon-16x16.png",
    ]);
    expect(icons[0]!.type).toBe("image/svg+xml");
  });

  it("keep the apple touch icon and the manifest, on the generated set", () => {
    expect(links.find((link) => link.rel === "apple-touch-icon")?.href).toBe(
      "/aetheria/apple-touch-icon.png",
    );
    expect(links.find((link) => link.rel === "manifest")?.href).toBe("/manifest.webmanifest");
  });

  it("point only at files that exist, with the PNG sizes they declare", () => {
    for (const link of links.filter((entry) => entry.rel !== "manifest")) {
      expect(NodeFS.existsSync(served(link.href)), link.href).toBe(true);
      if (link.href.endsWith(".png") && link.sizes) {
        expect(pngSize(served(link.href)), link.href).toBe(link.sizes);
      }
    }
    expect(pngSize(served("/aetheria/apple-touch-icon.png"))).toBe("180x180");
  });

  it("show the Aetheria icon on the splash screen too", () => {
    expect(html).toContain('<img id="boot-shell-logo" src="/aetheria/apple-touch-icon.png"');
  });
});

describe("the manifest icons (R4)", () => {
  it("keep the 32 and 180 pixel entries and point at the generated light-mark exports", () => {
    expect(manifest.icons.map((icon) => [icon.src, icon.sizes, icon.type])).toEqual([
      ["/aetheria/favicon-32x32.png", "32x32", "image/png"],
      ["/aetheria/apple-touch-icon.png", "180x180", "image/png"],
    ]);
    for (const icon of manifest.icons) {
      expect(NodeFS.existsSync(served(icon.src)), icon.src).toBe(true);
      expect(pngSize(served(icon.src)), icon.src).toBe(icon.sizes);
    }
  });
});

describe("the stock icons", () => {
  it("stay in place, byte for byte, unused by the page and the manifest", () => {
    const stock: Record<string, string> = {
      "favicon.ico": "7fdcd08e83aedc4fc0d15a015a171b7bbd6025d37b2861e6ceb29a571813a91a",
      "favicon-16x16.png": "347273f37a0bcdc0e9b168ff1252a33ad297271f5a84ad412c18c5e5ede8f450",
      "favicon-32x32.png": "25f17fd73b3ecdebf05609b7f7625b824f490e017147ed56dc1dcb85251754e4",
      "apple-touch-icon.png": "4943ac41cc004f826c95d6da34e0b04c387cf54982fc424ba3da8b68dc4598db",
    };
    for (const [name, hash] of Object.entries(stock)) {
      const bytes = NodeFS.readFileSync(NodePath.join(publicDir, name));
      expect(NodeCrypto.createHash("sha256").update(bytes).digest("hex"), name).toBe(hash);
      expect(html).not.toContain(`"/${name}"`);
      expect(manifest.icons.some((icon) => icon.src === `/${name}`)).toBe(false);
    }
  });
});
