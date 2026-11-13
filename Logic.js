.pragma library
// LED Hoops rules engine. Pure JS, no QML: BarWidget.qml owns timers and
// rendering and calls in here; test/logic.test.js runs it under node.
//
// The court is a static half court: 10 columns x 3 lanes of LEDs, with the
// basket just past the right edge of the middle lane. Whoever has the ball
// attacks that basket; the HOME / VISITOR lamps say whose ball it is.
//
// Every mutating call may push events onto s.events ({ sound, code, label }):
// the host drains them to play sounds and flash readout messages.

var COLS = 10
var LANES = 3
var QUARTER_SECONDS = 180
var OVERTIME_SECONDS = 60
var SHOT_CLOCK = 24

// The basket, in cell units from the court's top-left corner (cell centers
// sit at c + 0.5, lane + 0.5). Shots from farther than THREE_POINT are threes.
var BASKET_X = 10.25
var BASKET_Y = 1.5
var THREE_POINT = 4.6

// Shot meter: while the shot key is held the meter climbs 0..4 and falls
// back; releasing on 4 is a perfect release.
var METER_STEPS = [0, 1, 2, 3, 4, 3, 2, 1]

// Mutable so tests can make plays deterministic.
var random = Math.random

function rint(lo, hi) { return lo + Math.floor(random() * (hi - lo + 1)) }
function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0 }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function other(team) { return team === 0 ? 1 : 0 }

function emit(s, sound, code, label) {
  s.events.push({ sound: sound || "", code: code || "", label: label || "" })
}

function newGame(pro) {
  var s = {
    pro: pro === 2 ? 2 : 1,
    quarter: 1,
    clock: QUARTER_SECONDS,
    shot: SHOT_CLOCK,
    score: [0, 0],
    poss: 0,
    openingPoss: 0,
    phase: "presnap",      // presnap | live | air | dead | gameover
    aiming: false,         // shot key held: the meter is running
    meter: 0,
    carrier: null,
    mate: null,
    defenders: [],
    ball: null,            // { path: [{x,lane}], i, type: "shot"|"pass", ... }
    hoop: 0,               // 2 = net lit (made), 1 = rim flicker (miss); host fades it
    next: null,
    events: []
  }
  setupPossession(s, 0)
  return s
}

// ---------------------------------------------------------------- setups

// Inbound: you bring it up from the left edge, your teammate is out on a
// wing, two defenders pick you up at the top of the key and one stays home.
function setupPossession(s, team) {
  s.poss = team
  s.phase = "presnap"
  s.aiming = false
  s.meter = 0
  s.ball = null
  s.shot = SHOT_CLOCK
  s.carrier = { x: 0, lane: 1 }
  s.mate = { x: 2, lane: random() < 0.5 ? 0 : 2 }
  s.defenders = [{ x: 5, lane: 0 }, { x: 5, lane: 2 }, { x: 8, lane: 1 }]
}

// ---------------------------------------------------------------- queries

function defenderAt(s, x, lane) {
  for (var i = 0; i < s.defenders.length; i++)
    if (s.defenders[i].x === x && s.defenders[i].lane === lane) return i
  return -1
}

function occupied(s, x, lane) {
  if (defenderAt(s, x, lane) >= 0) return true
  if (s.carrier && s.carrier.x === x && s.carrier.lane === lane) return true
  if (s.mate && s.mate.x === x && s.mate.lane === lane) return true
  return false
}

function onCourt(x, lane) { return x >= 0 && x < COLS && lane >= 0 && lane < LANES }

// Distance from a cell to the basket, in cells.
function distance(x, lane) {
  return Math.sqrt(Math.pow(BASKET_X - (x + 0.5), 2) + Math.pow(BASKET_Y - (lane + 0.5), 2))
}

function shotValue(s) { return s.carrier && distance(s.carrier.x, s.carrier.lane) > THREE_POINT ? 3 : 2 }

function meterLevel(s) { return METER_STEPS[s.meter % METER_STEPS.length] }

// Chance a shot from (x, lane) goes in before timing and defense.
function baseChance(x, lane) {
  var d = distance(x, lane)
  if (d <= 1.3) return 0.72         // layup
  if (d <= 3.0) return 0.55         // in the paint
  if (d <= THREE_POINT) return 0.45 // mid-range
  return Math.max(0.12, 0.4 - (d - THREE_POINT) * 0.07)
}

// Release timing is the biggest factor: a perfect release beats a sloppy one
// by about four to one.
function timingFactor(level) { return [0.25, 0.35, 0.6, 0.95, 1.25][level] }

function contested(s) {
  var c = s.carrier
  return s.defenders.some(function(df) { return Math.abs(df.x - c.x) <= 1 && Math.abs(df.lane - c.lane) <= 1 })
}

// A defender standing right between the shooter and the rim can block it:
// the next cell toward the basket (straight ahead, or diagonally toward the
// middle lane).
function blocker(s) {
  var c = s.carrier
  var towardLane = c.lane + sign(1 - c.lane)
  return defenderAt(s, c.x + 1, c.lane) >= 0 || (towardLane !== c.lane && defenderAt(s, c.x + 1, towardLane) >= 0)
}

function shotChance(s, level) {
  var c = s.carrier
  var p = baseChance(c.x, c.lane) * timingFactor(level)
  if (contested(s)) p *= 0.7
  return clamp(p, 0.03, 0.93)
}

// Straight path between two cells, one cell per step (endpoint included).
function line(ax, al, bx, bl) {
  var n = Math.max(Math.abs(bx - ax), Math.abs(bl - al))
  var path = []
  for (var i = 1; i <= n; i++)
    path.push({ x: ax + Math.round((bx - ax) * i / n), lane: al + Math.round((bl - al) * i / n) })
  return path
}

function passLaneOpen(s) {
  if (!s.carrier || !s.mate) return false
  return !line(s.carrier.x, s.carrier.lane, s.mate.x, s.mate.lane)
    .some(function(cell) { return defenderAt(s, cell.x, cell.lane) >= 0 })
}

// ---------------------------------------------------------------- actions

function startPlay(s) {
  if (s.phase !== "presnap") return false
  s.phase = "live"
  emit(s, "inbound")
  return true
}

// dx is +1 toward the basket / -1 away, dl is lane (-1 up / +1 down).
function move(s, dx, dl) {
  if (s.phase === "presnap") startPlay(s)
  if (s.phase !== "live" || s.aiming) return
  var c = s.carrier
  var nx = c.x + dx, nl = c.lane + dl
  if (!onCourt(nx, nl)) return
  if (occupied(s, nx, nl)) { emit(s, "bump"); return }
  c.x = nx
  c.lane = nl
  emit(s, "dribble")
}

// Shot key pressed: rise up and start the meter.
function startShot(s) {
  if (s.phase === "presnap") startPlay(s)
  if (s.phase !== "live" || s.aiming) return false
  s.aiming = true
  s.meter = 0
  emit(s, "blip", "", shotValue(s) === 3 ? "THREE POINTER - RELEASE AT THE TOP" : "SHOOTING - RELEASE AT THE TOP")
  return true
}

function meterTick(s) {
  if (s.phase === "live" && s.aiming) s.meter = (s.meter + 1) % METER_STEPS.length
}

// Shot key released: the ball is away (or blocked).
function release(s) {
  if (s.phase !== "live" || !s.aiming) return false
  s.aiming = false
  var level = meterLevel(s)
  var c = s.carrier
  var pts = shotValue(s)
  if (blocker(s) && random() < 0.35) {
    emit(s, "block", "BLK", "BLOCKED")
    turnover(s)
    return true
  }
  var made = random() < shotChance(s, level)
  // The ball arcs cell by cell to the rim, past the right edge of the court.
  var path = line(c.x, c.lane, COLS, 1)
  s.ball = { path: path, i: -1, type: "shot", made: made, pts: pts, perfect: level === 4 }
  s.phase = "air"
  emit(s, "shoot", "", level === 4 ? "PERFECT RELEASE" : level === 3 ? "GOOD RELEASE" : "EARLY OR LATE")
  return true
}

// Pass to the teammate. A defender anywhere in the passing lane steals it.
function pass(s) {
  if (s.phase === "presnap") startPlay(s)
  if (s.phase !== "live" || s.aiming || !s.mate) return false
  var path = line(s.carrier.x, s.carrier.lane, s.mate.x, s.mate.lane)
  s.ball = { path: path, i: -1, type: "pass" }
  s.phase = "air"
  emit(s, "pass")
  return true
}

// ---------------------------------------------------------------- ticks

// Defense: whoever is closest to the ball guards it, the next guards the
// teammate, and the last protects the rim. Stepping onto the ball handler is
// a steal attempt. Pro 1 defenders are slower and reach in less well.
function defenseTick(s) {
  if (s.phase !== "live") return
  var pro1 = s.pro !== 2
  var c = s.carrier, m = s.mate
  var order = s.defenders.map(function(_, i) { return i })
  order.sort(function(a, b) { return dist(s.defenders[a], c) - dist(s.defenders[b], c) })
  var targets = {}
  targets[order[0]] = c
  if (order.length > 1 && m) targets[order[1]] = { x: Math.min(COLS - 1, m.x + 1), lane: m.lane }
  if (order.length > 2) targets[order[2]] = { x: 8, lane: c.lane === 1 ? 1 : c.lane }
  for (var k = 0; k < order.length; k++) {
    var df = s.defenders[order[k]]
    var chance = pro1 ? [0.6, 0.35, 0.3][k] : [0.95, 0.7, 0.6][k]
    if (random() >= chance) continue
    var t = targets[order[k]]
    var ddx = sign(t.x - df.x), ddl = sign(t.lane - df.lane)
    if (ddx === 0 && ddl === 0) continue
    var tries = ddx !== 0 && ddl !== 0
      ? (random() < 0.5 ? [[ddx, 0], [0, ddl]] : [[0, ddl], [ddx, 0]])
      : [[ddx, ddl]]
    for (var j = 0; j < tries.length; j++) {
      var nx = df.x + tries[j][0], nl = df.lane + tries[j][1]
      if (!onCourt(nx, nl)) continue
      if (nx === c.x && nl === c.lane) {
        if (random() < (pro1 ? 0.3 : 0.55)) {
          emit(s, "steal", "STL", "STOLEN")
          turnover(s)
          return
        }
        emit(s, "bump")
        break
      }
      if (occupied(s, nx, nl)) continue
      df.x = nx; df.lane = nl
      break
    }
  }
}

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.lane - b.lane) }

// The teammate cuts around looking for an open spot on the wings and in the paint.
function mateTick(s) {
  if (s.phase !== "live" || !s.mate) return
  var m = s.mate
  var options = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
  var best = null, bestScore = -1e9
  for (var i = 0; i < options.length; i++) {
    var nx = m.x + options[i][0], nl = m.lane + options[i][1]
    if (!onCourt(nx, nl) || nx < 2) continue
    if ((options[i][0] || options[i][1]) && occupied(s, nx, nl)) continue
    var space = Math.min(9, Math.min.apply(null, s.defenders.map(function(df) { return dist(df, { x: nx, lane: nl }) })))
    var score = space * 2 + (nx >= 5 ? 1 : 0) + random() * 1.5
    if (score > bestScore) { bestScore = score; best = [nx, nl] }
  }
  if (best) { m.x = best[0]; m.lane = best[1] }
}

// One second of game time.
function clockTick(s) {
  if (s.phase !== "live" && s.phase !== "air") return
  if (s.clock > 0) s.clock -= 1
  if (s.phase === "live" && s.shot > 0) s.shot -= 1
  if (s.phase === "live" && s.clock <= 0) {
    // The horn: a ball in the air still counts, otherwise the period is over.
    s.aiming = false
    emit(s, "buzzer", "", periodName(s) + " OVER")
    deadBall(s, { type: "period" })
    return
  }
  if (s.phase === "live" && s.shot <= 0) {
    s.aiming = false
    emit(s, "buzzer", " 24 ", "SHOT CLOCK VIOLATION")
    turnover(s)
  }
}

// Advance a pass or shot one cell. Returns true while the ball is still flying.
function ballTick(s) {
  if (!s.ball) return false
  s.ball.i += 1
  var b = s.ball
  if (b.type === "pass") {
    if (b.i >= b.path.length) { completePass(s); return false }
    var cell = b.path[b.i]
    if (defenderAt(s, cell.x, cell.lane) >= 0) {
      s.ball = null
      emit(s, "steal", "STL", "PASS STOLEN")
      turnover(s)
      return false
    }
    return true
  }
  if (b.i >= b.path.length) { resolveShot(s); return false }
  return true
}

// ---------------------------------------------------------------- outcomes

function completePass(s) {
  // The old ball handler becomes the teammate: you now control the catcher.
  var from = s.carrier
  s.carrier = s.mate
  s.mate = from
  s.ball = null
  s.phase = "live"
  emit(s, "catch")
}

function resolveShot(s) {
  var b = s.ball
  s.ball = null
  if (b.made) {
    s.score[s.poss] += b.pts
    s.hoop = 2
    emit(s, b.pts === 3 ? "three" : "swish", b.pts === 3 ? "3PT" : "2PT",
      (b.pts === 3 ? "THREE POINTER" : "TWO POINTS") + (b.perfect ? " - SWISH" : ""))
    deadBall(s, { type: "possession", team: other(s.poss) })
    return
  }
  s.hoop = 1
  emit(s, "clank", "", "NO GOOD")
  if (s.clock <= 0) { deadBall(s, { type: "period" }); return }
  rebound(s)
}

// The miss caroms off the rim to a spot near the basket. The defense gets
// most rebounds, but being closer to where it lands helps: an offensive
// rebound keeps play going with a fresh shot clock.
function rebound(s) {
  var spot = { x: rint(7, 9), lane: rint(0, 2) }
  var near = function(p) { return p ? dist(p, spot) : 99 }
  var off = Math.min(near(s.carrier), near(s.mate))
  var def = Math.min.apply(null, s.defenders.map(near))
  var chance = (s.pro === 2 ? 0.25 : 0.35) + (off < def ? 0.15 : off > def ? -0.1 : 0)
  var offenseWins = random() < chance
  if (!offenseWins) {
    emit(s, "", "rEb", "DEFENSIVE REBOUND")
    deadBall(s, { type: "possession", team: other(s.poss) })
    return
  }
  // The closer offensive player takes it, on the rebound spot if it's free.
  var grabber = near(s.carrier) <= near(s.mate) ? "carrier" : "mate"
  if (grabber === "mate") { var t = s.carrier; s.carrier = s.mate; s.mate = t }
  if (!occupied(s, spot.x, spot.lane)) { s.carrier.x = spot.x; s.carrier.lane = spot.lane }
  s.shot = SHOT_CLOCK
  s.phase = "live"
  emit(s, "catch", "rEb", "OFFENSIVE REBOUND")
}

function turnover(s) {
  s.aiming = false
  deadBall(s, { type: "possession", team: other(s.poss) })
}

function deadBall(s, next) {
  s.phase = "dead"
  s.aiming = false
  s.ball = null
  s.next = next
}

function periodName(s) {
  if (s.quarter > 4) return "OVERTIME"
  return ["", "FIRST QUARTER", "SECOND QUARTER", "THIRD QUARTER", "FOURTH QUARTER"][s.quarter]
}

// Called when the player presses STATUS to set up the next possession.
function nextPlay(s) {
  if (s.phase !== "dead") return
  var next = s.next || { type: "possession", team: s.poss }
  s.next = null
  s.hoop = 0
  if (next.type === "period" || s.clock <= 0) {
    if (s.quarter >= 4 && s.score[0] !== s.score[1]) {
      s.phase = "gameover"
      s.carrier = null; s.mate = null; s.defenders = []
      var label = s.score[0] > s.score[1] ? "FINAL: HOME WINS" : "FINAL: VISITOR WINS"
      emit(s, "gameover", "END", label)
      return
    }
    s.quarter += 1
    s.clock = s.quarter > 4 ? OVERTIME_SECONDS : QUARTER_SECONDS
    // Possession arrow: the team that didn't open the game starts quarters
    // 2 and 3; the opener starts the 4th; overtimes alternate.
    var team = s.quarter === 4 ? s.openingPoss
      : s.quarter > 4 ? (s.quarter % 2 === 1 ? s.openingPoss : other(s.openingPoss))
      : other(s.openingPoss)
    emit(s, "whistle", "", s.quarter > 4 ? "OVERTIME!" : s.quarter === 3 ? "HALFTIME" : periodName(s))
    setupPossession(s, team)
    return
  }
  setupPossession(s, next.team)
}

// ---------------------------------------------------------------- display

// LED levels for the 3x10 court, row-major: 0 off, 1 defender, 2 teammate,
// 3 ball handler, 4 ball in flight. `blink` is the host's flicker phase.
function leds(s, blink) {
  var out = []
  for (var i = 0; i < COLS * LANES; i++) out.push(0)
  function put(x, lane, level) {
    if (!onCourt(x, lane)) return
    out[lane * COLS + x] = Math.max(out[lane * COLS + x], level)
  }
  for (var k = 0; k < s.defenders.length; k++) put(s.defenders[k].x, s.defenders[k].lane, 1)
  if (s.mate && blink % 2 === 0) put(s.mate.x, s.mate.lane, 2)
  var flying = s.ball && s.ball.i >= 0
  if (s.carrier && !(flying && s.ball.type === "pass")) {
    var waiting = s.phase === "presnap" || s.phase === "dead"
    // Rising for a shot: the shooter flickers fast.
    var flicker = s.aiming ? blink % 2 === 1 : waiting && blink % 4 === 3
    if (!flicker) put(s.carrier.x, s.carrier.lane, 3)
  }
  if (flying && s.ball.i < s.ball.path.length) {
    var b = s.ball.path[s.ball.i]
    put(b.x, b.lane, 4)
  }
  return out
}

function clockText(s) {
  var m = Math.floor(s.clock / 60), sec = s.clock % 60
  return m + ":" + (sec < 10 ? "0" : "") + sec
}
