// M11 step 12: T3's own picker lists the one Aetheria preset, the default instance `pi`, and dispatches to the instance picked.
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

const providers = [snapshot("pi", "Aetheria")];
// The settings the candidate writes (t3-settings.mjs): the one Pi instance enabled, with its display name.
const settings = {
  providerInstances: {
    pi: { driver: "pi", displayName: "Aetheria", enabled: true },
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

it("derives the one entry from the snapshot, keeping its display name and instance id", () => {
  expect(entries.map((entry) => [entry.instanceId, entry.displayName, entry.isDefault])).toEqual([
    ["pi", "Aetheria", true],
  ]);
});

it("lists the Aetheria preset and dispatches a pick to the instance it was made under", async () => {
  const picks: Array<[string, string]> = [];
  await using screen = await render(
    <Picker initial={ordinary} onPick={(instanceId, model) => picks.push([instanceId, model])} />,
  );
  await screen.getByRole("button", { name: "Choose preset and model" }).click();
  const names = Array.from(document.querySelectorAll<HTMLElement>("button")).map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
  expect(names.some((name) => name.trim() === "Aetheria")).toBe(true);
  expect(names.some((name) => name.includes("Builder"))).toBe(false);
  await page.getByRole("button", { name: "Aetheria", exact: true }).click();
  await page.getByRole("option", { name: /Scripted model/ }).click();
  await vi.waitFor(() => expect(picks).toEqual([["pi", "pi/scripted"]]));
});

it("reaches the Aetheria preset by keyboard alone", async () => {
  const picks: Array<[string, string]> = [];
  await using screen = await render(
    <Picker initial={ordinary} onPick={(instanceId, model) => picks.push([instanceId, model])} />,
  );
  const trigger = screen.getByRole("button", { name: "Choose preset and model" });
  (trigger.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const presetButton = page.getByRole("button", { name: "Aetheria", exact: true });
  await expect.element(presetButton).toBeVisible();
  (presetButton.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const option = page.getByRole("option", { name: /Scripted model/ });
  await expect.element(option).toBeVisible();
  (option.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(picks).toEqual([["pi", "pi/scripted"]]));
});

it("a stored selection keeps naming its own instance, so a resumed session is still Aetheria", async () => {
  await using screen = await render(<Picker initial={ordinary} />);
  const trigger = screen.getByRole("button", { name: "Choose preset and model" });
  await expect.element(trigger).toBeVisible();
  const text = (trigger.element() as HTMLElement).textContent ?? "";
  expect(text).toContain("Scripted model");
  await trigger.click();
  await expect.element(page.getByRole("button", { name: "Aetheria", exact: true })).toBeVisible();
});

it.each([
  [390, "light"],
  [390, "dark"],
  [1280, "light"],
  [1280, "dark"],
] as const)("shows the preset name at %ipx in %s", async (width, theme) => {
  await page.viewport(width, 800);
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    await using screen = await render(<Picker initial={ordinary} />);
    await screen.getByRole("button", { name: "Choose preset and model" }).click();
    await expect.element(page.getByRole("button", { name: "Aetheria", exact: true })).toBeVisible();
  } finally {
    document.documentElement.classList.remove("dark");
  }
});
