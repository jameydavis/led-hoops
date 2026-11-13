// A small keyboard keycap for the key legend.
import QtQuick

Rectangle {
  id: cap
  property string label: ""
  property color ink: "#ff5a42"
  property string fontFamily: ""
  property real unit: 10

  implicitWidth: Math.max(unit * 2.6, keyText.implicitWidth + unit * 1.4)
  implicitHeight: unit * 2.6
  radius: unit * 0.45
  color: "#1c0907"
  border.width: 1
  border.color: Qt.darker(ink, 1.9)

  Rectangle {
    // Bottom lip so the cap reads as a key, not a box.
    anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 1 }
    height: cap.unit * 0.35
    radius: cap.radius
    color: "#120504"
  }

  Text {
    id: keyText
    anchors.centerIn: parent
    anchors.verticalCenterOffset: -cap.unit * 0.12
    textFormat: Text.PlainText
    text: cap.label
    color: cap.ink
    font.family: cap.fontFamily
    font.pixelSize: cap.unit * 1.1
    font.bold: true
  }
}
