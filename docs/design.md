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
| **Compact** (default) | 12 | 8 | 6 | 26 |
| Comfortable | 16 | 10 | 8 | 32 |
| Rounded (ohm-ui's own values) | 24 | 14 | 12 | 36 |

## Menus

Menus are tight, like a system menu:
- **Rows:** short, with small padding, and separators inset to the text.
- **Shortcuts:** muted, on the right.
- **Highlight:** the highlighted row is filled **forest** and everything in it turns white, including the check and the shortcut. This applies to dropdown menus, the `/` and + insert menus, and search results.
- **Destructive rows:** they keep ohm's red and are never filled forest.

The rules are slot-level (`[data-slot=dropdown-menu-item]` and so on) and unlayered, in `src/theme.css`. They restyle ohm-ui's components without editing the installed copies (ohm-ui's "theme, don't fork").

## Tree rows

The tint on a hovered or selected tree row covers the nearest guide line, as in Obsidian: it starts just before that line and is opaque, mixed from ink and the panel's own tone. The guide lines sit under it, and the row's text sits above it. Its corners are the row radius, the same as the cortex and vault folder rows.

## Upstream

Two of these belong in ohm-ui, so that every app gets them: one radius for every surface, and the compact density. Until they are there, `src/theme.css` is the only place they live.
