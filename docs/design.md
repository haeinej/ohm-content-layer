# Design decisions in ohm-ux

ohm-ux uses ohm-ui as it is (its `DESIGN.md` outranks this file) and adds one layer of its own, `src/theme.css`. This file says what that layer decides and why.

## One radius for every surface

**The rule.** Panels, menus, popovers, tooltips and the search sheet share one corner radius: the card token, `--ohm-radius-card`, which is `rounded-2xl` in Tailwind. Rows inside them use the row token (`rounded-lg`). Items and small controls use the item token (`rounded-md`). Nothing sets a pixel radius by hand.

**Why it went wrong before.** The panels were given `rounded-md` directly, to make them less round. The menus and popovers come from ohm-ui's vendored components (shadcn Maia), which hard-code `rounded-2xl` and `rounded-4xl`, and ohm maps those to the card and sheet radii (24 and 28 px). So every floating surface stayed at 24 or 28 px while the panels were 12, and each new menu brought the mismatch back.

**The fix.** Radii now come only from the tokens, and the tokens come from the density setting. Panels use `rounded-2xl` like the menus, so changing how round things are changes both together.

**When adding UI:**
- A surface (panel, card, menu, popover or sheet-like box) is `rounded-2xl`.
- A row in a list or tree is `rounded-lg`.
- A button, chip or small control is `rounded-md`, or `rounded-full` for pills.
- Never `rounded-[Npx]`, and never a different radius for something that sits beside a surface.

## Density

Settings › Appearance › Density, stored on this device (`localStorage`), sets `data-density` on `<html>`:

| Density | Surface (card) | Row | Item | Menu row height |
| --- | --- | --- | --- | --- |
| **Compact** (default) | 12 | 8 | 6 | 28 |
| Comfortable | 16 | 10 | 8 | 32 |
| Rounded (ohm-ui's own values) | 24 | 14 | 12 | 36 |

## Menus

Menus are tight, like a system menu:
- **Rows:** short, with small padding, and separators inset to the text.
- **Shortcuts:** muted, on the right.
- **Highlight:** the highlighted row is filled **forest** and everything in it turns white, including the check and the shortcut. This applies to dropdown menus, the `/` and + insert menus, and search results.
- **Destructive rows:** they keep ohm's red and are never filled forest.

The rules are slot-level (`[data-slot=dropdown-menu-item]` and so on) and unlayered, in `src/theme.css`. They restyle ohm-ui's components without editing the installed copies (ohm-ui's "theme, don't fork").

## Rows in the repository: one shade for all

The cortex and vault rows and every tree row under them share one shade (`.ux-row` and the tree-row rules in `src/theme.css`):
- **Edges:** the same left and right edges. Tree rows reach back over their indent (`--tree-inset`) to the cortex row's left edge, whatever their depth.
- **Shape and tone:** the same 32 px height, the same row radius, rounded at both ends, and the same hover and selected tones.
- **Layering:** the shade is opaque, ink mixed into the panel's tone, so it covers the guide lines and sits under the chevron and the text.

**The bug this fixes.** ohm-ui's tree row carries its own `hover:` and `aria-selected:` background classes. They painted a second, square tint under the rounded one, which looked like a clipped right edge. Those are switched off for tree rows (`background-color: transparent !important`), so only the shared shade shows. When a vendored component brings its own background, turn it off at the slot rather than painting over it.

## Cortex and vault

They have their own icons, drawn in ohm-ux (`src/workspace/PrimeIcon.tsx`), not folders and not Lucide's:
- **Cortex:** a minimal brain, two lobes with a seam.
- **Vault:** a minimal rounded box with a dot.

Each is one closed shape and one inner mark, on Lucide's 24 grid with a stroke of 2, so it sits with the other icons. Closed, the icon is an outline in forest. Open, the shape is filled forest and the mark is cut out in the panel's tone. Lucide's brain is drawn from open strokes, which blot when filled. That is why these are drawn here.

## Graph colours

Nodes are coloured by kind, from ohm's palette only: the person forest, the cortex light green, vault labels ink, sublabels ink at 60%, posts grey, other people hollow. Red is never used here; it means destructive.

## Upstream

Two of these belong in ohm-ui, so that every app gets them: one radius for every surface, and the compact density. Until they are there, `src/theme.css` is the only place they live.
