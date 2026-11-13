// The 3x10 red LED half court behind smoked plastic, with the basket just
// past the right edge of the middle lane. Unlit LEDs stay faintly visible
// like the real thing; the rim has its own LED that lights on a make.
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes

Rectangle {
  id: field

  property var leds: []
  property int hoop: 0          // 2 = net lit (made), 1 = rim flicker (miss)
  property bool ballAtRim: false
  property real cell: 46
  readonly property int cols: 10
  readonly property int lanes: 3

  implicitWidth: cols * cell + cell * 1.4      // room for the hoop on the right
  implicitHeight: lanes * cell + cell * 0.5
  radius: cell * 0.12
  color: "#120403"
  border.width: 2
  border.color: "#2a0d0a"

  readonly property real ox: cell * 0.25
  readonly property real oy: cell * 0.25

  // Painted court markings (silkscreen on the smoked plastic): the key in
  // front of the basket, the 3-point arc, and the backboard and rim.
  readonly property color paint: "#4a1712"
  readonly property real bx: ox + 10.25 * cell     // basket center (Logic.BASKET_X/Y)
  readonly property real by: oy + 1.5 * cell

  // The key (free-throw lane), shaded and outlined.
  Rectangle {
    x: field.ox + 7.0 * field.cell
    y: field.oy + 0.82 * field.cell
    width: field.bx - x
    height: 1.36 * field.cell
    color: "#1c0705"
    border.width: 2
    border.color: field.paint
  }

  // 3-point arc: radius 4.6 cells around the basket, meeting both sidelines.
  readonly property real arcR: 4.6 * cell
  readonly property real arcDx: Math.sqrt(arcR * arcR - (by - oy) * (by - oy))
  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    ShapePath {
      strokeColor: field.paint
      strokeWidth: 2
      fillColor: "transparent"
      startX: field.bx - field.arcDx; startY: field.oy
      PathArc {
        x: field.bx - field.arcDx
        y: field.oy + 3 * field.cell
        radiusX: field.arcR; radiusY: field.arcR
        direction: PathArc.Counterclockwise
      }
    }
  }

  // Backboard.
  Rectangle {
    x: field.bx + field.cell * 0.36
    y: field.by - field.cell * 0.55
    width: 3
    height: field.cell * 1.1
    color: "#6a2219"
  }
  // Unlit LED segments: always faintly visible behind the smoked plastic.
  Repeater {
    model: field.cols * field.lanes
    Rectangle {
      readonly property int level: field.leds.length > index ? field.leds[index] : 0
      visible: level === 0
      x: field.ox + (index % field.cols) * field.cell + (field.cell - width) / 2
      y: field.oy + Math.floor(index / field.cols) * field.cell + (field.cell - height) / 2
      width: field.cell * 0.66
      height: field.cell * 0.3
      radius: height / 2
      color: "#3a0c09"
    }
  }

  // The rim, unlit: a ring around the basket.
  Rectangle {
    x: field.bx - width / 2
    y: field.by - height / 2
    width: field.cell * 0.56; height: width; radius: width / 2
    color: "transparent"
    border.width: 3
    border.color: "#3a0c09"
  }

  // The glow: blurred copies of the lit layer drawn underneath it, a wide
  // soft bloom plus a tighter halo. The blur keeps each LED's own color, so
  // the bright ball carrier blooms more than the dimmer defenders.
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 64
    blur: 1.0
    blurMultiplier: 0.6
    brightness: 0.5
    saturation: 0.3
  }
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 20
    blur: 0.9
    brightness: 0.3
  }

  // Lit LEDs, rendered into their own layer so the glow can sample them.
  // The layer has a fixed margin for the glow to spread into, so the blurred
  // copies and the crisp LEDs share exactly the same geometry.
  readonly property real glowPad: cell * 1.4
  Item {
    id: lit
    x: -field.glowPad
    y: -field.glowPad
    width: field.width + field.glowPad * 2
    height: field.height + field.glowPad * 2
    layer.enabled: true

    // The rim LED: a lit ring for a make (bright) or a miss (a quick dim
    // flicker), and the ball itself as it drops in.
    Rectangle {
      visible: field.hoop > 0 || field.ballAtRim
      x: field.glowPad + field.bx - width / 2
      y: field.glowPad + field.by - height / 2
      width: field.cell * 0.56; height: width; radius: width / 2
      color: field.hoop === 2 ? "#ff4a30" : "transparent"
      border.width: 3
      border.color: field.hoop === 2 ? "#ffb19e" : "#d42412"
      Rectangle {
        visible: field.ballAtRim
        anchors.centerIn: parent
        width: field.cell * 0.3; height: width; radius: width / 2
        color: "#ff4a30"
        border.width: 2
        border.color: "#ffb19e"
      }
    }

    Repeater {
      model: field.cols * field.lanes
      Item {
        readonly property int level: field.leds.length > index ? field.leds[index] : 0
        visible: level > 0
        x: field.glowPad + field.ox + (index % field.cols) * field.cell
        y: field.glowPad + field.oy + Math.floor(index / field.cols) * field.cell
        width: field.cell
        height: field.cell

        // Players are horizontal pill-shaped LED segments with rounded ends;
        // the ball in flight stays a small round dot so it reads differently.
        readonly property bool isBall: level === 4

        Rectangle {
          anchors.centerIn: parent
          width: isBall ? field.cell * 0.34 : field.cell * 0.66
          height: isBall ? width : field.cell * 0.3
          radius: height / 2
          color: level === 1 ? "#d42412"
               : level === 2 ? "#f0341e"
               : "#ff4a30"
          border.width: level >= 3 ? 2 : 0
          border.color: "#ffb19e"
          // A small specular highlight so lit LEDs read as domes, not flat.
          Rectangle {
            x: parent.width * (isBall ? 0.22 : 0.16); y: parent.height * 0.18
            width: parent.width * (isBall ? 0.26 : 0.3)
            height: isBall ? width : parent.height * 0.26
            radius: height / 2
            color: "#ffffff"
            opacity: level >= 3 ? 0.55 : 0.25
          }
        }
      }
    }
  }
}
