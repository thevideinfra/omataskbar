import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

test("real booleans pass through", () => {
  assert.equal(AppModel.toBool(true, false), true)
  assert.equal(AppModel.toBool(false, true), false)
})

test("the strings `omarchy bar set` stores are coerced", () => {
  assert.equal(AppModel.toBool("true", false), true)
  assert.equal(AppModel.toBool("false", true), false)
})

test("anything else yields the fallback", () => {
  for (const value of [undefined, null, "", "yes", "False", 1, 0, {}, []]) {
    assert.equal(AppModel.toBool(value, true), true, `value ${JSON.stringify(value)}`)
    assert.equal(AppModel.toBool(value, false), false, `value ${JSON.stringify(value)}`)
  }
})
