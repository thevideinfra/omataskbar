# Taskbar Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Omarchy taskbar plugin so right-click opens an anchored context menu listing the app's windows, running icons sit in open order with a real icon and name, a separator divides pinned from running, pinned icons can be dragged, and windows asking for attention flash.

**Architecture:** All decision logic lives in `AppModel.js`, a `.pragma library` of pure functions over plain descriptors, unit-tested under `node --test`. `BarWidget.qml` keeps settings, model assembly, event wiring, launch/focus and pin persistence, and owns the drag state. Two new QML components — `Slot.qml` (one icon) and `TaskbarMenu.qml` (a `PopupCard` menu) — hold the view.

**Tech Stack:** QML (Qt 6), Quickshell 0.3.1, Omarchy 4 shell host (`/usr/share/omarchy/shell`), Hyprland 0.56.2, Node 24 for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-15-taskbar-rework-design.md`

## Global Constraints

- Plugin id stays `io.github.joeyvigil.taskbar`. Never rename it: the user's `shell.json` entry, pins and settings are keyed on it.
- Branch is `taskbar-rework` in `/home/ks/Projects/newtaskbar`. One commit per task.
- `AppModel.js` stays a `.pragma library` with no QML globals (no `Style`, `Color`, `Qt`, `DesktopEntries`). It receives plain objects and returns plain objects. This is what makes it testable.
- Settings arrays arrive as `QVariantList`, which fails `Array.isArray`. Always go through `AppModel.toArray`. Never call `Array.isArray` on a settings value.
- Every pin write goes through `root.mutateApps(operation)`. Never write `shell.json` any other way, and never build the settings object from scratch — `mutateApps` merges the stored settings.
- Reload after a QML edit: `omarchy-shell shell rescanPlugins`. `inotify` does not see through the symlink, so saving is not enough.
- After any change touching settings, defaults or `manifest.json`, verify with a cold start: `omarchy restart shell`. Settings bugs only appear cold.
- Never run `omarchy plugin update` for this plugin while the symlink is in place; it would replace the symlink with an upstream copy.
- Host APIs are fixed and verified: `PopupCard` (`qs.Ui`), `WidgetButton` (`qs.Ui`), `Style.space()`, `Style.spaceReal()`, `Style.font.bodySmall`, `Style.cornerRadius`, `Style.hoverFillFor(fg, accent)`, `Color.popups.background`, `Color.popups.border`, `DesktopEntries.applications.values`, `DesktopEntry.execString`, and on the plugin bar facade `bar.requestPopout`, `bar.releasePopout`, `bar.activePopout`, `bar.position`, `bar.vertical`, `bar.urgent`, `bar.barForeground`, `bar.run`.
- Reference implementations in the host, worth reading before writing similar code: `plugins/bar/widgets/Tray.qml:505-700` (anchored per-icon menu with rows), `plugins/bar/Bar.qml:1902-1975` (drag with a press threshold over a clickable child).

---

### Task 1: Test harness, and the install seam

Sets up `node --test` over `AppModel.js` and locks the pure behaviour that later tasks must not break. Also puts the checkout in front of the live shell so every later task can be verified by hand.

**Files:**
- Create: `package.json`
- Create: `tests/helpers/load-app-model.mjs`
- Create: `tests/app-model.test.mjs`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadAppModel()` from `tests/helpers/load-app-model.mjs`, an async function returning the `AppModel` module namespace. Every later test file imports it.

- [ ] **Step 1: Write the loader**

`AppModel.js` starts with `.pragma library`, which Node cannot parse, and it uses no `export` statements. The loader strips the pragma, appends an export list, and imports the result as a data URL module.

Create `tests/helpers/load-app-model.mjs`:

```js
// AppModel.js is a QML .pragma library: no imports, no exports, and a pragma
// line Node cannot parse. Strip the pragma, append an export list, and load the
// result as a module so the pure helpers can be tested outside a running shell.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const EXPORTED = [
  "toArray",
  "escapeRegex",
  "idVariants",
  "defaultPattern",
  "exactPattern",
  "matcherFor",
  "defaultCovers",
  "webappPattern",
  "normalizeApp",
  "normalizeApps",
  "windowMatches",
  "windowsFor",
  "anyMatchTitle",
  "windowFingerprint",
  "sameKeys",
  "nextWindowIndex",
  "plausibleWindowClass",
  "indexOfKey",
  "hasDesktopId",
  "movedRecords",
  "serialize"
]

export async function loadAppModel() {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = await readFile(join(here, "..", "..", "AppModel.js"), "utf8")
  const body = source.replace(/^\s*\.pragma\s+library\s*$/m, "")
  const module = `${body}\nexport { ${EXPORTED.join(", ")} }\n`
  return import(`data:text/javascript;base64,${Buffer.from(module).toString("base64")}`)
}
```

Later tasks add their new function names to `EXPORTED`.

- [ ] **Step 2: Write the failing tests**

Create `tests/app-model.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

// Settings from shell.json arrive as a QVariantList: array-like, but not an Array.
function variantList(items) {
  return { length: items.length, ...Object.fromEntries(items.map((item, i) => [i, item])) }
}

test("normalizeApps accepts array-like settings values", () => {
  const records = AppModel.normalizeApps(variantList(["steam", { desktopId: "org.gnome.Nautilus" }]))
  assert.equal(records.length, 2)
  assert.equal(records[0].desktopId, "steam")
  assert.equal(records[1].desktopId, "org.gnome.Nautilus")
})

test("normalizeApps drops entries with nothing to launch or match", () => {
  assert.deepEqual(AppModel.normalizeApps([{ label: "ghost" }]), [])
})

test("windowsFor matches on appId, class, and title only when asked", () => {
  const windows = [
    { address: "a", appId: "org.gnome.Nautilus", cls: "org.gnome.Nautilus", title: "Home" },
    { address: "b", appId: "foot", cls: "foot", title: "cliamp" }
  ]
  const [nautilus] = AppModel.normalizeApps(["org.gnome.Nautilus"])
  assert.deepEqual(AppModel.windowsFor(nautilus, windows).map(w => w.address), ["a"])

  const [byTitle] = AppModel.normalizeApps([{ desktopId: "cliamp", match: "cliamp", matchTitle: true }])
  assert.deepEqual(AppModel.windowsFor(byTitle, windows).map(w => w.address), ["b"])
})

test("nextWindowIndex cycles from the focused window and wraps", () => {
  const windows = [{ address: "a" }, { address: "b" }, { address: "c" }]
  assert.equal(AppModel.nextWindowIndex(windows, "a", true), 1)
  assert.equal(AppModel.nextWindowIndex(windows, "c", true), 0)
  assert.equal(AppModel.nextWindowIndex(windows, "c", false), 0)
})

test("movedRecords moves one slot and clamps at the ends", () => {
  const records = AppModel.normalizeApps(["a", "b", "c"])
  assert.deepEqual(AppModel.movedRecords(records, 2, -1).map(r => r.desktopId), ["a", "c", "b"])
  assert.deepEqual(AppModel.movedRecords(records, 0, -1).map(r => r.desktopId), ["a", "b", "c"])
})

test("serialize collapses bare pins to strings and keeps decorated ones", () => {
  const records = AppModel.normalizeApps(["steam", { desktopId: "btop", match: "^TUI\\.tile$" }])
  assert.deepEqual(AppModel.serialize(records), ["steam", { desktopId: "btop", match: "^TUI\\.tile$" }])
})

test("windowFingerprint ignores window order and folds titles in only when asked", () => {
  const a = [{ appId: "foot", title: "one" }, { appId: "obs", title: "two" }]
  const b = [{ appId: "obs", title: "two" }, { appId: "foot", title: "one" }]
  assert.equal(AppModel.windowFingerprint(a, false), AppModel.windowFingerprint(b, false))
  assert.notEqual(AppModel.windowFingerprint(a, false), AppModel.windowFingerprint(a, true))
})
```

- [ ] **Step 3: Add the test script and run the suite**

Create `package.json`:

```json
{
  "name": "omarchy-taskbar",
  "private": true,
  "description": "Unit tests for the taskbar plugin's pure helpers. Not published; the plugin itself needs no node runtime.",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

Create `.gitignore`:

```
node_modules/
```

Run: `cd /home/ks/Projects/newtaskbar && npm test`
Expected: all 7 tests pass. They describe behaviour that already exists, so a failure here means the loader is wrong, not the plugin.

- [ ] **Step 4: Put the checkout in front of the live shell**

Run:

```bash
mv ~/.config/omarchy/plugins/io.github.joeyvigil.taskbar{,.bak}
ln -s /home/ks/Projects/newtaskbar ~/.config/omarchy/plugins/io.github.joeyvigil.taskbar
omarchy restart shell
```

Expected: the bar comes back with the taskbar widget in the left section, pinned Steam and Nautilus icons present, running apps after them. If the widget is missing, the symlink is wrong — restore with `rm` on the symlink and `mv` the `.bak` back.

- [ ] **Step 5: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add package.json .gitignore tests
git commit -m "test: unit-test AppModel's pure helpers under node --test"
```

---

### Task 2: Running icons in open order

Replaces the alphabetical sort in `unpinnedRecords` with a first-seen sequence, so an app joins the strip at the end when its first window opens and keeps that slot until its last window closes.

**Files:**
- Modify: `AppModel.js` (replace `unpinnedRecords`, around line 190)
- Modify: `BarWidget.qml:52-75` (`refreshUnpinned`, plus new `seenAt` state)
- Test: `tests/group-unpinned.test.mjs`

**Interfaces:**
- Consumes: `loadAppModel()` from Task 1.
- Produces: `groupUnpinned(pinned, windows, seenAt)` → `{ records, seenAt }`. `records` is the synthetic unpinned records in open order, each with `unpinned: true` and `key: "unpinned:" + identity`. `seenAt` is a fresh plain object mapping lowercased identity → sequence number, containing only identities that currently have windows. `AppModel.unpinnedRecords` is removed; `BarWidget` is its only caller.

- [ ] **Step 1: Write the failing test**

Create `tests/group-unpinned.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

function win(appId, address) {
  return { address, appId, cls: appId, title: appId }
}

test("new apps are appended in the order the compositor lists them", () => {
  const result = AppModel.groupUnpinned([], [win("foot", "1"), win("com.obsproject.Studio", "2")], {})
  assert.deepEqual(result.records.map(r => r.desktopId), ["foot", "com.obsproject.Studio"])
  assert.deepEqual(result.seenAt, { foot: 1, "com.obsproject.studio": 2 })
})

test("an app keeps its slot when the compositor reorders its list", () => {
  const first = AppModel.groupUnpinned([], [win("foot", "1"), win("com.obsproject.Studio", "2")], {})
  const second = AppModel.groupUnpinned([], [win("com.obsproject.Studio", "2"), win("foot", "1")], first.seenAt)
  assert.deepEqual(second.records.map(r => r.desktopId), ["foot", "com.obsproject.Studio"])
})

test("a newly opened app lands last, not in the middle", () => {
  const first = AppModel.groupUnpinned([], [win("foot", "1"), win("com.obsproject.Studio", "2")], {})
  const second = AppModel.groupUnpinned(
    [], [win("com.obsproject.Studio", "2"), win("TUI.tile", "3"), win("foot", "1")], first.seenAt)
  assert.deepEqual(second.records.map(r => r.desktopId), ["foot", "com.obsproject.Studio", "TUI.tile"])
})

test("closing an app forgets its slot, so reopening puts it last", () => {
  const first = AppModel.groupUnpinned([], [win("foot", "1"), win("com.obsproject.Studio", "2")], {})
  const closed = AppModel.groupUnpinned([], [win("com.obsproject.Studio", "2")], first.seenAt)
  assert.deepEqual(Object.keys(closed.seenAt), ["com.obsproject.studio"])

  const reopened = AppModel.groupUnpinned([], [win("com.obsproject.Studio", "2"), win("foot", "9")], closed.seenAt)
  assert.deepEqual(reopened.records.map(r => r.desktopId), ["com.obsproject.Studio", "foot"])
})

test("windows a pin already claims produce no record", () => {
  const pinned = AppModel.normalizeApps(["org.gnome.Nautilus"])
  const windows = [win("org.gnome.Nautilus", "1"), win("foot", "2")]
  const result = AppModel.groupUnpinned(pinned, windows, {})
  assert.deepEqual(result.records.map(r => r.desktopId), ["foot"])
})

test("several windows of one app collapse into one record", () => {
  const result = AppModel.groupUnpinned([], [win("foot", "1"), win("foot", "2"), win("FOOT", "3")], {})
  assert.deepEqual(result.records.map(r => r.desktopId), ["foot"])
  assert.equal(result.records[0].key, "unpinned:foot")
  assert.equal(result.records[0].unpinned, true)
})
```

Add `"groupUnpinned"` to the `EXPORTED` list in `tests/helpers/load-app-model.mjs` and remove `"unpinnedRecords"` if it was listed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `AppModel.groupUnpinned is not a function`.

- [ ] **Step 3: Replace `unpinnedRecords` with `groupUnpinned`**

In `AppModel.js`, delete the whole `unpinnedRecords` function and put this in its place (keep the surrounding comments about grouping, they still apply):

```js
// Windows that no pinned record claims, grouped into one synthetic record per
// application, in the order the apps were first seen.
//
// `seenAt` maps a lowercased identity to the sequence number it was given the
// first time it appeared. Returned alongside the records, rebuilt to hold only
// identities that still have windows: an app that closes forgets its slot, so
// reopening it puts it at the end rather than back in the middle.
//
// Ordering is not taken from the compositor's list, which reorders as focus
// moves — an icon that moves under the pointer is worse than an icon in the
// wrong place. New identities are appended in list order, which is stable
// within a single refresh.
function groupUnpinned(pinned, windows, seenAt) {
  var all = toArray(windows)
  var pins = toArray(pinned)
  var claims = []
  for (var p = 0; p < pins.length; p++) {
    claims.push({ record: pins[p], matcher: matcherFor(pins[p]) })
  }

  // Lowered identity -> the identity as the window actually reported it, plus
  // the keys in first-appearance order.
  var byKey = {}
  var live = []
  for (var i = 0; i < all.length; i++) {
    var win = all[i]
    var claimed = false
    for (var c = 0; c < claims.length; c++) {
      if (windowMatches(claims[c].record, claims[c].matcher, win)) {
        claimed = true
        break
      }
    }
    if (claimed) continue

    // appId is the Wayland identity a desktop entry is keyed on; cls is the
    // fallback for clients that report only a class.
    var identity = String(win.appId || win.cls || "")
    if (!identity) continue
    var key = identity.toLowerCase()
    if (key in byKey) continue
    byKey[key] = identity
    live.push(key)
  }

  var previous = seenAt || {}
  var highest = 0
  for (var known in previous) {
    if (previous[known] > highest) highest = previous[known]
  }

  var next = {}
  for (var l = 0; l < live.length; l++) {
    var liveKey = live[l]
    next[liveKey] = (liveKey in previous) ? previous[liveKey] : ++highest
  }

  live.sort(function(a, b) { return next[a] - next[b] })

  var out = []
  for (var s = 0; s < live.length; s++) {
    var id = byKey[live[s]]
    // Built through normalizeApp so a synthetic record has exactly the shape a
    // stored one does and the widget never has to ask which kind it is holding.
    var record = normalizeApp({ desktopId: id, match: exactPattern(id) }, s)
    if (!record) continue
    // Not from shell.json: never written back, and its menu offers pinning
    // rather than unpinning. serialize() whitelists fields, so this cannot
    // reach the config even by accident.
    record.unpinned = true
    // Namespaced so it cannot collide with a stored pin for the same id.
    record.key = "unpinned:" + id
    out.push(record)
  }
  return { records: out, seenAt: next }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Wire it into the widget**

In `BarWidget.qml`, next to `property string lastFingerprint`, add:

```qml
  // Identity -> the sequence number it was first seen with. In memory only: a
  // shell restart reseeds from the compositor's list, which is acceptable for
  // ordering state that nothing else depends on.
  property var seenAt: ({})
```

Then replace the body of `refreshUnpinned()` with:

```qml
  function refreshUnpinned() {
    if (!root.showRunningApps) {
      if (root.unpinnedApps.length > 0) root.unpinnedApps = []
      root.seenAt = ({})
      return
    }

    var fingerprint = AppModel.windowFingerprint(root.windows,
      AppModel.anyMatchTitle(root.pinned))
    if (fingerprint === root.lastFingerprint) return
    root.lastFingerprint = fingerprint

    var grouped = AppModel.groupUnpinned(root.pinned, root.windows, root.seenAt)
    root.seenAt = grouped.seenAt
    if (AppModel.sameKeys(grouped.records, root.unpinnedApps)) return
    root.unpinnedApps = grouped.records
  }
```

- [ ] **Step 6: Verify on the live bar**

Run: `omarchy-shell shell rescanPlugins`

Then, with a terminal, OBS and one more app closed to start from a clean strip:
1. Open three apps in a known order (for example `foot`, then OBS, then Nautilus is pinned so use `imv` or `btop`).
2. Expected: running icons read left to right in the order you opened them, after the pinned Steam and Nautilus icons.
3. Click between windows so focus moves around. Expected: no icon changes position.
4. Close the middle app. Expected: the remaining two keep their relative order and the third does not jump.
5. Reopen the closed app. Expected: it appears last.

- [ ] **Step 7: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add AppModel.js BarWidget.qml tests
git commit -m "feat: order running icons by when their app was first seen"
```

---

### Task 3: Resolve window classes that only exist as an Exec app id

`~/.local/share/applications/Btop.desktop` runs `xdg-terminal-exec --app-id=TUI.tile -e btop`, so its windows report class `TUI.tile`, which answers to no desktop entry id. The slot falls back to a letter tile labelled `TUI.tile`. Index the `--app-id=` / `--class=` values found in entries' `Exec` lines and consult that index before giving up.

**Files:**
- Modify: `AppModel.js` (add `execAppIdIndex` after `plausibleWindowClass`)
- Modify: `BarWidget.qml:139-161` (`entryById`, plus a new `execIndex` property)
- Test: `tests/exec-app-id-index.test.mjs`

**Interfaces:**
- Consumes: `loadAppModel()` from Task 1.
- Produces: `execAppIdIndex(entries)` → plain object mapping a lowercased app id to a desktop entry id. `entries` is an array of `{ id, exec }` descriptors. First entry wins on a duplicate id.

- [ ] **Step 1: Write the failing test**

Create `tests/exec-app-id-index.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

test("indexes --app-id= values from Exec lines", () => {
  const index = AppModel.execAppIdIndex([
    { id: "Btop", exec: "xdg-terminal-exec --app-id=TUI.tile -e btop" },
    { id: "foot", exec: "foot" }
  ])
  assert.equal(index["tui.tile"], "Btop")
})

test("indexes the --class form and space-separated values", () => {
  const index = AppModel.execAppIdIndex([
    { id: "Weather", exec: "alacritty --class Weather.tile -e weather" },
    { id: "Music", exec: "foot --app-id 'Music.tile' -e cmus" }
  ])
  assert.equal(index["weather.tile"], "Weather")
  assert.equal(index["music.tile"], "Music")
})

test("the first entry wins when two entries share an app id", () => {
  const index = AppModel.execAppIdIndex([
    { id: "Btop", exec: "xdg-terminal-exec --app-id=TUI.tile -e btop" },
    { id: "Htop", exec: "xdg-terminal-exec --app-id=TUI.tile -e htop" }
  ])
  assert.equal(index["tui.tile"], "Btop")
})

test("entries without an id or exec are skipped, and nothing else is indexed", () => {
  const index = AppModel.execAppIdIndex([
    { id: "", exec: "foot --app-id=Ghost.tile" },
    { id: "NoExec", exec: "" },
    { id: "Plain", exec: "gimp -n" },
    null
  ])
  assert.deepEqual(index, {})
})
```

Add `"execAppIdIndex"` to `EXPORTED` in `tests/helpers/load-app-model.mjs`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `AppModel.execAppIdIndex is not a function`.

- [ ] **Step 3: Implement the index**

In `AppModel.js`, after `plausibleWindowClass`, add:

```js
// A desktop entry that launches a terminal with an explicit app id owns that id
// as far as the compositor is concerned: `xdg-terminal-exec --app-id=TUI.tile -e
// btop` produces windows whose class is TUI.tile, and no entry has that as its
// own id. Index those values so such a window can still find an icon and a name
// instead of falling back to a letter tile.
//
// `entries` are plain { id, exec } descriptors, so this stays free of QML
// globals. First entry wins: two TUIs sharing one app id are indistinguishable
// here, and picking the first is at least stable.
function execAppIdIndex(entries) {
  var all = toArray(entries)
  var index = {}
  var pattern = /--(?:app-id|class)(?:=|\s+)("[^"]*"|'[^']*'|[^\s]+)/g

  for (var i = 0; i < all.length; i++) {
    var entry = all[i]
    if (!entry) continue
    var id = String(entry.id || "")
    var exec = String(entry.exec || "")
    if (!id || !exec) continue

    pattern.lastIndex = 0
    var found = pattern.exec(exec)
    while (found) {
      var value = found[1].replace(/^['"]|['"]$/g, "").toLowerCase()
      if (value && !(value in index)) index[value] = id
      found = pattern.exec(exec)
    }
  }
  return index
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Consult the index from the widget**

In `BarWidget.qml`, add next to the other derived properties (after `entrySerial` is declared):

```qml
  // Lowercased app id -> desktop entry id, for window classes that exist only
  // as an --app-id inside some entry's Exec. Rebuilt when the entry index
  // changes, which is what entrySerial tracks.
  readonly property var execIndex: {
    var serial = root.entrySerial // binding dependency
    var descriptors = []
    var values = DesktopEntries.applications ? DesktopEntries.applications.values : []
    for (var i = 0; i < values.length; i++) {
      var entry = values[i]
      if (!entry) continue
      descriptors.push({ id: String(entry.id || ""), exec: String(entry.execString || "") })
    }
    return AppModel.execAppIdIndex(descriptors)
  }
```

Then, in `entryById`, insert the index lookup between the exact lookup and the heuristic one:

```qml
  function entryById(desktopId) {
    var serial = root.entrySerial // binding dependency, see above
    var id = String(desktopId || "")
    if (!id) return null
    try {
      var exact = DesktopEntries.byId(id)
      if (exact) return exact
    } catch (e) { }

    // A window class that is only some entry's --app-id: resolve through the
    // Exec index before falling back to guessing.
    var mapped = root.execIndex[id.toLowerCase()]
    if (mapped) {
      try {
        var byExec = DesktopEntries.byId(mapped)
        if (byExec) return byExec
      } catch (e) { }
    }

    // heuristicLookup answers with *some* application rather than nothing, so
    // before the entry index is warm it will hand back an unrelated app and we
    // would paint its icon and name onto this slot. Keep the lookup — it is
    // what resolves "firefox" to org.mozilla.firefox — but only accept a
    // result whose id is actually related to the one asked for.
    try {
      var guess = DesktopEntries.heuristicLookup(id)
      if (guess && root.idsRelated(id, String(guess.id || ""))) return guess
    } catch (e) { }
    return null
  }
```

- [ ] **Step 6: Verify on the live bar**

Run: `omarchy-shell shell rescanPlugins`

1. Start btop through its entry: `gtk-launch Btop.desktop` (or the app launcher).
2. Expected: the new running icon shows btop's own icon, and its tooltip reads `Btop`, not `TUI.tile` and not a letter tile.
3. Hover a plain `foot` window's icon. Expected: unchanged, `Foot`.

- [ ] **Step 7: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add AppModel.js BarWidget.qml tests
git commit -m "feat: resolve window classes that only exist as an Exec app id"
```

---

### Task 4: Extract the icon delegate into Slot.qml

Pure refactor with no behaviour change, so the menu, drag and flash work lands in a file that is only about one icon.

**Files:**
- Create: `Slot.qml`
- Modify: `BarWidget.qml` (the `Repeater` delegate inside `GridLayout`, currently `BarWidget.qml:586-667`)
- Modify: `docs/development.md` (file map)

**Interfaces:**
- Consumes: `root.windows`, `root.activeAddress`, and the style settings on the widget root.
- Produces: `Slot.qml`, a `WidgetButton` with `required property var host` (the widget root), `required property var modelData` (the record), `readonly property var matched` (its windows), `readonly property bool running`, `readonly property bool focused`, and the signal handler `onPressed(button)` forwarding to `host.handlePress(modelData, button)`.

- [ ] **Step 1: Create `Slot.qml` with the delegate's current contents**

```qml
import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "AppModel.js" as AppModel

// One taskbar icon: a pinned entry or a running app.
//
// Owns no model state. `host` is the widget root, which supplies the window
// list, the style settings and the press handling, so this file is only about
// painting one slot and reporting what the pointer did to it.
WidgetButton {
  id: slot

  required property var host
  required property var modelData

  readonly property var matched: AppModel.windowsFor(modelData, host.windows)
  readonly property bool running: matched.length > 0
  readonly property bool focused: {
    if (!running || host.activeAddress === "") return false
    for (var i = 0; i < matched.length; i++) {
      if (matched[i].address === host.activeAddress) return true
    }
    return false
  }

  readonly property var entry: host.desktopEntry(modelData)
  readonly property string iconName: {
    if (modelData.icon) return modelData.icon
    return entry && entry.icon ? String(entry.icon) : String(modelData.desktopId || "")
  }
  readonly property string appLabel: host.labelFor(modelData)

  bar: host.bar
  labelVisible: false
  hasVisualContent: true
  dimmed: host.dimWhenClosed && !running
  tooltipText: appLabel + (matched.length > 1 ? " (" + matched.length + " windows)" : "")
  fixedWidth: host.vertical ? host.barSize : host.slotSize
  fixedHeight: host.vertical ? host.slotSize : host.barSize

  onPressed: function(button) { host.handlePress(slot.modelData, button) }

  Image {
    id: iconImage
    visible: status === Image.Ready
    anchors.centerIn: parent
    // Leave room for the indicator so the icon stays optically centered.
    anchors.verticalCenterOffset: host.runningIndicator && !host.vertical ? -1 : 0
    anchors.horizontalCenterOffset: host.runningIndicator && host.vertical ? 1 : 0
    width: host.iconSize
    height: host.iconSize
    sourceSize.width: host.iconSize * 2
    sourceSize.height: host.iconSize * 2
    fillMode: Image.PreserveAspectFit
    asynchronous: true
    smooth: true
    source: host.iconSource(slot.iconName)
  }

  // Icon lookups fail for entries with no themed icon; a letter tile keeps the
  // slot readable instead of leaving a hole in the bar.
  Text {
    visible: iconImage.status !== Image.Ready
    anchors.centerIn: iconImage
    text: slot.appLabel.substring(0, 1).toUpperCase()
    color: slot.focused ? slot.activeColor : slot.foreground
    font.family: slot.fontFamily
    font.pixelSize: Style.font.bodySmall
    renderType: Text.NativeRendering
  }

  Rectangle {
    id: indicator
    visible: host.runningIndicator && slot.running
    readonly property int extent: slot.matched.length > 1 ? 10 : 5
    width: host.vertical ? 2 : extent
    height: host.vertical ? extent : 2
    radius: 1
    color: slot.focused ? slot.activeColor : slot.foreground
    x: host.vertical ? 2 : (slot.width - width) / 2
    y: host.vertical ? (slot.height - height) / 2 : slot.height - height - 3

    Behavior on color {
      ColorAnimation { duration: 160 }
    }
  }
}
```

- [ ] **Step 2: Replace the inline delegate**

In `BarWidget.qml`, the `Repeater` inside `GridLayout` becomes:

```qml
    Repeater {
      id: slotRepeater
      model: root.slots

      Slot {
        host: root
      }
    }
```

`Slot` declares `required property var modelData` itself, and a `Repeater`
fills a delegate's required `modelData` from its model, so nothing else is
assigned here. Do not add `modelData: modelData` — that is a self-assignment
and the engine warns about a binding loop.

`root.vertical`, `root.barSize` and `root.slotSize` must be readable from
`Slot`; `vertical` and `barSize` come from the host's `BarWidget` base and
`slotSize` is declared at `BarWidget.qml:93`. No other change is needed.

- [ ] **Step 3: Verify nothing changed**

Run: `omarchy-shell shell rescanPlugins`, then watch for QML warnings with `journalctl --user -u omarchy-shell -n 40 --no-pager` (or the unit that runs `qs` on this host — find it with `systemctl --user list-units '*omarchy*'`).

Expected: icons, tooltips (including `(N windows)`), running indicators, dimming, left/middle/right-click and the `+` button all behave exactly as before, and the log shows no new QML warnings.

- [ ] **Step 4: Update the file map**

In `docs/development.md`, change the file list to:

```
manifest.json      plugin declaration and setting schema
BarWidget.qml      the widget the bar mounts
Slot.qml           one icon: image or letter tile, indicator, flash, drag source
AppModel.js        entry normalization, window matching, grouping, list editing
bin/taskbar-pick   shows a list in the Omarchy menu, prints the choice
```

- [ ] **Step 5: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add Slot.qml BarWidget.qml docs/development.md
git commit -m "refactor: move the icon delegate into Slot.qml"
```

---

### Task 5: Anchored context menu with window rows

Right-click opens a `PopupCard` at the icon, listing the app's windows and its actions. The centered `omarchy.menu` overlay path for actions goes away; the `+` picker keeps using it.

**Files:**
- Create: `TaskbarMenu.qml`
- Modify: `AppModel.js` (add `menuRows`)
- Modify: `BarWidget.qml` (remove `promptActions`, the `actions` branch of `onPicked`; add menu state and `focusAddress`)
- Modify: `Slot.qml` (expose itself as the anchor)
- Modify: `manifest.json` (`barWidget.description`)
- Test: `tests/menu-rows.test.mjs`

**Interfaces:**
- Consumes: `groupUnpinned` records from Task 2, `Slot` from Task 4.
- Produces:
  - `menuRows(record, windows, activeAddress, pinnedIndex, pinnedCount, vertical, label)` → array of rows. Row shapes: `{ kind: "header", label }`, `{ kind: "separator" }`, `{ kind: "window", label, address, active }`, `{ kind: "action", action, label }` where `action` is one of `"launch"`, `"pin"`, `"unpin"`, `"back"`, `"forward"`.
  - On `BarWidget`: `function openMenu(record, anchor)`, `function closeMenu()`, `function focusAddress(address)`, properties `menuRecord`, `menuAnchor`, `menuOpen`.

- [ ] **Step 1: Write the failing test**

Create `tests/menu-rows.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

const [pin] = AppModel.normalizeApps(["foot"])
const windows = [
  { address: "a", title: "cliamp" },
  { address: "b", title: "Taskbar plugin" }
]

function kinds(rows) {
  return rows.map(row => row.kind)
}

function actions(rows) {
  return rows.filter(row => row.kind === "action").map(row => row.action)
}

test("a running pinned app lists a header, its windows, then its actions", () => {
  const rows = AppModel.menuRows(pin, windows, "b", 1, 3, false, "Foot")
  assert.deepEqual(kinds(rows), [
    "header", "separator", "window", "window", "separator", "action", "action", "action", "action"
  ])
  assert.equal(rows[0].label, "Foot")
  assert.deepEqual(rows.filter(r => r.kind === "window").map(r => r.label), ["cliamp", "Taskbar plugin"])
  assert.deepEqual(rows.filter(r => r.kind === "window").map(r => r.active), [false, true])
  assert.deepEqual(actions(rows), ["launch", "back", "forward", "unpin"])
})

test("an app with no windows has no window rows", () => {
  const rows = AppModel.menuRows(pin, [], "", 0, 1, false, "Foot")
  assert.deepEqual(kinds(rows), ["header", "separator", "action", "action"])
  assert.deepEqual(actions(rows), ["launch", "unpin"])
})

test("move rows appear only where a neighbour exists, and read vertically on a side bar", () => {
  const first = AppModel.menuRows(pin, [], "", 0, 3, false, "Foot")
  assert.deepEqual(actions(first), ["launch", "forward", "unpin"])

  const last = AppModel.menuRows(pin, [], "", 2, 3, false, "Foot")
  assert.deepEqual(actions(last), ["launch", "back", "unpin"])

  const vertical = AppModel.menuRows(pin, [], "", 1, 3, true, "Foot")
  assert.deepEqual(
    vertical.filter(r => r.kind === "action").map(r => r.label),
    ["New instance", "Move up", "Move down", "Unpin"])
})

test("a running app that is not pinned offers pinning instead of unpinning", () => {
  const record = { desktopId: "com.obsproject.Studio", key: "unpinned:com.obsproject.Studio", unpinned: true }
  const rows = AppModel.menuRows(record, [{ address: "z", title: "OBS" }], "z", -1, 2, false, "OBS Studio")
  assert.deepEqual(actions(rows), ["launch", "pin"])
  assert.equal(rows.find(r => r.kind === "window").active, true)
})

test("a window with no title falls back to the app label", () => {
  const rows = AppModel.menuRows(pin, [{ address: "a", title: "" }], "", 0, 1, false, "Foot")
  assert.equal(rows.find(r => r.kind === "window").label, "Foot")
})
```

Add `"menuRows"` to `EXPORTED`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `AppModel.menuRows is not a function`.

- [ ] **Step 3: Implement `menuRows`**

In `AppModel.js`, after `serialize`, add:

```js
// ------------------------------------------------------------------ menu

// The rows of one icon's context menu, as plain data so the row set is
// testable without a running shell and the QML side only paints what it is
// given. `pinnedIndex` is the record's position in the stored pin list, or -1
// for a running app that is not pinned.
function menuRows(record, windows, activeAddress, pinnedIndex, pinnedCount, vertical, label) {
  if (!record) return []

  var name = String(label || record.desktopId || "")
  var rows = [{ kind: "header", label: name }]
  var all = toArray(windows)
  var active = String(activeAddress || "")

  if (all.length > 0) {
    rows.push({ kind: "separator" })
    for (var i = 0; i < all.length; i++) {
      var address = String(all[i].address || "")
      rows.push({
        kind: "window",
        label: String(all[i].title || name),
        address: address,
        active: address !== "" && address === active
      })
    }
  }

  rows.push({ kind: "separator" })
  rows.push({ kind: "action", action: "launch", label: "New instance" })

  if (record.unpinned) {
    rows.push({ kind: "action", action: "pin", label: "Pin to taskbar" })
    return rows
  }

  if (pinnedIndex > 0) {
    rows.push({ kind: "action", action: "back", label: vertical ? "Move up" : "Move left" })
  }
  if (pinnedIndex >= 0 && pinnedIndex < pinnedCount - 1) {
    rows.push({ kind: "action", action: "forward", label: vertical ? "Move down" : "Move right" })
  }
  rows.push({ kind: "action", action: "unpin", label: "Unpin" })
  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write `TaskbarMenu.qml`**

Modelled on the tray's menu card (`/usr/share/omarchy/shell/plugins/bar/widgets/Tray.qml:521-700`): same `PopupCard`, same row height and hover fill, same separator line.

```qml
import QtQuick
import qs.Commons
import qs.Ui

// The context menu for one taskbar icon.
//
// PopupCard is the host's own anchored card — the tray uses it for exactly this
// — so the menu appears at the icon, flips side with the bar position, and gets
// outside-click dismissal through HyprlandFocusGrab for free.
PopupCard {
  id: menu

  // The widget root, for colors, fonts and the callbacks the rows invoke.
  required property var host
  // Plain row data from AppModel.menuRows.
  property var rows: []

  readonly property color foreground: host.bar ? host.bar.barForeground : Color.foreground
  readonly property string fontFamily: host.bar ? host.bar.fontFamily : Style.font.family
  readonly property int rowHeight: Style.space(30)
  readonly property int separatorHeight: Style.space(11)

  function rowsHeight() {
    var total = 0
    for (var i = 0; i < menu.rows.length; i++) {
      total += menu.rows[i].kind === "separator" ? menu.separatorHeight : menu.rowHeight
    }
    return total
  }

  owner: menu
  bar: host.bar
  padding: Style.space(8)
  borderColor: Qt.rgba(menu.foreground.r, menu.foreground.g, menu.foreground.b, 0.45)
  contentWidth: menu.fittedContentWidth(Style.space(232))
  contentHeight: menu.fittedContentHeight(column.implicitHeight, Style.space(420))

  // PopupCard.close() defers to owner.close() when the owner has one, and this
  // component is its own owner, so this override is what the focus grab and the
  // rows both end up calling. It routes through the widget because `open` is
  // bound to host state: assigning `open` directly would break that binding.
  function close() { host.closeMenu() }

  Column {
    id: column
    anchors.fill: parent
    spacing: 0
    implicitHeight: menu.rowsHeight()

    Repeater {
      model: menu.rows

      delegate: Item {
        id: row
        required property var modelData

        readonly property bool isSeparator: modelData.kind === "separator"
        readonly property bool isHeader: modelData.kind === "header"
        readonly property bool clickable: modelData.kind === "window" || modelData.kind === "action"

        width: column.width
        implicitHeight: row.isSeparator ? menu.separatorHeight : menu.rowHeight

        Rectangle {
          visible: row.isSeparator
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.right: parent.right
          anchors.rightMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          height: 1
          color: Color.popups.border
          opacity: 0.45
        }

        Rectangle {
          visible: rowMouse.containsMouse && row.clickable
          anchors.fill: parent
          radius: Math.max(2, Style.cornerRadius)
          color: Style.hoverFillFor(menu.foreground, menu.foreground)
        }

        // The focused window's marker. Kept out of the label so titles stay
        // aligned whether or not a window is focused.
        Text {
          visible: row.modelData.kind === "window"
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          width: Style.space(22)
          horizontalAlignment: Text.AlignHCenter
          text: row.modelData.active ? "•" : ""
          color: menu.foreground
          font.family: menu.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          visible: !row.isSeparator
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          anchors.leftMargin: row.modelData.kind === "window" ? Style.space(28) : Style.space(10)
          anchors.right: parent.right
          anchors.rightMargin: Style.space(10)
          text: row.modelData.label
          color: menu.foreground
          opacity: row.isHeader ? 0.6 : 1.0
          font.family: menu.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.bold: row.isHeader
          elide: Text.ElideRight
        }

        MouseArea {
          id: rowMouse
          anchors.fill: parent
          hoverEnabled: row.clickable
          enabled: row.clickable
          cursorShape: Qt.PointingHandCursor
          onClicked: {
            if (row.modelData.kind === "window") host.focusAddress(row.modelData.address)
            else host.runAction(host.menuRecord ? host.menuRecord.key : "", row.modelData.action)
            host.closeMenu()
          }
        }
      }
    }
  }
}
```

- [ ] **Step 6: Wire the menu into `BarWidget.qml`**

Delete `promptActions()` entirely, and delete the `actions` branch from `onPicked` so it reads:

```qml
  // The menu returns "<label>\t<value>"; the value is the field we set.
  function onPicked(kind, context, raw) {
    var text = String(raw || "").trim()
    if (!text) return
    var parts = text.split("\t")
    var value = parts[parts.length - 1]
    if (!value) return
    if (kind === "add") root.pinApp(value)
  }
```

Add the menu state and helpers near the other functions:

```qml
  // ------------------------------------------------------------------- menu

  property var menuRecord: null
  property var menuAnchor: null
  property bool menuOpen: false

  function openMenu(record, anchor) {
    if (!record || !anchor) return
    // Re-pressing the same icon closes the menu, the way a tray icon does.
    if (root.menuOpen && root.menuRecord && root.menuRecord.key === record.key) {
      root.closeMenu()
      return
    }
    root.menuRecord = record
    root.menuAnchor = anchor
    root.menuOpen = true
  }

  function closeMenu() {
    root.menuOpen = false
  }

  // Rows are rebuilt from live state, so the menu follows windows opening and
  // closing while it is on screen.
  readonly property var menuRows: {
    if (!root.menuRecord) return []
    var record = root.menuRecord
    return AppModel.menuRows(record,
      AppModel.windowsFor(record, root.windows),
      root.activeAddress,
      record.unpinned ? -1 : AppModel.indexOfKey(root.pinned, record.key),
      root.pinned.length,
      root.vertical,
      root.labelFor(record))
  }

  function focusAddress(address) {
    var target = String(address || "")
    if (!target) return
    for (var i = 0; i < root.windows.length; i++) {
      if (root.windows[i].address === target) {
        root.focusWindow(root.windows[i])
        return
      }
    }
  }
```

Change `handlePress` so right-click opens the menu at the pressed slot:

```qml
  function handlePress(record, button, anchor) {
    if (button === Qt.MiddleButton) {
      root.launch(record)
      return
    }
    if (button === Qt.RightButton) {
      root.openMenu(record, anchor)
      return
    }
    var matched = AppModel.windowsFor(record, root.windows)
    if (matched.length === 0) {
      root.launch(record)
      return
    }
    var index = AppModel.nextWindowIndex(matched, root.activeAddress, root.cycleWindows)
    root.focusWindow(matched[index])
  }
```

Add the menu instance next to the `Process` and `IpcHandler` declarations:

```qml
  TaskbarMenu {
    id: contextMenu
    host: root
    anchorItem: root.menuAnchor || root
    open: root.menuOpen
    rows: root.menuRows
  }
```

Finally, make the widget close the menu when the record it describes disappears:

```qml
  onSlotsChanged: {
    if (!root.menuOpen || !root.menuRecord) return
    if (AppModel.indexOfKey(root.slots, root.menuRecord.key) < 0) root.closeMenu()
  }
```

- [ ] **Step 7: Pass the anchor from `Slot.qml`**

In `Slot.qml`, change the press handler:

```qml
  onPressed: function(button) { host.handlePress(slot.modelData, button, slot) }
```

- [ ] **Step 8: Update the manifest description**

In `manifest.json`, replace `barWidget.description` with:

```
"description": "Pinned app icons with running indicators; left = launch or focus, right = context menu with the app's windows, middle = new instance",
```

- [ ] **Step 9: Verify on the live bar**

Run: `omarchy-shell shell rescanPlugins`

1. Right-click a pinned icon with no windows. Expected: a card appears at that icon with the app name, `New instance`, the available `Move` row(s) and `Unpin`.
2. Right-click the `foot` icon with three terminal windows open. Expected: three window rows titled by window, a dot on the focused one.
3. Click a window row. Expected: that exact window is focused, the pointer stays where it was, the menu closes.
4. Click outside the menu. Expected: it closes and nothing else is activated.
5. Right-click the same icon twice. Expected: the menu opens, then closes.
6. Right-click a running app that is not pinned. Expected: `New instance` and `Pin to taskbar`; pinning still works.
7. Move the bar to the bottom (`omarchy` bar settings) and repeat step 1. Expected: the card appears above the icon.
8. With a menu open, close the app it belongs to from elsewhere. Expected: the menu closes rather than showing dead rows.

- [ ] **Step 10: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add AppModel.js BarWidget.qml Slot.qml TaskbarMenu.qml manifest.json tests
git commit -m "feat: anchored context menu listing each app's windows"
```

---

### Task 6: Separator between pinned and running icons

**Files:**
- Modify: `BarWidget.qml` (the `GridLayout`, and a new setting read)
- Modify: `manifest.json` (`defaults` and `schema`)

**Interfaces:**
- Consumes: `root.pinned`, `root.unpinnedApps` from Task 2.
- Produces: `root.showSeparator` (bool setting, default true).

- [ ] **Step 1: Read the setting**

In `BarWidget.qml`, next to the other setting properties:

```qml
  readonly property bool showSeparator: root.setting("showSeparator", true) === true
```

- [ ] **Step 2: Draw it between the two groups**

The `GridLayout` currently holds one `Repeater` over `root.slots` plus the trailing button. Split the repeaters so a separator item can sit between them, and keep the column count in step:

```qml
  GridLayout {
    id: layout
    anchors.fill: parent
    columns: root.vertical
      ? 1
      : Math.max(1, root.pinned.length + root.unpinnedApps.length
          + (root.separatorVisible ? 1 : 0) + (root.showTrailing ? 1 : 0))
    columnSpacing: root.vertical ? 0 : root.gap
    rowSpacing: root.vertical ? root.gap : 0

    Repeater {
      id: pinnedRepeater
      model: root.pinned

      Slot {
        required property var modelData
        host: root
        modelData: modelData
      }
    }

    // Only earns its space when both groups are present.
    Rectangle {
      visible: root.separatorVisible
      Layout.preferredWidth: root.vertical ? Math.round(root.barSize * 0.5) : 1
      Layout.preferredHeight: root.vertical ? 1 : Math.round(root.barSize * 0.5)
      Layout.alignment: Qt.AlignCenter
      color: Color.popups.border
      opacity: 0.45
    }

    Repeater {
      id: runningRepeater
      model: root.unpinnedApps

      Slot {
        required property var modelData
        host: root
        modelData: modelData
      }
    }

    WidgetButton {
      id: trailing
      // unchanged from here on
```

Add the derived visibility next to the setting:

```qml
  readonly property bool separatorVisible: root.showSeparator
    && root.pinned.length > 0 && root.unpinnedApps.length > 0
```

Keep `root.slots` — `onSlotsChanged`, `handlePress` and `recordForKey` still use it — but it is no longer the layout's model.

- [ ] **Step 3: Declare the setting**

In `manifest.json`, add to `barWidget.defaults`:

```json
      "showSeparator": true,
```

and to `barWidget.schema`:

```json
      {
        "key": "showSeparator",
        "type": "bool",
        "label": "Separate pinned apps from running apps"
      },
```

- [ ] **Step 4: Verify on the live bar**

Run: `omarchy restart shell` (a settings change, so cold start).

1. With pins and running apps both present: expected a thin vertical line between the two groups, the widget's own gap on each side.
2. Close every unpinned app. Expected: the line disappears and no gap is left behind.
3. Set `"showSeparator": false` in the widget's `shell.json` entry, `omarchy restart shell`. Expected: no line.
4. Move the bar to the left edge. Expected: a thin horizontal line between the groups.

- [ ] **Step 5: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add BarWidget.qml manifest.json
git commit -m "feat: separate the pinned group from the running group"
```

---

### Task 7: Drag to reorder pins, and drag a running app onto the pinned strip

**Files:**
- Modify: `AppModel.js` (add `reorderedRecords`, `insertRecordAt`)
- Modify: `Slot.qml` (drag MouseArea over the button)
- Modify: `BarWidget.qml` (drag state, hit test, drop marker, commit functions)
- Test: `tests/pin-editing.test.mjs`

**Interfaces:**
- Consumes: `mutateApps`, `pinRunning` (existing), `Slot` from Task 4.
- Produces:
  - `reorderedRecords(records, fromIndex, toIndex)` → new array with the entry moved to `toIndex`, clamped, unchanged when the indices match.
  - `insertRecordAt(records, record, index)` → new array with `record` inserted at a clamped `index`, unchanged when a pin with that `desktopId` already exists.
  - On `BarWidget`: `dragKey`, `dragIndex`, `dropIndex`, `dragActive`, `function beginDrag(record, index)`, `function updateDrag(scenePoint)`, `function endDrag()`, `function slotAtScene(scenePoint)`.

- [ ] **Step 1: Write the failing test**

Create `tests/pin-editing.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

const ids = records => records.map(r => r.desktopId)

test("reorderedRecords moves an entry to the target index", () => {
  const records = AppModel.normalizeApps(["a", "b", "c"])
  assert.deepEqual(ids(AppModel.reorderedRecords(records, 0, 2)), ["b", "c", "a"])
  assert.deepEqual(ids(AppModel.reorderedRecords(records, 2, 0)), ["c", "a", "b"])
})

test("reorderedRecords clamps and is a no-op when nothing moves", () => {
  const records = AppModel.normalizeApps(["a", "b", "c"])
  assert.deepEqual(ids(AppModel.reorderedRecords(records, 1, 1)), ["a", "b", "c"])
  assert.deepEqual(ids(AppModel.reorderedRecords(records, 0, 9)), ["b", "c", "a"])
  assert.deepEqual(ids(AppModel.reorderedRecords(records, 5, 0)), ["a", "b", "c"])
})

test("insertRecordAt inserts at a clamped index", () => {
  const records = AppModel.normalizeApps(["a", "b"])
  assert.deepEqual(ids(AppModel.insertRecordAt(records, { desktopId: "c" }, 1)), ["a", "c", "b"])
  assert.deepEqual(ids(AppModel.insertRecordAt(records, { desktopId: "c" }, 9)), ["a", "b", "c"])
  assert.deepEqual(ids(AppModel.insertRecordAt(records, { desktopId: "c" }, -3)), ["c", "a", "b"])
})

test("insertRecordAt refuses a duplicate or an empty record", () => {
  const records = AppModel.normalizeApps(["a", "b"])
  assert.deepEqual(ids(AppModel.insertRecordAt(records, { desktopId: "a" }, 0)), ["a", "b"])
  assert.deepEqual(ids(AppModel.insertRecordAt(records, {}, 0)), ["a", "b"])
})

test("an inserted record survives serialization with its match", () => {
  const records = AppModel.insertRecordAt(
    AppModel.normalizeApps(["a"]), { desktopId: "btop", match: "^TUI\\.tile$" }, 0)
  assert.deepEqual(AppModel.serialize(records), [{ desktopId: "btop", match: "^TUI\\.tile$" }, "a"])
})
```

Add `"reorderedRecords"` and `"insertRecordAt"` to `EXPORTED`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `AppModel.reorderedRecords is not a function`.

- [ ] **Step 3: Implement both helpers**

In `AppModel.js`, after `movedRecords`, add:

```js
// Move the entry at `index` to `target`, clamped. Returns a new array. Used by
// drag, where the drop position is an absolute slot rather than a step.
function reorderedRecords(records, index, target) {
  var all = toArray(records).slice()
  if (index < 0 || index >= all.length) return all
  var to = target < 0 ? 0 : (target > all.length - 1 ? all.length - 1 : target)
  if (to === index) return all
  var moved = all.splice(index, 1)[0]
  all.splice(to, 0, moved)
  return all
}

// Insert a new pin at `index`, clamped. Declines a record that is already
// pinned, or one with nothing to launch or match, so the caller can hand over
// whatever the drag produced without pre-checking it.
function insertRecordAt(records, record, index) {
  var all = toArray(records).slice()
  if (!record) return all
  if (!record.desktopId && !record.match && !record.exec) return all
  if (record.desktopId && hasDesktopId(all, record.desktopId)) return all
  var to = index < 0 ? 0 : (index > all.length ? all.length : index)
  all.splice(to, 0, record)
  return all
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add the drag state to `BarWidget.qml`**

The widget owns the drag, because only it can see every slot. This mirrors the host bar's own module drag (`plugins/bar/Bar.qml:1902`), including the deliberate absence of `drag.target`: the slots are positioner children, and moving them leaves stale offsets.

```qml
  // --------------------------------------------------------------- dragging

  // The record being dragged, its index in the pinned list (-1 for a running
  // app), and the pinned slot it would land in. dropIndex is -1 when the
  // pointer is not over the pinned strip, which is what makes a drag to
  // nowhere a no-op.
  property string dragKey: ""
  property int dragIndex: -1
  property int dropIndex: -1
  readonly property bool dragActive: root.dragKey !== ""

  function beginDrag(record, index) {
    if (!record) return
    root.closeMenu()
    root.dragKey = record.key
    root.dragIndex = index
    root.dropIndex = index
  }

  // Which pinned slot the pointer is over, as an insertion index. Hit-tests the
  // pinned repeater's items: a drag is rare, so walking a handful of slots per
  // move is cheaper than maintaining a geometry cache.
  function dropIndexAtScene(scenePoint) {
    var count = pinnedRepeater.count
    for (var i = 0; i < count; i++) {
      var item = pinnedRepeater.itemAt(i)
      if (!item) continue
      var local = item.mapFromItem(null, scenePoint.x, scenePoint.y)
      var insideAcross = root.vertical
        ? (local.x >= 0 && local.x <= item.width)
        : (local.y >= 0 && local.y <= item.height)
      if (!insideAcross) continue
      var along = root.vertical ? local.y : local.x
      var extent = root.vertical ? item.height : item.width
      if (along < 0 || along > extent) continue
      // Past the midpoint means "after this slot".
      return along > extent / 2 ? i + 1 : i
    }
    return -1
  }

  function updateDrag(scenePoint) {
    if (!root.dragActive) return
    root.dropIndex = root.dropIndexAtScene(scenePoint)
  }

  function endDrag() {
    var key = root.dragKey
    var from = root.dragIndex
    var to = root.dropIndex
    root.dragKey = ""
    root.dragIndex = -1
    root.dropIndex = -1
    if (key === "" || to < 0) return

    if (from >= 0) {
      // Reordering an existing pin. An insertion index past the entry's own
      // slot counts one slot too far once the entry is lifted out.
      var target = to > from ? to - 1 : to
      if (target === from) return
      root.mutateApps(function(current) {
        var index = AppModel.indexOfKey(current, key)
        if (index < 0) return null
        return AppModel.reorderedRecords(current, index, target)
      })
      return
    }

    // A running app dropped into the pinned strip.
    root.pinRunningAt(root.recordForKey(key), to)
  }
```

Then add the insertion-aware pin, next to `pinRunning`. It repeats `pinRunning`'s resolution deliberately — the two differ only in where the record lands:

```qml
  // pinRunning, but at a position. Same resolution rules: prefer the resolved
  // desktop entry's id, and keep the window-derived match when the inferred one
  // would not claim the very window that produced the pin.
  function pinRunningAt(record, index) {
    if (!record) return
    var entry = root.desktopEntry(record)
    var stored = null

    if (!entry || !entry.id) {
      stored = { desktopId: record.desktopId, match: record.match }
    } else {
      var id = String(entry.id)
      var match = root.smartMatch(id)
      if (!match && !AppModel.defaultCovers(id, record.desktopId)) match = record.match
      stored = { desktopId: id }
      if (match) stored.match = match
    }

    root.mutateApps(function(current) {
      return AppModel.insertRecordAt(current, stored, index)
    })
  }
```

- [ ] **Step 6: Report pointer gestures from `Slot.qml`**

Add this as the last child of the `WidgetButton` in `Slot.qml`, so it sits above the button's own `MouseArea`. Left button only: right and middle presses fall straight through to the button.

```qml
  // Drag source. Sits over WidgetButton's own MouseArea and only claims the
  // gesture once the pointer has moved past a threshold, so a plain click still
  // launches or focuses. propagateComposedEvents plus mouse.accepted = false in
  // onClicked is what hands an unstarted drag back to the button underneath.
  MouseArea {
    id: dragArea
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton
    propagateComposedEvents: true
    enabled: slot.draggable
    cursorShape: dragging ? Qt.ClosedHandCursor : Qt.ArrowCursor

    property bool dragging: false
    property bool suppressClick: false
    property real pressedX: 0
    property real pressedY: 0
    readonly property real dragThreshold: Style.spaceReal(4)

    onPressed: function(mouse) {
      dragging = false
      suppressClick = false
      pressedX = mouse.x
      pressedY = mouse.y
    }

    onPositionChanged: function(mouse) {
      if (!(mouse.buttons & Qt.LeftButton)) return
      if (!dragging) {
        var distance = Math.abs(mouse.x - pressedX) + Math.abs(mouse.y - pressedY)
        if (distance < dragThreshold) return
        dragging = true
        slot.host.beginDrag(slot.modelData, slot.pinnedIndex)
      }
      slot.host.updateDrag(dragArea.mapToItem(null, mouse.x, mouse.y))
    }

    onReleased: function(mouse) {
      if (!dragging) {
        mouse.accepted = false
        return
      }
      dragging = false
      suppressClick = true
      slot.host.endDrag()
      mouse.accepted = true
    }

    onCanceled: {
      dragging = false
      suppressClick = false
      slot.host.endDrag()
    }

    onClicked: function(mouse) {
      if (suppressClick) {
        suppressClick = false
        mouse.accepted = true
        return
      }
      mouse.accepted = false
    }
  }
```

Add the two properties it reads, next to the other `readonly` ones in `Slot.qml`:

```qml
  // -1 for a running app that is not pinned, which is also what tells the drag
  // it is a pin-by-drag rather than a reorder.
  readonly property int pinnedIndex: modelData.unpinned
    ? -1 : AppModel.indexOfKey(host.pinned, modelData.key)
  readonly property bool draggable: host.pinned.length > 0 || !modelData.unpinned
  // The dragged icon reads as lifted.
  opacity: host.dragActive && host.dragKey === modelData.key ? 0.4 : 1.0
```

- [ ] **Step 7: Draw the drop marker**

In `BarWidget.qml`, inside `GridLayout` is the wrong place for an overlay — positioners own their children's geometry. Put it in the widget root instead, after the `GridLayout`:

```qml
  // Where the dragged icon would land. Positioned from the pinned repeater's
  // own geometry, so it lines up whatever the icon size and gap are.
  Rectangle {
    id: dropMarker
    visible: root.dragActive && root.dropIndex >= 0
    z: 10
    color: Color.popups.border
    width: root.vertical ? Math.round(root.barSize * 0.6) : 2
    height: root.vertical ? 2 : Math.round(root.barSize * 0.6)

    readonly property var edgeItem: {
      if (root.dropIndex < 0) return null
      var count = pinnedRepeater.count
      if (count === 0) return null
      var index = root.dropIndex >= count ? count - 1 : root.dropIndex
      return pinnedRepeater.itemAt(index)
    }
    readonly property bool afterItem: root.dropIndex >= pinnedRepeater.count

    x: {
      if (!edgeItem || root.vertical) return root.vertical ? Math.round((root.width - width) / 2) : 0
      var point = root.mapFromItem(edgeItem, afterItem ? edgeItem.width : 0, 0)
      return Math.round(point.x - width / 2)
    }
    y: {
      if (!edgeItem) return 0
      if (!root.vertical) return Math.round((root.height - height) / 2)
      var point = root.mapFromItem(edgeItem, 0, afterItem ? edgeItem.height : 0)
      return Math.round(point.y - height / 2)
    }
  }
```

- [ ] **Step 8: Verify on the live bar**

Run: `omarchy-shell shell rescanPlugins`

1. Click a pinned icon normally. Expected: it launches or focuses. This is the regression that matters most — a broken threshold makes the widget useless.
2. Drag the Steam icon past Nautilus and release. Expected: a marker shows the landing edge during the drag, the order changes on release, and `jq '.bar.layout.left[] | select(.id == "io.github.joeyvigil.taskbar") | .apps' ~/.config/omarchy/shell.json` shows the new order.
3. `omarchy restart shell`. Expected: the new order survives.
4. Drag a pinned icon and release outside the bar. Expected: nothing changes.
5. Drag a running icon (for example OBS) onto the pinned strip between two pins. Expected: it becomes a pin at that position, its running indicator still lights, and the config shows it.
6. Drag a running icon and drop it over the running group. Expected: nothing changes.
7. Right-click and middle-click a pinned icon. Expected: menu and new instance still work.

- [ ] **Step 9: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add AppModel.js BarWidget.qml Slot.qml tests
git commit -m "feat: drag to reorder pins and to pin a running app"
```

---

### Task 8: Attention flash

**Files:**
- Modify: `BarWidget.qml` (urgent address set, Hyprland event handling)
- Modify: `Slot.qml` (flash animation)
- Modify: `manifest.json` (`defaults` and `schema`)

**Interfaces:**
- Consumes: `Slot` from Task 4, the existing `Connections { target: Hyprland }` block.
- Produces: `root.attentionFlash` (bool setting, default true), `root.urgentAddresses` (plain object used as a set), `function markUrgent(address)`, `function clearUrgent(address)`, and on `Slot` a `readonly property bool urgent`.

- [ ] **Step 1: Track urgent windows in `BarWidget.qml`**

Hyprland emits `urgent>>address` when a client asks for attention through xdg-activation. The address stays urgent until that window becomes active or disappears.

```qml
  readonly property bool attentionFlash: root.setting("attentionFlash", true) === true

  // Addresses Hyprland reported as urgent, used as a set. A plain object rather
  // than a list: membership is what every slot asks about.
  property var urgentAddresses: ({})

  function markUrgent(address) {
    var key = String(address || "")
    if (!key || !root.attentionFlash) return
    if (key === root.activeAddress) return
    if (root.urgentAddresses[key] === true) return
    var next = {}
    for (var existing in root.urgentAddresses) next[existing] = true
    next[key] = true
    root.urgentAddresses = next
  }

  function clearUrgent(address) {
    var key = String(address || "")
    if (!key || root.urgentAddresses[key] !== true) return
    var next = {}
    for (var existing in root.urgentAddresses) {
      if (existing !== key) next[existing] = true
    }
    root.urgentAddresses = next
  }

  // Focusing a window is the acknowledgement, so the flash stops there.
  onActiveAddressChanged: root.clearUrgent(root.activeAddress)
```

Extend the existing `Connections` block on `Hyprland`:

```qml
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event.name || "")
      // openwindow, closewindow, movewindow, windowtitle, activewindow[v2].
      if (name.indexOf("window") !== -1) root.windowSerial++

      // urgent>>address — a client asking for attention. Hyprland reports the
      // address bare here, the same form Quickshell uses for toplevels.
      if (name === "urgent") root.markUrgent(String(event.data || "").trim())
      if (name === "closewindow") root.clearUrgent(String(event.data || "").trim())
    }
  }
```

Note for whoever implements this: verify the event name and payload shape before trusting them. Run `hyprctl -j clients` for addresses, then watch the socket:
`socat -U - UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock` and trigger a flash (see Step 4). If the payload is prefixed (`0x…`) while `Quickshell`'s toplevel addresses are bare, normalise both with `.replace(/^0x/, "")` before comparing.

- [ ] **Step 2: Flash the icon in `Slot.qml`**

```qml
  // Any of this app's windows asking for attention.
  readonly property bool urgent: {
    if (!host.attentionFlash) return false
    for (var i = 0; i < matched.length; i++) {
      if (host.urgentAddresses[matched[i].address] === true) return true
    }
    return false
  }

  readonly property color urgentColor: host.bar ? host.bar.urgent : Color.urgent
```

Add the overlay and its animation as children of the button, and tie the indicator's colour to the same state. The pulse is finite and then holds, so a background app asking for attention does not animate forever:

```qml
  // Pulses three times, then holds the tint until the window is focused.
  Rectangle {
    id: attention
    anchors.fill: parent
    radius: Math.max(2, Style.cornerRadius)
    color: slot.urgentColor
    opacity: 0
    visible: opacity > 0

    SequentialAnimation {
      id: attentionPulse
      running: slot.urgent
      loops: 3
      NumberAnimation { target: attention; property: "opacity"; to: 0.45; duration: 260; easing.type: Easing.OutCubic }
      NumberAnimation { target: attention; property: "opacity"; to: 0.12; duration: 260; easing.type: Easing.InCubic }
      onStopped: attention.opacity = slot.urgent ? 0.18 : 0
    }
  }
```

In the `indicator` `Rectangle`, change the colour binding:

```qml
    color: slot.urgent ? slot.urgentColor : (slot.focused ? slot.activeColor : slot.foreground)
```

The icon `Image` and the letter `Text` must stay above the overlay: they are declared before it, so add `z: 1` to both, or declare `attention` first. Pick one and keep it consistent.

- [ ] **Step 3: Declare the setting**

In `manifest.json`, add to `barWidget.defaults`:

```json
      "attentionFlash": true,
```

and to `barWidget.schema`:

```json
      {
        "key": "attentionFlash",
        "type": "bool",
        "label": "Flash icons for windows that ask for attention"
      },
```

- [ ] **Step 4: Verify on the live bar**

Run: `omarchy restart shell` (settings change).

Trigger an activation request. A single-instance GTK app asks for activation
when it is launched again while already open, which is the cheapest reliable
trigger here:

1. Open Nautilus (it is pinned on this system).
2. Switch to another workspace, so its window is not focused.
3. Run `gtk-launch org.gnome.Nautilus`.

Expected:
1. The Nautilus icon pulses three times in the theme's urgent colour, then
   holds a faint tint, and its running indicator takes the same colour.
2. Clicking the icon, or focusing the window any other way, clears the tint
   immediately.
3. Closing the window while it is urgent clears the state — no stuck tint when
   the app is reopened.
4. With `"attentionFlash": false` and a cold start: nothing flashes.

If nothing flashes, confirm what the compositor actually emitted before
changing the QML: watch the socket with
`socat -U - UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`
while repeating the trigger. If no `urgent` line appears at all, the client
never requested activation — say so in the commit message rather than claiming
the flash was seen, and leave the code path verified by the socket trace alone.

- [ ] **Step 5: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add BarWidget.qml Slot.qml manifest.json
git commit -m "feat: flash icons for windows that ask for attention"
```

---

### Task 9: Document the reworked widget

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `manifest.json` (`version`)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Update `README.md`**

Cover, in the existing voice and structure:
- Left click launches or focuses and cycles windows; middle click opens a new instance; right click opens a context menu at the icon listing the app's windows and its actions.
- Running apps that are not pinned appear after the pinned ones in the order they were opened, and a separator divides the two groups (`showSeparator`).
- Drag a pinned icon to reorder it; drag a running icon into the pinned strip to pin it there.
- Icons flash in the theme's urgent colour when a window asks for attention (`attentionFlash`), and only clients that actually request activation can trigger it — a bare `notify-send` cannot.
- The two new settings, in the same table format the README already uses for the others.
- A note that grouping is per window class, so several TUIs launched with the same `--app-id` (for example `--app-id=TUI.tile`) share one icon and resolve to one desktop entry; give per-app ids such as `--app-id=org.omarchy.btop`, which is what `omarchy-launch-tui` does by default.

- [ ] **Step 2: Update `docs/development.md`**

Add short notes for the new seams:
- `AppModel.js` is unit-tested with `npm test` (`node --test tests/`); the loader strips `.pragma library` and appends exports, so a new pure function must be added to `EXPORTED` in `tests/helpers/load-app-model.mjs` to be testable.
- The menu is a `PopupCard` from `qs.Ui`, the host component the tray uses; the plugin bar facade exposes exactly the `requestPopout` / `releasePopout` / `activePopout` / `position` it needs.
- The drag deliberately sets no `drag.target`, because slots are positioner children; the drop marker is drawn in the widget root instead, and the same reasoning is written down in the host bar at `plugins/bar/Bar.qml:1917`.
- Running-app order lives in memory (`seenAt`) and is reseeded from the compositor's list after a shell restart.

- [ ] **Step 3: Bump the version**

In `manifest.json`, set `"version": "0.5.0"`.

- [ ] **Step 4: Verify the docs match the code**

Read `README.md` against `manifest.json`'s `schema`: every setting documented, every documented setting present, defaults agreeing. Run `npm test` once more and `omarchy restart shell`, then walk the full manual list: anchored menu, window rows, open order, btop's icon, separator, drag both ways, flash.

- [ ] **Step 5: Commit**

```bash
cd /home/ks/Projects/newtaskbar
git add README.md docs/development.md manifest.json
git commit -m "docs: describe the context menu, ordering, separator, drag and flash"
```
