import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

test("refuses anything that is not a hex address", () => {
  for (const bad of ["", null, undefined, "nothex", "0x", "12 34", "0x12; rm -rf ~", "5cf3$(id)"]) {
    assert.equal(AppModel.closeCommand(bad), "", String(bad))
  }
})

test("guards on the normalised 0x address, bare or prefixed, any case", () => {
  for (const input of ["5cf37911ce00", "0x5cf37911ce00", "0X5CF37911CE00"]) {
    const command = AppModel.closeCommand(input)
    assert.match(command, /hyprctl -j activewindow/)
    assert.ok(command.includes('= "0x5cf37911ce00" ]'), command)
  }
})

test("never passes arguments to the Lua close dispatcher", () => {
  const command = AppModel.closeCommand("abc123")
  assert.ok(command.includes("hyprctl dispatch 'hl.dsp.window.close()'"), command)
  assert.doesNotMatch(command, /window\.close\(\s*[^)\s]/)
})

test("the legacy fallback names its target and only runs inside the guard", () => {
  const command = AppModel.closeCommand("abc123")
  assert.ok(command.includes("closewindow address:0xabc123"), command)
  assert.ok(command.startsWith("if [ "), command)
  assert.ok(command.trimEnd().endsWith("fi"), command)
})
