import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

const [pin] = AppModel.normalizeApps(["foot"])

function rowsFor(windows, active) {
  return AppModel.menuRows(pin, windows, active, 0, 2, false, "Foot")
}

const base = [
  { address: "a", title: "⠋ claude" },
  { address: "b", title: "btop" }
]

test("a title-only change leaves the structure key equal", () => {
  const before = rowsFor(base, "b")
  const after = rowsFor([{ address: "a", title: "⠙ claude" }, base[1]], "b")
  assert.notDeepEqual(before, after)
  assert.equal(AppModel.menuStructureKey(after), AppModel.menuStructureKey(before))
})

test("a title going empty (label falls back to the app name) is still title-only", () => {
  const before = rowsFor(base, "b")
  const after = rowsFor([{ address: "a", title: "" }, base[1]], "b")
  assert.equal(AppModel.menuStructureKey(after), AppModel.menuStructureKey(before))
})

test("opening a window changes the structure key", () => {
  const before = rowsFor(base, "b")
  const after = rowsFor(base.concat([{ address: "c", title: "new" }]), "b")
  assert.notEqual(AppModel.menuStructureKey(after), AppModel.menuStructureKey(before))
})

test("closing a window changes the structure key", () => {
  const before = rowsFor(base, "b")
  const after = rowsFor([base[0]], "b")
  assert.notEqual(AppModel.menuStructureKey(after), AppModel.menuStructureKey(before))
})

test("moving focus between the app's windows changes the structure key", () => {
  assert.notEqual(
    AppModel.menuStructureKey(rowsFor(base, "a")),
    AppModel.menuStructureKey(rowsFor(base, "b")))
})

test("non-window labels are part of the structure", () => {
  const horizontal = AppModel.menuRows(pin, base, "b", 1, 3, false, "Foot")
  const vertical = AppModel.menuRows(pin, base, "b", 1, 3, true, "Foot")
  assert.notEqual(AppModel.menuStructureKey(horizontal), AppModel.menuStructureKey(vertical))

  const renamed = AppModel.menuRows(pin, base, "b", 1, 3, false, "Terminal")
  assert.notEqual(AppModel.menuStructureKey(horizontal), AppModel.menuStructureKey(renamed))
})

test("the structure key does not mutate the rows it reads", () => {
  const rows = rowsFor(base, "b")
  const copy = JSON.parse(JSON.stringify(rows))
  AppModel.menuStructureKey(rows)
  assert.deepEqual(rows, copy)
})

test("an empty or missing row list has a stable key", () => {
  assert.equal(AppModel.menuStructureKey([]), AppModel.menuStructureKey(null))
})

test("menuTitles maps each window address to its title", () => {
  assert.deepEqual(AppModel.menuTitles(rowsFor(base, "b")), { a: "⠋ claude", b: "btop" })
})

test("menuTitles falls back to the app label for an untitled window", () => {
  assert.deepEqual(AppModel.menuTitles(rowsFor([{ address: "a", title: "" }], "")), { a: "Foot" })
})

test("menuTitles is empty when there are no window rows", () => {
  assert.deepEqual(AppModel.menuTitles(rowsFor([], "")), {})
  assert.deepEqual(AppModel.menuTitles(null), {})
})
