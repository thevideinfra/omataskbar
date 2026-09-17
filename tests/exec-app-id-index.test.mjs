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
