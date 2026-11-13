// One red 7-segment LED digit, drawn from rectangles with a slight italic
// slant. `ch` is a single character from the table below; unknown ones blank.
import QtQuick

Item {
  id: digit

  property string ch: " "
  property real unit: 4                 // segment thickness
  property color onColor: "#ff3b24"
  property color offColor: "#2e0a08"
  property bool dot: false

  implicitWidth: unit * 6.5
  implicitHeight: unit * 11

  //           a  b  c  d  e  f  g
  readonly property var table: ({
    " ": "0000000", "-": "0000001", "_": "0001000",
    "0": "1111110", "1": "0110000", "2": "1101101", "3": "1111001", "4": "0110011",
    "5": "1011011", "6": "1011111", "7": "1110000", "8": "1111111", "9": "1111011",
    "A": "1110111", "b": "0011111", "C": "1001110", "c": "0001101", "d": "0111101",
    "E": "1001111", "F": "1000111", "G": "1011110", "H": "0110111", "h": "0010111",
    "I": "0000110", "i": "0010000", "J": "0111100", "L": "0001110", "n": "0010101",
    "N": "1110110", "o": "0011101", "O": "1111110", "P": "1100111", "r": "0000101",
    "S": "1011011", "t": "0001111", "U": "0111110", "u": "0011100", "y": "0111011"
  })
  readonly property string bits: table[ch] !== undefined ? table[ch] : "0000000"
  function on(i) { return bits.charAt(i) === "1" }

  readonly property real w: width - unit * 1.2
  readonly property real h: height
  readonly property real gap: unit * 0.18

  transform: Matrix4x4 {
    // Shear x by -0.09*y around the vertical center: the classic slanted LED.
    matrix: Qt.matrix4x4(1, -0.09, 0, 0.09 * digit.height / 2,
                         0, 1, 0, 0,
                         0, 0, 1, 0,
                         0, 0, 0, 1)
  }

  component Seg: Rectangle {
    property bool lit: false
    radius: digit.unit / 2
    color: lit ? digit.onColor : digit.offColor
  }

  // a (top), g (middle), d (bottom)
  Seg { lit: digit.on(0); x: digit.unit + digit.gap; y: 0; width: digit.w - digit.unit * 2 - digit.gap * 2; height: digit.unit }
  Seg { lit: digit.on(6); x: digit.unit + digit.gap; y: (digit.h - digit.unit) / 2; width: digit.w - digit.unit * 2 - digit.gap * 2; height: digit.unit }
  Seg { lit: digit.on(3); x: digit.unit + digit.gap; y: digit.h - digit.unit; width: digit.w - digit.unit * 2 - digit.gap * 2; height: digit.unit }
  // f (upper left), b (upper right)
  Seg { lit: digit.on(5); x: 0; y: digit.unit / 2 + digit.gap; width: digit.unit; height: digit.h / 2 - digit.unit / 2 - digit.gap * 2 }
  Seg { lit: digit.on(1); x: digit.w - digit.unit; y: digit.unit / 2 + digit.gap; width: digit.unit; height: digit.h / 2 - digit.unit / 2 - digit.gap * 2 }
  // e (lower left), c (lower right)
  Seg { lit: digit.on(4); x: 0; y: digit.h / 2 + digit.gap; width: digit.unit; height: digit.h / 2 - digit.unit / 2 - digit.gap * 2 }
  Seg { lit: digit.on(2); x: digit.w - digit.unit; y: digit.h / 2 + digit.gap; width: digit.unit; height: digit.h / 2 - digit.unit / 2 - digit.gap * 2 }
  // decimal point
  Rectangle {
    width: digit.unit; height: digit.unit; radius: digit.unit / 2
    x: digit.width - digit.unit; y: digit.h - digit.unit
    color: digit.dot ? digit.onColor : digit.offColor
  }
}
