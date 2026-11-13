// The phone touch-target class (the accepted token `--ae-size-touch-min`, 44 px), shown on the real controls it covers at phone widths and absent from desktop layout.
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { render } from "../../../test/render";
import { touchWithin } from "./touchTarget";

function Scene() {
  return (
    <div data-aetheria="touch" className={touchWithin}>
      <Button size="xs">Close</Button>
      <Button size="icon-xs" aria-label="More" />
      <button type="button">Plain</button>
      <Input aria-label="Search" type="search" />
      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" className="size-4" />
        Skip this question
      </label>
    </div>
  );
}

async function sizes(width: number) {
  await page.viewport(width, 800);
  await using screen = await render(<Scene />, { router: false });
  // A checkbox is operated through its label, so the label is the measured target (as the quality matrix measures it), not the 16 px box.
  const targets = screen.container.querySelectorAll("button, input[type=search], label");
  return [...targets].map((element) => {
    const box = element.getBoundingClientRect();
    return {
      name: element.getAttribute("aria-label") ?? element.textContent,
      isButton: element.tagName === "BUTTON",
      w: box.width,
      h: box.height,
    };
  });
}

describe("touchWithin", () => {
  it("makes every button and text field at least the touch token tall, and buttons wide, at 767 px and below", async () => {
    for (const width of [390, 767]) {
      for (const box of await sizes(width)) {
        expect(box.h, `${box.name} at ${width}`).toBeGreaterThanOrEqual(44);
        if (box.isButton) expect(box.w, `${box.name} at ${width}`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it("leaves the desktop layout as it was at 768 px and above", async () => {
    for (const width of [768, 1280]) {
      for (const box of await sizes(width)) {
        expect(box.h, `${box.name} at ${width}`).toBeLessThan(44);
      }
    }
  });
});
