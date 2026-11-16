// @effect-diagnostics nodeBuiltinImport:off - reads the web app's own source files.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const srcDir = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const read = (url: URL) => NodeFS.readFileSync(NodeURL.fileURLToPath(url), "utf8");

// Built from parts: the registry check reads every committed file for the token.
const marker = ["AETHERIA-IP", "IP-68"].join(":");

describe("the Pi provider mark's registered edit site (IP-68)", () => {
  const source = read(new URL("../components/chat/ProviderInstanceIcon.tsx", import.meta.url));

  it("marks the import, the driver test and the render branch, once each", () => {
    expect(source.split(marker).length - 1).toBe(3);
    expect(source).toContain('props.driverKind === "pi"');
    expect(source).toContain("<AetheriaMark");
  });

  it("is the only site: the marker is not in this folder, and Pi's own client is unchanged", () => {
    for (const entry of NodeFS.readdirSync(`${srcDir}aetheria`, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
      expect(read(new URL(`./${entry.name}`, import.meta.url)), entry.name).not.toContain(marker);
    }
    const client = read(new URL("../../../../packages/provider-pi/src/client.ts", import.meta.url));
    expect(client).not.toContain("AETHERIA");
    expect(client).toContain('label: "Pi"');
  });
});
