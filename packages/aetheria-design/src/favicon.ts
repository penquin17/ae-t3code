const SVG_OPEN = /^\s*<svg\b[^>]*>/;
const SVG_CLOSE = /<\/svg>\s*$/;

function inner(svg: string, label: string): string {
  const body = svg.replace(SVG_OPEN, "").replace(SVG_CLOSE, "");
  if (body === svg) throw new Error(`the ${label} mark is not a single <svg> document`);
  return body.trim();
}

function prefixIds(body: string, prefix: string): string {
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!);
  let result = body;
  for (const id of ids) {
    result = result
      .replaceAll(`id="${id}"`, `id="${prefix}${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}${id})`);
  }
  return result;
}

/**
 * One self-contained SVG holding both marks. A dark browser theme shows the dark mark and every
 * other shows the light one; the page's own appearance setting plays no part. Gradient ids carry a
 * prefix per mark so the two sets never collide.
 */
export function buildAdaptiveFavicon(lightSvg: string, darkSvg: string): string {
  const light = prefixIds(inner(lightSvg, "light"), "ae-l-");
  const dark = prefixIds(inner(darkSvg, "dark"), "ae-d-");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    "  <style>#ae-dark{display:none}@media (prefers-color-scheme:dark){#ae-light{display:none}#ae-dark{display:inline}}</style>",
    `  <g id="ae-light">${light}</g>`,
    `  <g id="ae-dark">${dark}</g>`,
    "</svg>",
    "",
  ].join("\n");
}
