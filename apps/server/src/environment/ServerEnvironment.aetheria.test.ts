// AETHERIA M04 Plan step 15 (B5) — the composition digest beside `serverVersion` in the environment descriptor (IP-8, IP-7).
//
// What this shows: the descriptor carries the Backend's actual validated digest only when an Aetheria Backend composition is provided, carries
// nothing otherwise (a bare T3 descriptor has no `compositionDigest` key at all), and decodes against the published schema. It does not show
// the Backend's own validation (aetheria-server's tests) or the connection refusal (ws and XC-6 tests).
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { AetheriaBackendComposition } from "../aetheria/backendComposition.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const decodeDescriptorEffect = Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor);
const decodeDescriptorSync = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const digest = { version: 1, algorithm: "sha256", value: `sha256:${"c".repeat(64)}` } as const;

const base = (baseDir: string) =>
  ServerEnvironment.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "ServerEnvironment with the Aetheria Backend composition",
  (it) => {
    it.effect("leaves a bare T3 descriptor without any composition digest", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-aetheria-env-bare-" });
        const descriptor = yield* ServerEnvironment.ServerEnvironment.pipe(
          Effect.flatMap((environment) => environment.getDescriptor),
          Effect.provide(base(baseDir)),
        );
        expect("compositionDigest" in descriptor).toBe(false);
        expect(Object.keys(descriptor)).not.toContain("compositionDigest");
      }),
    );

    it.effect(
      "publishes the actual Backend digest beside serverVersion when the Backend composition is provided",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-aetheria-env-" });
          const composition = Layer.succeed(
            AetheriaBackendComposition,
            AetheriaBackendComposition.of({ digest }),
          );
          const descriptor = yield* ServerEnvironment.ServerEnvironment.pipe(
            Effect.flatMap((environment) => environment.getDescriptor),
            Effect.provide(base(baseDir).pipe(Layer.provide(composition))),
          );
          expect(descriptor.compositionDigest).toEqual(digest);
          expect(typeof descriptor.serverVersion).toBe("string");
          const decoded = yield* decodeDescriptorEffect(JSON.parse(JSON.stringify(descriptor)));
          expect(decoded.compositionDigest).toEqual(digest);
        }),
    );

    it("rejects a malformed digest at the descriptor schema", () => {
      const valid = {
        environmentId: "e1",
        label: "l",
        platform: { os: "darwin", arch: "arm64" },
        serverVersion: "1.0.0",
        capabilities: {},
      };
      const decode = (compositionDigest: unknown) => () =>
        decodeDescriptorSync({ ...valid, compositionDigest });
      expect(decodeDescriptorSync(valid).compositionDigest).toBeUndefined();
      expect(decode(digest)).not.toThrow();
      for (const bad of [
        {},
        { ...digest, algorithm: "md5" },
        { ...digest, value: "sha256:zz" },
        { ...digest, version: 0 },
        "sha256:x",
      ])
        expect(decode(bad)).toThrow();
    });
  },
);
