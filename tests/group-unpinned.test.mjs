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
