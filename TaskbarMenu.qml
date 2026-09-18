import QtQuick
import qs.Commons
import qs.Ui

// The context menu for one taskbar icon.
//
// PopupCard is the host's own anchored card — the tray uses it for exactly this
// — so the menu appears at the icon, flips side with the bar position, and gets
// outside-click dismissal through HyprlandFocusGrab for free.
PopupCard {
  id: menu

  // The widget root, for colors, fonts and the callbacks the rows invoke.
  required property var host
  // Plain row data from AppModel.menuRows.
  property var rows: []

  readonly property color foreground: host.bar ? host.bar.barForeground : Color.foreground
  readonly property string fontFamily: host.bar ? host.bar.fontFamily : Style.font.family
  readonly property int rowHeight: Style.space(30)
  readonly property int separatorHeight: Style.space(11)

  owner: menu
  bar: host.bar
  padding: Style.space(8)
  borderColor: Qt.rgba(menu.foreground.r, menu.foreground.g, menu.foreground.b, 0.45)
  contentWidth: menu.fittedContentWidth(Style.space(232))
  contentHeight: menu.fittedContentHeight(column.implicitHeight, Style.space(420))

  // PopupCard.close() defers to owner.close() when the owner has one, and this
  // component is its own owner, so this override is what the focus grab and the
  // rows both end up calling. It routes through the widget because `open` is
  // bound to host state: assigning `open` directly would break that binding.
  function close() { host.closeMenu() }

  Column {
    id: column
    anchors.fill: parent
    spacing: 0

    Repeater {
      model: menu.rows

      delegate: Item {
        id: row
        required property var modelData

        readonly property bool isSeparator: modelData.kind === "separator"
        readonly property bool isHeader: modelData.kind === "header"
        readonly property bool clickable: modelData.kind === "window" || modelData.kind === "action"
        // Window titles come from host.menuTitles, which updates in place;
        // the row's own label is only the title as of the last rebuild.
        readonly property string displayText: {
          if (modelData.kind !== "window") return String(modelData.label || "")
          var title = menu.host.menuTitles[modelData.address]
          return title !== undefined ? String(title) : String(modelData.label || "")
        }

        width: column.width
        implicitHeight: row.isSeparator ? menu.separatorHeight : menu.rowHeight

        Rectangle {
          visible: row.isSeparator
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.right: parent.right
          anchors.rightMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          height: 1
          color: Color.popups.border
          opacity: 0.45
        }

        Rectangle {
          visible: (rowMouse.containsMouse || closeMouse.containsMouse) && row.clickable
          anchors.fill: parent
          radius: Math.max(2, Style.cornerRadius)
          color: Style.hoverFillFor(menu.foreground, menu.foreground)
        }

        // The focused window's marker. Kept out of the label so titles stay
        // aligned whether or not a window is focused.
        Text {
          visible: row.modelData.kind === "window"
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          width: Style.space(22)
          horizontalAlignment: Text.AlignHCenter
          text: row.modelData.active ? "•" : ""
          color: menu.foreground
          font.family: menu.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          visible: !row.isSeparator
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          anchors.leftMargin: row.modelData.kind === "window" ? Style.space(28) : Style.space(10)
          anchors.right: parent.right
          anchors.rightMargin: row.modelData.kind === "window" ? Style.space(30) : Style.space(10)
          text: row.displayText
          color: menu.foreground
          opacity: row.isHeader ? 0.6 : 1.0
          font.family: menu.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.bold: row.isHeader
          elide: Text.ElideRight
        }

        MouseArea {
          id: rowMouse
          anchors.fill: parent
          hoverEnabled: row.clickable
          enabled: row.clickable
          cursorShape: Qt.PointingHandCursor
          onClicked: {
            if (row.modelData.kind === "window") host.focusAddress(row.modelData.address)
            else host.runAction(host.menuRecord ? host.menuRecord.key : "", row.modelData.action)
            host.closeMenu()
          }
        }

        // Closes just this window. Declared after rowMouse so it sits on top
        // and takes the click; shown while the row is hovered.
        Text {
          visible: row.modelData.kind === "window" && (rowMouse.containsMouse || closeMouse.containsMouse)
          anchors.verticalCenter: parent.verticalCenter
          anchors.right: parent.right
          anchors.rightMargin: Style.space(8)
          text: "✕"
          color: menu.foreground
          opacity: closeMouse.containsMouse ? 1.0 : 0.6
          font.family: menu.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        MouseArea {
          id: closeMouse
          visible: row.modelData.kind === "window"
          anchors.top: parent.top
          anchors.bottom: parent.bottom
          anchors.right: parent.right
          width: Style.space(26)
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: {
            host.closeAddress(row.modelData.address)
            host.closeMenu()
          }
        }
      }
    }
  }
}
