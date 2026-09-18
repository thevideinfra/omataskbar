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
  "groupUnpinned",
  "anyMatchTitle",
  "windowFingerprint",
  "sameKeys",
  "nextWindowIndex",
  "plausibleWindowClass",
  "execAppIdIndex",
  "indexOfKey",
  "hasDesktopId",
  "movedRecords",
  "serialize",
  "menuRows",
  "closeCommand",
  "menuStructureKey",
  "menuTitles",
  "toBool"
]

export async function loadAppModel() {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = await readFile(join(here, "..", "..", "AppModel.js"), "utf8")
  const body = source.replace(/^\s*\.pragma\s+library\s*$/m, "")
  const module = `${body}\nexport { ${EXPORTED.join(", ")} }\n`
  return import(`data:text/javascript;base64,${Buffer.from(module).toString("base64")}`)
}
