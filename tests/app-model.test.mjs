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
