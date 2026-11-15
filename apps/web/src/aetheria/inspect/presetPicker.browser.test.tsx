// M11 step 12: T3's own picker lists "Aetheria" before "Aetheria Builder" and dispatches to the instance picked (default `pi`, then `pi-builder`).
// Not shown: a real server building these snapshots, a session loading the picked bundle (steps 15-16), reduced motion.

import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { ProviderModelPicker } from "../../components/chat/ProviderModelPicker";

const snapshot = (instanceId: string, displayName: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make("pi"),
  displayName,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [
    { slug: `${instanceId}/scripted`, name: "Scripted model", isCustom: false, capabilities: {} },
  ],
  slashCommands: [],
  skills: [],
});

// The server lists the instances in settings order, which a rewrite by T3 may change: Builder first here, on purpose.
const providers = [snapshot("pi-builder", "Aetheria Builder"), snapshot("pi", "Aetheria")];
// The settings the candidate writes (t3-settings.mjs): both Pi instances enabled, each with its own display name.
const settings = {
  providerInstances: {
    pi: { driver: "pi", displayName: "Aetheria", enabled: true },
    "pi-builder": { driver: "pi", displayName: "Aetheria Builder", enabled: true },
  },
  projectSettingsOverrides: {},
} as unknown as Parameters<typeof providerInstanceEntriesFor>[1];
const entries = providerInstanceEntriesFor(providers, settings, null);
const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));

function Picker(props: {
  initial: ModelSelection;
  onPick?: (instanceId: string, model: string) => void;
}) {
  const [selection, setSelection] = useState(props.initial);
  return (
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={options}
      triggerAriaLabel="Choose preset and model"
      onInstanceModelChange={(instanceId, model) => {
        props.onPick?.(instanceId, model);
        setSelection({ instanceId, model });
      }}
    />
  );
}

const ordinary: ModelSelection = {
  instanceId: ProviderInstanceId.make("pi"),
  model: "pi/scripted",
};
const builder: ModelSelection = {
  instanceId: ProviderInstanceId.make("pi-builder"),
  model: "pi-builder/scripted",
};

it("derives the entries in manifest order from a snapshot that lists Builder first, keeping each display name and instance id", () => {
  expect(entries.map((entry) => [entry.instanceId, entry.displayName, entry.isDefault])).toEqual([
    ["pi", "Aetheria", true],
    ["pi-builder", "Aetheria Builder", false],
  ]);
});

it("lists both presets in order and dispatches a pick to the instance it was made under", async () => {
  const picks: Array<[string, string]> = [];
  await using screen = await render(
    <Picker initial={ordinary} onPick={(instanceId, model) => picks.push([instanceId, model])} />,
  );
  await screen.getByRole("button", { name: "Choose preset and model" }).click();
  const names = Array.from(document.querySelectorAll<HTMLElement>("button")).map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
  const aetheria = names.findIndex((name) => name.trim() === "Aetheria");
  const builderAt = names.findIndex((name) => name.trim() === "Aetheria Builder");
  expect(aetheria).toBeGreaterThanOrEqual(0);
  expect(builderAt).toBeGreaterThan(aetheria);
  await page.getByRole("button", { name: "Aetheria Builder", exact: true }).click();
  await page.getByRole("option", { name: /Scripted model/ }).click();
  await vi.waitFor(() => expect(picks).toEqual([["pi-builder", "pi-builder/scripted"]]));
});

it("reaches the Builder preset by keyboard alone", async () => {
  const picks: Array<[string, string]> = [];
  await using screen = await render(
    <Picker initial={ordinary} onPick={(instanceId, model) => picks.push([instanceId, model])} />,
  );
  const trigger = screen.getByRole("button", { name: "Choose preset and model" });
  (trigger.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const builderButton = page.getByRole("button", { name: "Aetheria Builder", exact: true });
  await expect.element(builderButton).toBeVisible();
  (builderButton.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const option = page.getByRole("option", { name: /Scripted model/ });
  await expect.element(option).toBeVisible();
  (option.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(picks).toEqual([["pi-builder", "pi-builder/scripted"]]));
});

it("a stored selection keeps naming its own instance, so a resumed Builder session is still Builder", async () => {
  await using screen = await render(<Picker initial={builder} />);
  const trigger = screen.getByRole("button", { name: "Choose preset and model" });
  await expect.element(trigger).toBeVisible();
  const text = (trigger.element() as HTMLElement).textContent ?? "";
  expect(text).toContain("Scripted model");
  await trigger.click();
  await expect
    .element(page.getByRole("button", { name: "Aetheria Builder", exact: true }))
    .toBeVisible();
});

it.each([
  [390, "light"],
  [390, "dark"],
  [1280, "light"],
  [1280, "dark"],
] as const)("shows both preset names at %ipx in %s", async (width, theme) => {
  await page.viewport(width, 800);
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    await using screen = await render(<Picker initial={ordinary} />);
    await screen.getByRole("button", { name: "Choose preset and model" }).click();
    await expect.element(page.getByRole("button", { name: "Aetheria", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Aetheria Builder", exact: true }))
      .toBeVisible();
  } finally {
    document.documentElement.classList.remove("dark");
  }
});
