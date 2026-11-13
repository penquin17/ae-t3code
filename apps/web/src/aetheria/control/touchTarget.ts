// The phone touch-target rule for Aetheria's own controls: at 767 px and below (under Tailwind's `md`, 768 px) every button and text field inside an Aetheria root is at least the accepted token
// `--ae-size-touch-min` (44 px) tall, and every button that wide. It is a floor (`min-*`), so a control already larger keeps its size, and from 768 px up nothing changes: the desktop layout is the
// controls' own size. An Aetheria root carries this class together with `data-aetheria`; the quality matrix reads that attribute as "Aetheria's own" and holds what sits inside it to this rule
// (T3-owned controls, with no such root, stay an advisory there). The class names are written out whole, not built, so Tailwind's source scan finds them.
export const touchWithin =
  "max-md:[&_button]:min-h-[var(--ae-size-touch-min)] max-md:[&_button]:min-w-[var(--ae-size-touch-min)] max-md:[&_input:not([type=checkbox]):not([type=radio])]:min-h-[var(--ae-size-touch-min)] max-md:[&_select]:min-h-[var(--ae-size-touch-min)] max-md:[&_label:has(input[type=checkbox],input[type=radio])]:min-h-[var(--ae-size-touch-min)]";
