# Taskbar rework design

Date: 2026-09-15
Status: approved, ready for implementation planning
Repo: fork of https://github.com/joeyvigil/omarchy-taskbar at `eeb448b` (v0.4.1)
Target host: Omarchy 4.0.0.alpha (`/usr/share/omarchy`), Quickshell 0.3.1, Hyprland 0.56.2

## Goals

Seven changes, all driven by observed behaviour on the maintainer's desktop:

1. Right-click opens an anchored context menu at the icon instead of a centered
   `omarchy.menu` overlay.
2. Running (unpinned) icons appear in the order their apps were opened, not
   alphabetically.
3. The context menu lists an app's windows so a specific window can be focused.
4. Window classes that resolve to no desktop entry (for example `TUI.tile`, the
   app id in `~/.local/share/applications/Btop.desktop`) get a real icon and
   name rather than a letter tile.
5. A separator divides the pinned group from the running group.
6. ~~Drag to reorder~~ — dropped 2026-09-17, see Non-goals.
7. Windows that request attention flash their icon.
8. The context menu can close one window (a ✕ on its row) or all of the app's
   windows (added 2026-09-17).

Middle-click keeps its current behaviour (launch a new instance).

## Non-goals

- Drag to reorder or to pin (dropped 2026-09-17 by the user). The host bar
  owns every left press on a widget: in `plugins/bar/Bar.qml` the ModuleSlot's
  `modulePointer` MouseArea is declared after the `registryLoader` that hosts
  plugin widgets, fills the slot, and starts the bar's own module drag on a
  left press-and-move; plugin widgets only receive left clicks forwarded
  through `pressModuleClickTarget`. A widget cannot see a left drag without
  host changes. Reordering and pinning stay in the context menu.
- Per-window icons (an "ungrouped" taskbar mode). Grouping with a window
  submenu was chosen instead; a second layout mode would double the delegate
  and drag code paths for no observed need.
- Splitting terminal windows into separate icons by window title. Titles change
  while a program runs, so icons would appear, rename and re-slot mid-use.
- Persisting the running-icon order across shell restarts.
- Replacing the `+` app picker. A searchable dmenu list is the right tool for
  picking from every installed app, and `bin/taskbar-pick` stays for it.

## Current state

`BarWidget.qml` (689 lines) holds settings, window matching, launch/focus, pin
persistence and the icon delegate. `AppModel.js` (353 lines) holds pure
helpers. Relevant seams:

- `promptActions()` (BarWidget.qml:486) builds a `"<glyph>\t<label>\t<value>"`
  option list and shells out to `bin/taskbar-pick`, which summons
  `omarchy.menu` in `select` mode — a centered overlay. `onPicked()` parses the
  chosen value back and `runAction()` applies it.
- `AppModel.unpinnedRecords()` groups unclaimed windows by
  `appId || cls`, then orders them with `Object.keys(byKey).sort()`. The comment
  explains why: the compositor reorders its toplevel list as focus moves, and
  an icon that moves under the pointer is worse than an icon in the wrong
  place. Alphabetical order was the cheap way to be stable.
- The delegate's `tooltipText` appends `(N windows)`; `nextWindowIndex()` cycles
  windows on repeated clicks. Nothing exposes the individual windows.
- `entryById()` tries `DesktopEntries.byId()`, then a guarded
  `heuristicLookup()`. Neither resolves an app id that only exists as
  `--app-id=` inside another entry's `Exec`, so the delegate falls back to a
  letter tile.
- `mutateApps()` is the single write path for the pin list, via
  `updateEntryInline` on Omarchy 4.0.3+ and `mutateShellConfig` before that.

## Architecture

Four files instead of two:

```
BarWidget.qml     settings, model assembly, event wiring, launch/focus, pin persistence
AppModel.js       pure logic: normalize, match, group, open order, menu rows, id index
Slot.qml          one icon: image or letter tile, running indicator, urgent flash, drag source
TaskbarMenu.qml   PopupCard: window rows and action rows
```

The delegate leaves `BarWidget.qml` because it gains a drag state machine and a
flash animation; the menu is a new component. Both are self-contained and read
independently. All decision logic stays in `AppModel.js`, which is a
`.pragma library` of pure functions over plain descriptors — the only part of
the plugin that can be unit tested.

`Slot.qml` receives its record, its matched windows, the widget's style
settings and callbacks; it owns no model state. `TaskbarMenu.qml` receives an
anchor item, a record, its windows and callbacks.

## Data model

### Open order

`BarWidget` holds two pieces of state: a monotonic `orderSeq` counter and a
`seenAt` map of identity (lowercased `appId || cls`) to sequence number.

`AppModel.unpinnedRecords(pinned, windows, seenAt, nextSeq)` assigns a sequence
number to each identity the first time it is seen, in compositor list order,
and returns records sorted by that number. Identities with no windows left are
dropped from `seenAt` so a reopened app lands at the end rather than reclaiming
its old slot.

This replaces the alphabetical sort while keeping its property: a slot never
moves while the app stays open, because the sequence number is assigned once.

The existing fingerprint guard (`windowFingerprint` / `lastFingerprint`) stays.
A new identity always changes the fingerprint, so the ordering needs no extra
refresh trigger.

### Desktop entry resolution

`AppModel` gains a pure index builder over entry descriptors
(`{ id, exec }`): for each entry, parse `Exec` for `--app-id=<value>` or
`--class=<value>` and map the lowercased value to the entry id. `BarWidget`
builds the descriptor list from `DesktopEntries` (rebuilt when `entrySerial`
bumps) and consults the index between `byId()` and `heuristicLookup()`.

Consequence: `TUI.tile` resolves to `Btop.desktop`, so the slot shows btop's
icon and the name "Btop".

Known limitation, documented in the README: grouping is still per window class,
so two TUIs launched with the same `--app-id` share one icon and resolve to
whichever entry the index saw first. The fix is per-app ids
(`--app-id=org.omarchy.btop`), which is what `omarchy-launch-tui` does by
default.

### Urgency

`BarWidget` holds a set of urgent window addresses. Hyprland's
`urgent>>address` raw event adds one; the address is removed when it becomes
the active toplevel or its window disappears. A slot is urgent when any of its
matched windows is in the set.

## Behaviours

### 1. Context menu

`TaskbarMenu.qml` wraps `PopupCard` (`qs.Ui`), the component Omarchy's own tray
uses for per-icon menus (`plugins/bar/widgets/Tray.qml:521`). `anchorItem` is
the clicked slot, so the card appears at that icon and flips side with the bar
position; `triggerMode: "click"` gives it a `HyprlandFocusGrab`, so clicking
anywhere else dismisses it. `PluginBarApi` exposes `requestPopout`,
`releasePopout`, `activePopout` and `position`, which is everything `PopupCard`
needs from a plugin context.

Rows, top to bottom:

```
<app name>                 header
---------------------------
<window title>             one row per matched window, dot marks the focused one
---------------------------
New instance
Move left / Move right     pinned entries only, and only when a neighbour exists
Pin to taskbar / Unpin
```

Window rows are omitted when the app has no windows. Clicking a window row
focuses that window through the existing `focusWindow()` path, which holds the
pointer still. Action rows call the existing `runAction()` verbs.

`promptActions()`, the `actions` branch of `onPicked()` and the picker's
`actions` mode are removed. `bin/taskbar-pick` keeps only its `add` use.

### 2. Running order

Covered above. Pinned entries keep their stored order; running entries follow
open order after them.

### 3. Window rows

Covered above. The existing left-click cycling and the `(N windows)` tooltip
stay as they are.

### 4. Identity

Covered above.

### 5. Separator

A one-pixel line in the theme's border colour between the last pinned slot and
the first running slot, with the widget's own gap on each side. Rendered only
when both groups are non-empty. New setting `showSeparator`, default `true`.

### 6. Drag

Dropped; see Non-goals. `Move left` / `Move right` and `Pin to taskbar` in the
menu cover reordering and pinning.

### 7. Attention flash

When a slot is urgent, its icon and running indicator pulse in the bar's
`urgent` colour roughly three times, then hold a steady tint until the window
is focused. New setting `attentionFlash`, default `true`.

Note for the README: this fires only for clients that actually request
activation through Hyprland. A bare `notify-send` does not make any window
urgent, so nothing will flash for it.

### 8. Close

Window rows get a ✕ at their right edge, shown while the row is hovered, that
closes that one window. The last action row reads `Close window` when the app
has one window and `Close all windows` when it has several; it is absent when
the app has no windows.

Closing never passes an address to Hyprland's close dispatcher. Hyprland
0.56's Lua dispatcher ignores arguments it does not recognise and acts on the
active window — a probe with a bogus address closed real windows during this
work. So each close is: focus the window with the existing `focusCommand`
(pointer held still), check that `hyprctl -j activewindow` now reports exactly
that address, and only then run `hl.dsp.window.close()`, the same call
Omarchy's SUPER+W binding uses. If the check fails nothing is closed. On
pre-Lua configs the Lua call fails and the legacy
`closewindow address:0x…` — which names its target explicitly — runs instead.
`Close all windows` runs the guarded sequence for each window in one shell, in
order. Apps receive a normal close request, so ones with unsaved work can
still prompt.

## Settings

Added to `manifest.json` (schema plus defaults):

| key | type | default | label |
|-----|------|---------|-------|
| `showSeparator` | bool | `true` | Separate pinned apps from running apps |
| `attentionFlash` | bool | `true` | Flash icons for windows that ask for attention |

Existing settings and their defaults are unchanged. `manifest.json`'s
`barWidget.description` is updated: right-click now opens a context menu with
the app's windows.

## Testing

`AppModel.js` is pure and `.pragma library`, so node tests load it with the
pragma line stripped. Test-driven, one commit per behaviour:

- open order: assignment in compositor order, stability across refreshes,
  eviction when the last window closes, reopened app lands last
- exec app id index: `--app-id=` and `--class=` forms, quoting, first-wins on a
  duplicate id, entries with no `Exec`
- menu rows: window rows present or absent, focused marker, action rows by
  pinned state and position, the close row's presence and label
- close command: refuses anything that is not a hex address, targets the
  normalised `0x` address in the guard, never passes arguments to
  `hl.dsp.window.close()`
- unchanged behaviour kept under test: matching, grouping, `movedRecords`,
  `serialize`, `normalizeApps` on `QVariantList`-like input

QML behaviour is verified by hand, per item, plus one cold-start pass. Per
`docs/development.md`, settings bugs only appear on a cold start, so every item
ends with `omarchy restart shell`, not only `omarchy-shell shell rescanPlugins`.

Manual checklist: anchored menu on both a pinned and a running icon and on a
bottom bar; focus a specific window from the menu; open three apps in sequence
and confirm left-to-right order, then close a middle one and confirm no slot
moves; btop shows its own icon and name; separator appears only with both
groups present; drag reorder persists across a shell restart; drag a running
icon into the pinned strip; urgent flash clears on focus.

## Rollout

Branch `taskbar-rework` in `~/Projects/newtaskbar`, one commit per item.

Install seam, done once before implementation:

```
mv ~/.config/omarchy/plugins/io.github.joeyvigil.taskbar{,.bak}
ln -s ~/Projects/newtaskbar ~/.config/omarchy/plugins/io.github.joeyvigil.taskbar
```

Reverting means deleting the symlink and restoring the `.bak` directory. The
plugin id is unchanged, so the existing `shell.json` entry keeps working with
its pins (`steam`, `org.gnome.Nautilus`), `iconSize: 26` and
`showAddButton: false`.

Two consequences of the symlink: `inotify` does not see through it, so reloads
are manual (`omarchy-shell shell rescanPlugins`); and `omarchy plugin update`
would replace it, so it must not be run for this plugin.

## Risks

- `PopupCard` is host code, not a plugin API. A future Omarchy release can
  change it and break the menu. Accepted: the tray depends on it the same way,
  and the alternative is a hand-built `PopupWindow` that would drift from the
  theme.
- Drag and click share one press. Getting the threshold wrong breaks launching,
  which is the widget's primary action. The bar's own drag code is the
  reference, and the manual checklist tests plain clicks after the drag work.
- `seenAt` lives in memory, so a shell restart reseeds the running order from
  the compositor's list. Accepted over persisting UI-only state to
  `shell.json`.
