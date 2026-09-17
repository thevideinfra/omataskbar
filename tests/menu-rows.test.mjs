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
