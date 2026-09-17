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
