# Development notes

```
manifest.json      plugin declaration and setting schema
BarWidget.qml      the widget the bar mounts
TaskbarMenu.qml    the right-click context menu for one icon
Slot.qml           one icon: image or letter tile, indicator, flash
AppModel.js        entry normalization, window matching, grouping, list editing, menu rows
bin/taskbar-pick   shows a list in the Omarchy menu, prints the choice
tests/             node --test coverage for AppModel.js's pure helpers
```

`AppModel.js` is unit-tested with `npm test` (`node --test`, which
auto-discovers everything under `tests/`). The suite can't `import` a
`.pragma library` directly, so `tests/helpers/load-app-model.mjs` reads the
file, strips the `.pragma library` line, and appends an `export` statement
naming every function the tests need. Adding a new pure function to
`AppModel.js`? Add its name to the `EXPORTED` list in that loader too, or the
test file importing it will fail to resolve it.

The context menu (`TaskbarMenu.qml`) is a `PopupCard` from `qs.Ui` — the same
host component the system tray uses for its own per-icon menu. It anchors to
the icon, flips side with the bar position, and gets outside-click dismissal
for free. The plugin bar facade exposes exactly the surface it needs:
`bar.requestPopout` / `bar.releasePopout` (one popup open at a time, host-wide)
plus `bar.activePopout` and `bar.position`.

The host bar's `modulePointer` (`plugins/bar/Bar.qml`) is a `MouseArea` that
fills the whole widget slot and takes every left press. It watches for a
left-drag past a small threshold to move the widget within the bar; only a
press that *doesn't* turn into a drag gets forwarded to the widget, through
`pressModuleClickTarget`. A plugin widget never sees the drag itself, so there
is nothing here to hook a reorder gesture onto — reordering and pinning live
in the context menu instead.

Closing a window (`AppModel.closeCommand`) never names its target to
Hyprland's close dispatcher. It focuses the window first, then has the shell
check `hyprctl -j activewindow`, and only issues the close when that address
matches the one being closed. This guard exists because Hyprland 0.56's Lua
dispatcher silently ignores arguments it doesn't recognise and acts on
whatever window is currently active — an address argument passed to it is not
a safe way to target a specific window.

Running-app order (`AppModel.groupUnpinned`) is tracked in memory only, via
`seenAt` on the widget. There's no persistence for it: after a shell restart
the map starts empty and is reseeded from the compositor's current window
list, so apps regain an order based on now, not on what it was before the
restart.

Two more things worth knowing before changing this code:

**Settings arrays are not `Array`s.** Values from `shell.json` round-trip
through a QML `property var`, which stores JS arrays as `QVariantList`. What
comes back is array-*like* but fails `Array.isArray`, so `AppModel.toArray`
duck-types on `length` instead. Trusting `Array.isArray` silently drops every
pinned app at cold start while still working under hot-reload, which makes it a
nasty one to catch — always test with `omarchy restart shell`, not just a save.

**Pins are persisted in-process.** Omarchy 4.0.3 capability-scopes plugin
shell access: only kind "bar" plugins may call `mutateShellConfig`, so the
widget persists through `updateEntryInline` — the seam a host permits for
writing its own bar layout entry — and falls back to the ungated mutator on
hosts where `updateEntryInline` is absent. Both write the entry wholesale, so
edits merge the currently stored settings rather than building them from
scratch. The tidier `omarchy bar set <id> apps '[…]' --json` still cannot be
used: it forwards through `qs ipc call`, which splits every argument on
commas, so any array past one element arrives as extra positional arguments
and the call is rejected.

Files under `~/.config/omarchy/plugins/` hot-reload on save. If you develop from
a checkout elsewhere and symlink it in, `inotify` won't see through the symlink
— reload by hand with `omarchy-shell shell rescanPlugins`, and restart the
shell outright when you touch anything settings-related.

For the design and history behind the context menu, ordering, separator and
attention-flash work, see
[`docs/superpowers/specs/2026-09-15-taskbar-rework-design.md`](superpowers/specs/2026-09-15-taskbar-rework-design.md).
