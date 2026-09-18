# omataskbar

Pinned app icons for the [Omarchy](https://omarchy.org/) bar.

A fork of Joey Vigil's [omarchy-taskbar](https://github.com/joeyvigil/omarchy-taskbar)
with an anchored right-click menu, window closing, open-order running icons,
a pinned/running separator and attention flashing. It uses its own plugin id,
so it installs alongside the original rather than replacing it.

Click an icon to launch the app — or to focus it, if it's already open. A small
indicator under each icon shows what's running and which app you're in.

Pin and unpin from the bar itself. No config file editing.

![The taskbar in the Omarchy bar](docs/bar.png)

## Install

```bash
omarchy plugin add https://github.com/thevideinfra/omataskbar.git --enable --yes
omarchy bar move io.github.thevideinfra.omataskbar --section left
```

Needs Omarchy 4+. The `+` picker also needs the built-in `omarchy.menu` plugin
enabled; everything else, the right-click menu included, works without it.

## Using it

| Input | What it does |
|---|---|
| **Left click** | Launch the app, or focus it if it's already running |
| **Left click** (already focused) | Cycle to that app's next window |
| **Middle click** | Always launch a new instance |
| **Right click** | Open a context menu at the icon: the app's windows (click one to focus it), then new instance, move left/right, pin/unpin, and close |
| **Click the `+`** | Pin an app, from a searchable list of everything installed |
| **Hover** | App name, plus window count when more than one is open |

The context menu lists each open window by title — click one to focus it, or
hover a row for a `✕` that closes just that window. Below the windows, an
action closes the rest: **Close window** for one, **Close all windows** for
more than one. **Move left** / **Move right** reorder a pinned icon, and
**Pin to taskbar** / **Unpin** move it in or out of the pinned group — there's
no drag, since the Omarchy bar itself uses a left-drag on any widget to move
that widget within the bar.

Open an app you haven't pinned and it gets an icon too, after the pinned
ones, in the order you opened them, with the same click behaviour. That icon
disappears when its last window closes. Right-click it and choose
**Pin to taskbar** to keep it for good. A separator divides the pinned icons
from the running ones (`showSeparator`). Turn running icons off entirely with
`showRunningApps` if you only want the apps you chose.

An icon flashes in the theme's urgent colour when one of its windows asks for
attention, until you focus it (`attentionFlash`). This only fires for clients
that actually request activation through the compositor — a bare
`notify-send` can't trigger it.

<img src="docs/picker.png" alt="Pinning an app from the bar" width="420">

Pinning through the `+` also works out how to recognise that app's windows, so
the running indicator just works — including for Omarchy web apps, which
Chromium reports under names like `chrome-discord.com__channels_@me-Default`.

Grouping is per window class, so terminal apps launched with the same
`--app-id` all land on one icon and resolve to one desktop entry — several
TUIs started with `--app-id=TUI.tile`, for instance, share an icon instead of
each getting their own. Give each one its own id, such as
`--app-id=org.omarchy.btop`, which is what `omarchy-launch-tui` does by
default.

## Settings

Stored inline on the widget's entry in `~/.config/omarchy/shell.json`, which
hot-reloads on save. The bar UI writes to this same place.

| Key | Default | Meaning |
|---|---|---|
| `apps` | `[]` | The pinned entries, in bar order |
| `iconSize` | `17` | Icon edge length in pixels |
| `spacing` | `2` | Gap between icons in pixels |
| `runningIndicator` | `true` | Draw the running/focused indicator |
| `dimWhenClosed` | `true` | Fade icons for apps with no open window |
| `cycleWindows` | `true` | Re-clicking a focused app advances to its next window |
| `showAddButton` | `true` | Show the trailing `+` for pinning apps |
| `showRunningApps` | `true` | Also show open apps that are not pinned |
| `showSeparator` | `true` | Draw a separator between pinned and running icons |
| `attentionFlash` | `true` | Flash an icon when one of its windows asks for attention |

> **Disabling the widget discards your pins.** Omarchy stores widget settings
> inline on the bar layout entry, and disabling removes that entry. Copy the
> `apps` array out first if you plan to disable and re-enable.

## Remove

```bash
omarchy plugin remove io.github.thevideinfra.omataskbar
```

This takes the pin list with it, for the same reason as above.

## Changes

**0.5.0** — First release as omataskbar, under its own plugin id
(`io.github.thevideinfra.omataskbar`); the entries below are upstream's and
use its id. Right-click now opens an anchored context menu at the icon,
listing the app's windows so you can focus a specific one, with a `✕` on
each row to close it. The menu also closes one window or all of them, and is
where reordering and pinning now live (`Move left` / `Move right`, `Pin to
taskbar`, `Unpin`). Running apps you haven't pinned now appear in the order
you opened them rather than alphabetically, with a separator between the
pinned and running groups (`showSeparator`). Icons flash in the theme's
urgent colour when a window asks for attention (`attentionFlash`).

**0.4.1** — Pinning works again on Omarchy 4.0.3. That release tightened
what plugins may write to the bar config, and the taskbar's pin, unpin, and
move actions were quietly declined: the `+` picker opened and let you choose
an app, but nothing ever stuck. Pins are now saved through the widget's own
settings entry, which is allowed on every Omarchy 4 release. Update with
`omarchy plugin update io.github.joeyvigil.taskbar` and restart the shell.
Thanks to @Macho0x for tracking this down and fixing it.

**0.4.0** — Open apps you haven't pinned now appear in the bar while they're
running, after the pinned icons, and disappear when their last window closes.
They work like any other icon: click to focus and cycle through that app's
windows, middle-click for a new instance. Right-click one to pin it for good.
Set `showRunningApps` to `false` to go back to a pinned-only strip.

**0.3.1** — Clicking a pinned icon repeatedly now really does cycle through
that app's windows. Focusing a window makes Hyprland warp the pointer to the
middle of it (`cursor:no_warps` defaults to `false`), which moved the pointer
off the icon, so the second click landed on the window instead of the bar and
cycling never got past the first window. The pointer is now put back where it
was, so repeated clicks keep landing on the icon.

**0.3.0** — Pin and unpin from the bar itself.

## More

- [Advanced configuration](docs/configuration.md) — per-app overrides, custom
  launch commands, the command-line interface, and what to do when an icon
  never lights up.
- [Development notes](docs/development.md) — layout of the code, and two
  non-obvious things about the plugin host worth knowing before changing it.

## License

MIT
