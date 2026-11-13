// Run: node test/logic.test.js
// Loads Logic.js (a QML `.pragma library` file) into node and exercises the rules.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "Logic.js"), "utf8").replace(/^\.pragma library/m, "")
  const names = ["newGame", "move", "startShot", "meterTick", "release", "pass", "defenseTick", "mateTick",
    "clockTick", "ballTick", "nextPlay", "leds", "clockText", "setupPossession", "shotValue", "meterLevel",
    "passLaneOpen", "distance", "baseChance", "shotChance", "QUARTER_SECONDS", "SHOT_CLOCK", "THREE_POINT"]
  return new Function(src + "\nreturn {" + names.join(",") + ", setRandom: function(f) { random = f } }")()
}

let passed = 0
function test(name, fn) {
  const L = load()
  try { fn(L); passed++; console.log("ok   " + name) }
  catch (e) { console.log("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1 }
}

function rows(L, s) {
  const m = L.leds(s, 0)
  return [0, 1, 2].map(r => m.slice(r * 10, r * 10 + 10).map(v => ".dmC*"[v]).join(""))
}

// Put the ball handler somewhere with no defense (or a given one) and go live.
function live(L, x, lane, defenders) {
  const s = L.newGame(1)
  s.events = []
  s.carrier = { x, lane }
  s.mate = { x: 2, lane: lane === 0 ? 2 : 0 }
  s.defenders = defenders || []
  s.phase = "live"
  return s
}

function aimAndRelease(L, s, level) {
  L.startShot(s)
  while (L.meterLevel(s) !== level) L.meterTick(s)
  L.release(s)
  while (L.ballTick(s)) {}
}

test("tip-off lineup: you at the left edge, teammate on a wing, two defenders up top and one at the rim", L => {
  L.setRandom(() => 0.1)
  const s = L.newGame(1)
  assert.strictEqual(s.phase, "presnap")
  assert.deepStrictEqual(rows(L, s), ["..m..d....", "C.......d.", ".....d...."])
})

test("first move starts the clock; you can't walk through anyone", L => {
  const s = L.newGame(1)
  L.move(s, 1, 0)
  assert.strictEqual(s.phase, "live")
  assert.deepStrictEqual(s.carrier, { x: 1, lane: 1 })
  s.defenders = [{ x: 2, lane: 1 }]
  L.move(s, 1, 0)
  assert.deepStrictEqual(s.carrier, { x: 1, lane: 1 }, "blocked")
  assert.ok(s.events.some(e => e.sound === "bump"))
  L.move(s, -1, 0); L.move(s, -1, 0)
  assert.strictEqual(s.carrier.x, 0, "can't leave the court")
})

test("threes are worth 3 from beyond the arc, 2 inside it", L => {
  assert.strictEqual(L.shotValue({ carrier: { x: 5, lane: 1 } }), 3)
  assert.strictEqual(L.shotValue({ carrier: { x: 6, lane: 1 } }), 2)
  assert.strictEqual(L.shotValue({ carrier: { x: 9, lane: 1 } }), 2)
  assert.ok(L.baseChance(9, 1) > L.baseChance(7, 1) && L.baseChance(7, 1) > L.baseChance(3, 1))
})

test("the meter climbs to the top and falls back", L => {
  const s = live(L, 6, 1)
  L.startShot(s)
  const seen = []
  for (let i = 0; i < 8; i++) { seen.push(L.meterLevel(s)); L.meterTick(s) }
  assert.deepStrictEqual(seen, [0, 1, 2, 3, 4, 3, 2, 1])
})

test("a perfect release from close range scores two and gives the ball away", L => {
  L.setRandom(() => 0.5)
  const s = live(L, 8, 1)
  aimAndRelease(L, s, 4)
  assert.strictEqual(s.score[0], 2)
  assert.strictEqual(s.hoop, 2)
  assert.ok(s.events.some(e => e.code === "2PT"))
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.phase, "presnap")
})

test("a three from beyond the arc", L => {
  L.setRandom(() => 0.05)
  const s = live(L, 4, 1)
  aimAndRelease(L, s, 4)
  assert.strictEqual(s.score[0], 3)
  assert.ok(s.events.some(e => e.code === "3PT"))
})

test("timing matters: a bad release is far less likely than a perfect one", L => {
  const s = live(L, 6, 1)
  assert.ok(L.shotChance(s, 4) > L.shotChance(s, 1) * 2.5)
})

test("a defender in your face lowers the odds", L => {
  const open = live(L, 6, 0)
  const guarded = live(L, 6, 0, [{ x: 6, lane: 1 }])
  assert.ok(L.shotChance(guarded, 3) < L.shotChance(open, 3))
})

test("a defender between you and the rim can block the shot", L => {
  L.setRandom(() => 0.1)
  const s = live(L, 6, 1, [{ x: 7, lane: 1 }])
  L.startShot(s)
  L.release(s)
  assert.ok(s.events.some(e => e.code === "BLK"))
  assert.strictEqual(s.phase, "dead")
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
})

// Feed exact dice rolls, in call order.
function rolls(L, values) { const q = values.slice(); L.setRandom(() => (q.length ? q.shift() : 0.5)) }

test("misses: the defense usually rebounds, an offensive board keeps play alive", L => {
  // shot roll (miss), rebound spot x, spot lane, offensive-rebound roll
  const s = live(L, 8, 2, [{ x: 0, lane: 0 }])
  s.mate = { x: 2, lane: 0 }
  rolls(L, [0.99, 0.99, 0.99, 0.1])
  aimAndRelease(L, s, 4)
  assert.ok(s.events.some(e => e.label === "OFFENSIVE REBOUND"))
  assert.strictEqual(s.phase, "live")
  assert.strictEqual(s.poss, 0)
  assert.strictEqual(s.shot, L.SHOT_CLOCK)
  assert.deepStrictEqual(s.carrier, { x: 9, lane: 2 }, "grabbed where it landed")

  const d = live(L, 2, 0, [{ x: 9, lane: 2 }]) // defender sits on the landing spot
  rolls(L, [0.99, 0.99, 0.99, 0.3]) // the defender is closer: Pro 1 offense chance is 35% - 10% = 25%
  aimAndRelease(L, d, 0)
  assert.ok(d.events.some(e => e.label === "DEFENSIVE REBOUND"))
  L.nextPlay(d)
  assert.strictEqual(d.poss, 1)
})

test("over many misses the defense gets most rebounds", L => {
  let off = 0, n = 4000
  for (let i = 0; i < n; i++) {
    const s = live(L, 8, 1, [{ x: 7, lane: 0 }, { x: 9, lane: 2 }, { x: 6, lane: 1 }])
    s.mate = { x: 4, lane: 2 }
    s.ball = { path: [], i: 0, type: "shot", made: false, pts: 2 }
    s.phase = "air"
    L.ballTick(s)
    if (s.events.some(e => e.label === "OFFENSIVE REBOUND")) off++
  }
  const rate = off / n
  assert.ok(rate > 0.2 && rate < 0.5, "offensive rebound rate " + rate)
})

test("passing switches you to the catcher; a defender in the lane steals it", L => {
  const s = live(L, 3, 1)
  s.mate = { x: 6, lane: 1 }
  assert.ok(L.passLaneOpen(s))
  L.pass(s)
  while (L.ballTick(s)) {}
  assert.deepStrictEqual(s.carrier, { x: 6, lane: 1 })
  assert.deepStrictEqual(s.mate, { x: 3, lane: 1 })
  const t = live(L, 3, 1, [{ x: 5, lane: 1 }])
  t.mate = { x: 6, lane: 1 }
  assert.ok(!L.passLaneOpen(t))
  L.pass(t)
  while (L.ballTick(t)) {}
  assert.ok(t.events.some(e => e.code === "STL"))
  L.nextPlay(t)
  assert.strictEqual(t.poss, 1)
})

test("a defender who reaches in can steal; Pro 1 defenders miss more", L => {
  L.setRandom(() => 0.2)
  const s = live(L, 4, 1, [{ x: 5, lane: 1 }])
  L.defenseTick(s)
  assert.ok(s.events.some(e => e.code === "STL"))
  L.setRandom(() => 0.4) // moves (0.4 < 0.6) but misses the Pro 1 steal (0.4 >= 0.3)
  const t = live(L, 4, 1, [{ x: 5, lane: 1 }])
  L.defenseTick(t)
  assert.strictEqual(t.phase, "live")
  t.pro = 2
  L.defenseTick(t)
  assert.ok(t.events.some(e => e.code === "STL"), "Pro 2 steal (0.4 < 0.55)")
})

test("the shot clock runs out", L => {
  const s = live(L, 3, 1)
  for (let i = 0; i < L.SHOT_CLOCK; i++) L.clockTick(s)
  assert.ok(s.events.some(e => e.label === "SHOT CLOCK VIOLATION"))
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
})

test("a shot in the air at the horn still counts", L => {
  L.setRandom(() => 0.1)
  const s = live(L, 8, 1)
  s.quarter = 4
  s.clock = 1
  s.score = [10, 11]
  L.startShot(s)
  for (let i = 0; i < 4; i++) L.meterTick(s)
  L.release(s)
  L.clockTick(s) // horn sounds with the ball in the air
  assert.strictEqual(s.clock, 0)
  while (L.ballTick(s)) {}
  assert.strictEqual(s.score[0], 12)
  L.nextPlay(s)
  assert.strictEqual(s.phase, "gameover")
})

test("a tie after four goes to overtime", L => {
  const s = live(L, 3, 1)
  s.quarter = 4
  s.clock = 1
  s.score = [20, 20]
  L.clockTick(s)
  L.nextPlay(s)
  assert.strictEqual(s.quarter, 5)
  assert.strictEqual(s.clock, 60)
  assert.strictEqual(s.phase, "presnap")
})

test("halftime: the team that didn't open gets the ball", L => {
  const s = live(L, 3, 1)
  s.quarter = 2
  s.clock = 1
  L.clockTick(s)
  L.nextPlay(s)
  assert.strictEqual(s.quarter, 3)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.clock, L.QUARTER_SECONDS)
})

test("fuzz: random full games never break invariants and always end", L => {
  for (let g = 0; g < 150; g++) {
    const s = L.newGame(g % 2 ? 2 : 1)
    let guard = 0
    while (s.phase !== "gameover" && guard++ < 400000) {
      const r = Math.random()
      if (s.phase === "dead") L.nextPlay(s)
      else if (s.phase === "air") L.ballTick(s)
      else if (s.aiming) { if (r < 0.3) L.release(s); else L.meterTick(s) }
      else if (r < 0.04) L.startShot(s)
      else if (r < 0.06) L.pass(s)
      else if (r < 0.5) L.move(s, Math.random() < 0.7 ? 1 : -1, 0)
      else if (r < 0.7) L.move(s, 0, Math.random() < 0.5 ? -1 : 1)
      else { L.defenseTick(s); L.mateTick(s); if (r > 0.9) L.clockTick(s) }
      s.events.length = 0
      const people = [s.carrier, s.mate, ...s.defenders].filter(Boolean)
      for (const p of people) assert.ok(p.x >= 0 && p.x < 10 && p.lane >= 0 && p.lane < 3, JSON.stringify(p))
      assert.strictEqual(new Set(people.map(p => p.x + ":" + p.lane)).size, people.length, "two players share a cell")
      assert.ok(s.clock >= 0 && s.shot >= 0)
    }
    assert.strictEqual(s.phase, "gameover", "game " + g + " never ended")
    assert.notStrictEqual(s.score[0], s.score[1], "games end with a winner")
  }
})

console.log(passed + " passed")
