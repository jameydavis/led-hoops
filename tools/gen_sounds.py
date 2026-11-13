#!/usr/bin/env python3
"""Synthesize LED Hoops' piezo-style sound effects into ../sounds/*.wav.

Handheld LED games of the late '70s had a single piezo buzzer driven by a
square wave, so every effect here is a sequence of square-wave tones (with an
optional pitch sweep and vibrato). Run it after changing a recipe:

    python3 tools/gen_sounds.py
"""
import math
import os
import random
import struct
import wave

RATE = 22050
VOLUME = 0.32
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")


def tone(freq, ms, end=None, vibrato=0.0, vib_rate=0.0, duty=0.5, noise=0.0):
    """One square-wave note. `end` sweeps the pitch linearly to that frequency."""
    n = int(RATE * ms / 1000)
    end = freq if end is None else end
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq + (end - freq) * (i / max(1, n - 1))
        if vibrato:
            f *= 1 + vibrato * math.sin(2 * math.pi * vib_rate * t)
        phase = (phase + f / RATE) % 1.0
        s = 1.0 if phase < duty else -1.0
        if noise:
            s = s * (1 - noise) + random.uniform(-1, 1) * noise
        # 3 ms attack/release so notes click like a buzzer, not like a pop.
        edge = min(1.0, i / (RATE * 0.003), (n - i) / (RATE * 0.003))
        out.append(s * edge)
    return out


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def write(name, *parts):
    # Lead-in and tail silence: DSP sinks (e.g. the Apple Silicon speaker
    # convolver, ~170 ms of latency) drop a stream's last samples when the
    # stream disconnects, which swallows short beeps entirely.
    samples = rest(30) + [s for part in parts for s in part] + rest(260)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * VOLUME * 32767)) for s in samples))


def main():
    random.seed(11)
    os.makedirs(OUT, exist_ok=True)
    # Dribble: a soft low thump on every step.
    write("dribble", tone(140, 28, 90, noise=0.3, duty=0.3))
    # Bumping into someone.
    write("bump", tone(110, 70, 90, noise=0.45))
    # Inbound: a short referee chirp.
    write("inbound", tone(2300, 90, 2250, vibrato=0.03, vib_rate=40))
    # Shot release: a rising chirp as the ball leaves your hand.
    write("shoot", tone(500, 160, 1250, duty=0.35))
    # Swish: a breathy downward hiss plus a bright ping.
    write("swish", tone(1800, 160, 600, noise=0.75, duty=0.3), tone(1568, 70), rest(20), tone(2093, 140))
    # Three: swish then a quick fanfare.
    write("three", tone(1800, 140, 600, noise=0.75, duty=0.3),
          *[p for f in (784, 988, 1175, 1568) for p in (tone(f, 75), rest(15))], tone(1568, 220))
    # Clank: two inharmonic metallic tones off the rim, decaying.
    write("clank", tone(700, 45), tone(1130, 40), tone(700, 35), rest(25), tone(560, 90, 520, vibrato=0.04, vib_rate=35))
    # Block: a hard thud then a falling buzz.
    write("block", tone(160, 60, 120, noise=0.5), tone(420, 220, 180, vibrato=0.08, vib_rate=25))
    # Steal: a quick descending swipe.
    write("steal", tone(1500, 90, 900), tone(900, 90, 500), tone(500, 160, 260, vibrato=0.06, vib_rate=20))
    # Pass and catch.
    write("pass", tone(900, 110, 1400, duty=0.4))
    write("catch", tone(1180, 50), tone(1480, 80))
    # The horn: end of a period or the shot clock.
    write("buzzer", tone(196, 900, noise=0.08, duty=0.45))
    # Referee whistle: start of a new period.
    write("whistle", tone(2350, 420, 2300, vibrato=0.03, vib_rate=45), rest(60), tone(2350, 200, vibrato=0.03, vib_rate=45))
    # Final horn jingle.
    final = [(523, 130), (659, 130), (784, 130), (1047, 130), (784, 130), (1047, 500)]
    write("gameover", tone(196, 500, noise=0.08, duty=0.45), rest(80), *[p for f, ms in final for p in (tone(f, ms), rest(30))])
    # UI blip for status/score/menu keys and the shot meter rising.
    write("blip", tone(2000, 22, duty=0.25))


if __name__ == "__main__":
    main()
