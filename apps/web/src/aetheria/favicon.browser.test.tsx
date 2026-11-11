// The notification badge swaps the tab icon through T3's own setNotificationBadge. These tests run it
// against the icon links the page really declares, to prove the adaptive favicon is replaced while a
// badge shows and comes back, in place, after it.
import { describe, expect, it } from "vite-plus/test";

import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { setNotificationBadge } from "~/threadNotifications";
import indexHtml from "../../index.html?raw";

const iconLinks = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
const appleLinks = () => [
  ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'),
];
const describeLink = (link: HTMLLinkElement) => link.getAttribute("href");

/** The page's own icon links (from index.html) in the test document, put back when the test ends. */
function pageIconLinks() {
  const existing = [
    ...document.head.querySelectorAll("link[rel='icon'], link[rel='apple-touch-icon']"),
  ];
  for (const link of existing) link.remove();
  const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
  const declared = [
    ...parsed.head.querySelectorAll("link[rel='icon'], link[rel='apple-touch-icon']"),
  ];
  for (const link of declared) document.head.append(document.importNode(link, true));
  return {
    [Symbol.dispose]: () => {
      setNotificationBadge(0);
      for (const link of document.head.querySelectorAll(
        "link[rel='icon'], link[rel='apple-touch-icon']",
      )) {
        link.remove();
      }
      for (const link of existing) document.head.append(link);
    },
  };
}

const ORIGINAL = [
  "/aetheria/aetheria-favicon.svg",
  "/aetheria/favicon.ico",
  "/aetheria/favicon-32x32.png",
  "/aetheria/favicon-16x16.png",
];

describe("the tab icon and the notification badge", () => {
  it("starts with the adaptive SVG first", () => {
    using _links = pageIconLinks();
    expect(iconLinks().map(describeLink)).toEqual(ORIGINAL);
  });

  it("shows the badge alone while it is up, so no fallback icon masks it", () => {
    using _links = pageIconLinks();
    setNotificationBadge(3);
    const icons = iconLinks();
    expect(icons).toHaveLength(1);
    expect(icons[0]!.href.startsWith("data:image/png")).toBe(true);
    expect(appleLinks().map(describeLink)).toEqual(["/aetheria/apple-touch-icon.png"]);
  });

  it("makes no duplicates for repeated counts or for zero", () => {
    using _links = pageIconLinks();
    for (const count of [1, 3, 12, 12, 0, 0]) {
      setNotificationBadge(count);
      expect(iconLinks()).toHaveLength(count > 0 ? 1 : ORIGINAL.length);
    }
    expect(iconLinks().map(describeLink)).toEqual(ORIGINAL);
  });

  it("restores the adaptive icon first, in its original place, after any number of cycles", () => {
    using _links = pageIconLinks();
    for (let cycle = 0; cycle < 3; cycle++) {
      setNotificationBadge(2);
      setNotificationBadge(0);
    }
    expect(iconLinks().map(describeLink)).toEqual(ORIGINAL);
    expect(iconLinks()[0]!.getAttribute("type")).toBe("image/svg+xml");
    expect(appleLinks()).toHaveLength(1);
  });

  it("brings the adaptive icon back after an app theme change while a badge was showing", () => {
    using _links = pageIconLinks();
    try {
      setNotificationBadge(4);
      setTheme("system");
      setAppearanceMode("dark");
      refreshTheme();
      expect(iconLinks()).toHaveLength(1);
      setNotificationBadge(0);
      expect(iconLinks().map(describeLink)).toEqual(ORIGINAL);
      // The app's appearance never touches the icon: it follows the browser's own scheme.
      expect(iconLinks()[0]!.getAttribute("href")).toBe("/aetheria/aetheria-favicon.svg");
    } finally {
      setAppearanceMode("light");
      refreshTheme();
    }
  });
});

describe("the badge on a page with stock T3's single icon link", () => {
  function stockHead(hrefs: readonly string[]) {
    const existing = [...document.head.querySelectorAll("link[rel='icon']")];
    for (const link of existing) link.remove();
    const links = hrefs.map((href) => {
      const link = document.createElement("link");
      link.rel = "icon";
      link.setAttribute("href", href);
      document.head.append(link);
      return link;
    });
    return {
      links,
      [Symbol.dispose]: () => {
        setNotificationBadge(0);
        for (const link of document.head.querySelectorAll("link[rel='icon']")) link.remove();
        for (const link of existing) document.head.append(link);
      },
    };
  }

  it("swaps the one link for the badge and gives back the very same link", () => {
    using head = stockHead(["/favicon.ico"]);
    setNotificationBadge(2);
    const [badge] = iconLinks();
    expect(iconLinks()).toHaveLength(1);
    expect(badge!.href.startsWith("data:image/png")).toBe(true);
    setNotificationBadge(11);
    expect(iconLinks()).toHaveLength(1);
    setNotificationBadge(0);
    expect(iconLinks()).toEqual(head.links);
    expect(iconLinks()[0]!.getAttribute("href")).toBe("/favicon.ico");
  });

  it("adds a badge to a page with no icon link and removes it again", () => {
    using _head = stockHead([]);
    expect(iconLinks()).toHaveLength(0);
    setNotificationBadge(1);
    expect(iconLinks()).toHaveLength(1);
    setNotificationBadge(0);
    expect(iconLinks()).toHaveLength(0);
  });
});
