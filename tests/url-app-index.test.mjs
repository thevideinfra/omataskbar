import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAppModel } from "./helpers/load-app-model.mjs"

const AppModel = await loadAppModel()

test("urlAppKey reads the host out of an omarchy webapp launcher", () => {
  assert.equal(
    AppModel.urlAppKey('omarchy-launch-webapp "https://messages.google.com/"'),
    "messages.google.com")
  assert.equal(
    AppModel.urlAppKey("omarchy-launch-webapp https://app.slack.com/client/T1"),
    "app.slack.com__client")
})

test("urlAppKey reads a plain --app= browser entry too", () => {
  assert.equal(
    AppModel.urlAppKey("/usr/bin/brave --app=https://discord.com/channels/@me"),
    "discord.com__channels")
  assert.equal(AppModel.urlAppKey('brave --app="https://x.com/"'), "x.com")
})

test("urlAppKey lowercases the key and ignores entries that launch no URL", () => {
  assert.equal(AppModel.urlAppKey('omarchy-launch-webapp "https://Messages.Google.com/"'),
    "messages.google.com")
  assert.equal(AppModel.urlAppKey("gimp -n"), "")
  assert.equal(AppModel.urlAppKey("xdg-terminal-exec --app-id=TUI.tile -e btop"), "")
  assert.equal(AppModel.urlAppKey(""), "")
  assert.equal(AppModel.urlAppKey(null), "")
})

test("urlAppIndex maps each key to an entry id, first entry winning", () => {
  const index = AppModel.urlAppIndex([
    { id: "messages", exec: 'omarchy-launch-webapp "https://messages.google.com/"' },
    { id: "messages-copy", exec: 'omarchy-launch-webapp "https://messages.google.com/"' },
    { id: "discord", exec: "brave --app=https://discord.com/channels/@me" },
    { id: "plain", exec: "gimp -n" },
    { id: "", exec: 'omarchy-launch-webapp "https://ghost.example/"' },
    null
  ])
  assert.deepEqual(index, {
    "messages.google.com": "messages",
    "discord.com__channels": "discord"
  })
})

test("urlEntryFor finds the entry whose key appears in a window class", () => {
  const index = AppModel.urlAppIndex([
    { id: "messages", exec: 'omarchy-launch-webapp "https://messages.google.com/"' },
    { id: "discord", exec: "brave --app=https://discord.com/channels/@me" }
  ])
  assert.equal(
    AppModel.urlEntryFor(index, "brave-messages.google.com__web_conversations-Default"),
    "messages")
  assert.equal(
    AppModel.urlEntryFor(index, "chrome-discord.com__channels_@me-Default"),
    "discord")
  assert.equal(AppModel.urlEntryFor(index, "BRAVE-MESSAGES.GOOGLE.COM__WEB-Default"), "messages")
  assert.equal(AppModel.urlEntryFor(index, "org.gnome.Nautilus"), "")
  assert.equal(AppModel.urlEntryFor(index, ""), "")
  assert.equal(AppModel.urlEntryFor({}, "brave-messages.google.com-Default"), "")
})

test("iconNameFor prefers a stored icon, then the icons map, then the entry's icon", () => {
  const pin = { desktopId: "messages", icon: "chat-symbolic" }
  const running = { desktopId: "brave-messages.google.com__web_conversations-Default" }
  const icons = { "brave-messages.google.com__web_conversations-default": "google-messages" }

  assert.equal(AppModel.iconNameFor(pin, icons, "messages"), "chat-symbolic")
  assert.equal(AppModel.iconNameFor(running, icons, "messages"), "google-messages")
  assert.equal(AppModel.iconNameFor(running, {}, "messages"), "messages")
  assert.equal(AppModel.iconNameFor(running, {}, ""), running.desktopId)
  assert.equal(AppModel.iconNameFor(null, icons, "messages"), "messages")
  assert.equal(AppModel.iconNameFor(null, {}, ""), "")
})

test("iconNameFor accepts an absolute path from the icons map", () => {
  const running = { desktopId: "brave-x.com-Default" }
  const icons = { "brave-x.com-default": "/home/ks/.local/share/icons/x.png" }
  assert.equal(AppModel.iconNameFor(running, icons, "brave"), "/home/ks/.local/share/icons/x.png")
})
