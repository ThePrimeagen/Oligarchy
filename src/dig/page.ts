import * as Domain from "./domain.ts";

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dig</title>
    <style>
      :root {
        font-family: "Trebuchet MS", "Comic Sans MS", sans-serif;
        color: #3b2414;
        background: #6b3f1f;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 10%, #c48a4a 0, transparent 40%),
          repeating-linear-gradient(180deg, #7a4824 0 18px, #6b3f1f 18px 36px);
      }
      .box {
        width: min(520px, calc(100vw - 32px));
        padding: 28px 32px 24px;
        background: #f4d35e;
        border: 6px solid #3b2414;
        border-radius: 28px;
        box-shadow: 10px 12px 0 #2a160c;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 42px;
        letter-spacing: 1px;
      }
      #ready-label {
        margin: 0 0 16px;
        font-size: 22px;
        font-weight: 700;
      }
      #seats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 18px;
      }
      .seat {
        min-height: 64px;
        border: 4px dashed #3b2414;
        border-radius: 16px;
        background: #ffe9a3;
        display: grid;
        place-items: center;
        font-weight: 700;
      }
      .seat.filled {
        border-style: solid;
        background: #fff3c4;
      }
      .seat.you {
        background: #fff;
      }
      .actions {
        display: flex;
        gap: 12px;
      }
      button {
        flex: 1;
        font: inherit;
        font-size: 20px;
        font-weight: 800;
        padding: 12px 8px;
        border: 4px solid #3b2414;
        border-radius: 16px;
        background: #f95738;
        color: #fff8e7;
        cursor: pointer;
      }
      button:disabled {
        background: #c4b48a;
        color: #6a5430;
        cursor: default;
      }
      #start:not(:disabled) {
        background: #2e7d32;
        color: #fff8e7;
      }
      #kick {
        margin-top: 16px;
        font-size: 20px;
        font-weight: 800;
        color: #9b1d20;
      }
      canvas {
        display: block;
        background: #1b3a4b;
        border: 6px solid #3b2414;
        border-radius: 18px;
        box-shadow: 10px 12px 0 #2a160c;
        max-width: calc(100vw - 24px);
        height: auto;
      }
      canvas[hidden] {
        display: none;
      }
      #fx {
        position: fixed;
        left: 36px;
        top: 24px;
        font-size: 72px;
        font-weight: 900;
        pointer-events: none;
        text-shadow: 4px 4px 0 #3b2414;
      }
    </style>
  </head>
  <body>
    <div id="lobby" class="box">
      <h1>Dig</h1>
      <p id="ready-label">players ready</p>
      <div id="seats"></div>
      <div class="actions">
        <button id="ready" type="button" disabled>Ready</button>
        <button id="start" type="button" disabled>Start Game</button>
      </div>
      <p id="kick" hidden></p>
    </div>
    <canvas id="game" width="960" height="540" hidden></canvas>
    <div id="fx"></div>
    <script src="/game.js"></script>
  </body>
</html>
`;

export const script = `"use strict";
var lobby = document.getElementById("lobby");
var readyLabel = document.getElementById("ready-label");
var seatsEl = document.getElementById("seats");
var readyBtn = document.getElementById("ready");
var startBtn = document.getElementById("start");
var kickEl = document.getElementById("kick");
var canvas = document.getElementById("game");
var fxEl = document.getElementById("fx");
var ctx = canvas.getContext("2d");
var arrows = { w: "▲", a: "◀", s: "▼", d: "▶" };
var snapshot = null;
var judged = {};
var songOffset = 0;
var originAt = 0;
var musicStarted = false;
var audio = null;
var fxUntil = 0;
var fxText = "";
var fxFrom = "#7fff6a";
var fxTo = "#ffe066";
var shards = [];
var swingUntil = 0;
var lastBroken = {};
var CUBE_HP = ${String(Domain.DIRT_HP)};
var protocol = location.protocol === "https:" ? "wss:" : "ws:";
var socket = new WebSocket(protocol + "//" + location.host + "/ws");

function send(message) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(message));
}

function songTimeMs() {
  if (originAt === 0) {
    return 0;
  }
  return songOffset + (performance.now() - originAt);
}

function syncSong(message) {
  if (message.phase !== "playing" || originAt !== 0) {
    return;
  }
  originAt = performance.now();
  songOffset = message.serverNowMs - message.startedAtMs;
}

function armAudio() {
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  if (!audio) {
    audio = new AudioCtx();
  }
  if (audio.state === "suspended" && audio.resume) {
    audio.resume();
  }
}

function startMusic() {
  if (musicStarted || !audio) {
    return;
  }
  musicStarted = true;
  var elapsed = songTimeMs() / 1000;
  var t0 = audio.currentTime;
  for (var i = 0; i < 40; i++) {
    var when = i * 0.5 - elapsed;
    if (when < 0) {
      continue;
    }
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = i % 4 === 0 ? 220 : 165;
    gain.gain.setValueAtTime(0.07, t0 + when);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + when + 0.12);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0 + when);
    osc.stop(t0 + when + 0.12);
  }
}

function hex(color) {
  return parseInt(color.slice(1), 16);
}

function mix(from, to, t) {
  var a = hex(from);
  var b = hex(to);
  var ar = a >> 16;
  var ag = (a >> 8) & 255;
  var ab = a & 255;
  var br = b >> 16;
  var bg = (b >> 8) & 255;
  var bb = b & 255;
  var r = Math.round(ar + (br - ar) * t);
  var g = Math.round(ag + (bg - ag) * t);
  var bl = Math.round(ab + (bb - ab) * t);
  return "rgb(" + String(r) + "," + String(g) + "," + String(bl) + ")";
}

function showFx(judgment) {
  if (judgment === "perfect") {
    fxText = "Perfect";
    fxFrom = "#7fff6a";
    fxTo = "#ffe066";
  } else if (judgment === "okay") {
    fxText = "Okay";
    fxFrom = "#ffe066";
    fxTo = "#f95738";
  } else {
    fxText = "X";
    fxFrom = "#f95738";
    fxTo = "#9b1d20";
  }
  fxUntil = performance.now() + 900;
}

function shatter(x, y) {
  var i;
  for (i = 0; i < 14; i++) {
    shards.push({
      x: x + (Math.random() - 0.5) * 24,
      y: y,
      vx: (Math.random() - 0.5) * 7,
      vy: -2 - Math.random() * 5,
      spin: (Math.random() - 0.5) * 0.4,
      ang: Math.random() * 6,
      life: 1,
      size: 5 + Math.random() * 7,
    });
  }
}

function isoCube(cx, cy, size, top, left, right, ghost) {
  var hx = size;
  var hy = size * 0.5;
  var d = size * 0.72;
  ctx.save();
  ctx.globalAlpha = ghost ? 0.5 : 1;
  ctx.lineJoin = "round";
  ctx.lineWidth = ghost ? 2 : 1.5;
  ctx.strokeStyle = ghost ? "#fff8e7" : "#2a160c";
  ctx.beginPath();
  ctx.moveTo(cx, cy - d);
  ctx.lineTo(cx + hx, cy - d + hy);
  ctx.lineTo(cx, cy - d + hy * 2);
  ctx.lineTo(cx - hx, cy - d + hy);
  ctx.closePath();
  ctx.fillStyle = ghost ? "transparent" : top;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - hx, cy - d + hy);
  ctx.lineTo(cx, cy - d + hy * 2);
  ctx.lineTo(cx, cy + hy);
  ctx.lineTo(cx - hx, cy);
  ctx.closePath();
  ctx.fillStyle = ghost ? "transparent" : left;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + hx, cy - d + hy);
  ctx.lineTo(cx, cy - d + hy * 2);
  ctx.lineTo(cx, cy + hy);
  ctx.lineTo(cx + hx, cy);
  ctx.closePath();
  ctx.fillStyle = ghost ? "transparent" : right;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function dirtCube(cx, cy, size, ghost, crack) {
  isoCube(cx, cy, size, "#c48a4a", "#7a4824", "#a86b35", ghost);
  if (ghost || crack <= 0) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "rgba(42,22,12," + String(0.35 + crack * 0.65) + ")";
  ctx.lineWidth = 1 + crack * 2;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.35, cy - size * 0.15);
  ctx.lineTo(cx + size * 0.1, cy + size * 0.05);
  ctx.lineTo(cx + size * 0.4, cy - size * 0.2);
  ctx.moveTo(cx - size * 0.1, cy - size * 0.4);
  ctx.lineTo(cx, cy + size * 0.2);
  ctx.stroke();
  ctx.restore();
}

function grassCube(cx, cy, size, ghost) {
  isoCube(cx, cy, size, "#5dbb3b", "#3d7a24", "#7a4824", ghost);
  if (ghost) {
    return;
  }
  ctx.fillStyle = "#6fd14a";
  ctx.fillRect(cx - 3, cy - size * 0.85, 2, 6);
  ctx.fillRect(cx + 4, cy - size * 0.8, 2, 5);
  ctx.fillStyle = "#3d7a24";
  ctx.fillRect(cx - 8, cy - size * 0.7, 2, 4);
}

function voxelMiner(x, y, ghost, swing) {
  var lean = swing ? -0.18 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  isoCube(0, -36, 9, ghost ? "#fff8e7" : "#ffe066", ghost ? "transparent" : "#d4a017", ghost ? "transparent" : "#f4d35e", ghost);
  isoCube(0, -18, 11, ghost ? "#fff8e7" : "#5b8c3a", ghost ? "transparent" : "#3d7a24", ghost ? "transparent" : "#6b3f1f", ghost);
  isoCube(-10, -16, 5, ghost ? "#fff8e7" : "#e8c39a", ghost ? "transparent" : "#c48a4a", ghost ? "transparent" : "#d4a07a", ghost);
  isoCube(12, swing ? -28 : -14, 5, ghost ? "#fff8e7" : "#e8c39a", ghost ? "transparent" : "#c48a4a", ghost ? "transparent" : "#d4a07a", ghost);
  isoCube(-6, 0, 6, ghost ? "#fff8e7" : "#6b3f1f", ghost ? "transparent" : "#3b2414", ghost ? "transparent" : "#7a4824", ghost);
  isoCube(6, 0, 6, ghost ? "#fff8e7" : "#6b3f1f", ghost ? "transparent" : "#3b2414", ghost ? "transparent" : "#7a4824", ghost);
  ctx.strokeStyle = ghost ? "#fff8e7" : "#5c4030";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(12, swing ? -28 : -14);
  ctx.lineTo(22, swing ? 8 : -2);
  ctx.stroke();
  ctx.fillStyle = ghost ? "transparent" : "#c0c7d1";
  ctx.strokeStyle = ghost ? "#fff8e7" : "#3b2414";
  ctx.beginPath();
  ctx.moveTo(18, swing ? 4 : -6);
  ctx.lineTo(28, swing ? 14 : 4);
  ctx.lineTo(22, swing ? 16 : 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function rememberJudged(players) {
  var self = players.find(function (player) {
    return !player.ghost;
  });
  judged = {};
  if (!self) {
    return;
  }
  self.judged.forEach(function (item) {
    judged[item.noteId] = item.judgment;
  });
}

function paintLobby() {
  if (snapshot === null) {
    return;
  }
  readyLabel.textContent = snapshot.readyLabel;
  seatsEl.replaceChildren();
  for (var slot = 0; slot < 4; slot++) {
    var seat = document.createElement("div");
    var player = snapshot.players.find(function (item) {
      return item.slot === slot;
    });
    seat.className = "seat";
    if (player) {
      seat.classList.add("filled");
      if (!player.ghost) {
        seat.classList.add("you");
      }
      seat.textContent = player.captain ? "captain" : player.ready ? "ready" : "seated";
    } else {
      seat.textContent = "empty";
    }
    seatsEl.appendChild(seat);
  }
  readyBtn.disabled = snapshot.phase !== "lobby" || snapshot.players.some(function (player) {
    return !player.ghost && player.ready;
  });
  var everyoneReady =
    snapshot.players.length > 0 && snapshot.players.every(function (player) {
      return player.ready;
    });
  startBtn.disabled = snapshot.phase !== "lobby" || !snapshot.youAreCaptain || !everyoneReady;
}

function paintGame() {
  var now = songTimeMs();
  var t = performance.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6eb7e0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff8e7";
  ctx.font = "700 22px Trebuchet MS";
  ctx.fillText("WASD", 24, 36);
  if (snapshot === null) {
    return;
  }
  ctx.fillText(snapshot.readyLabel, 24, 64);
  var ground = 168;
  var colW = 150;
  var originX = 300;
  var cubeSize = 22;
  var cubeH = 26;
  var row;
  var col;
  for (row = 0; row < 12; row++) {
    for (col = -1; col < 14; col++) {
      grassCube(210 + col * 46 + (row % 2) * 23, ground - 18 + row * 14, 20, false);
    }
  }
  snapshot.players.forEach(function (player) {
    var x = originX + player.slot * colW;
    var broken = Math.floor(player.totalDamage / CUBE_HP);
    var crack = (player.totalDamage % CUBE_HP) / CUBE_HP;
    var faceY = ground + Math.min(broken * cubeH + crack * cubeH, canvas.height - ground - 70);
    var n;
    for (n = broken + 8; n >= broken; n--) {
      var cy = ground + n * cubeH;
      if (cy > canvas.height + 20) {
        continue;
      }
      if (n === 0 && broken === 0) {
        grassCube(x, cy, cubeSize, player.ghost);
      } else {
        dirtCube(x, cy, cubeSize, player.ghost, n === broken ? crack : 0);
      }
    }
    voxelMiner(x, faceY + 8, player.ghost, !player.ghost && t < swingUntil);
  });
  shards = shards.filter(function (bit) {
    bit.x += bit.vx;
    bit.y += bit.vy;
    bit.vy += 0.35;
    bit.ang += bit.spin;
    bit.life -= 0.025;
    if (bit.life <= 0) {
      return false;
    }
    ctx.save();
    ctx.globalAlpha = bit.life;
    ctx.translate(bit.x, bit.y);
    ctx.rotate(bit.ang);
    isoCube(0, 0, bit.size, "#c48a4a", "#7a4824", "#a86b35", false);
    ctx.restore();
    return true;
  });
  var next = snapshot.notes.find(function (note) {
    return !judged[note.id];
  });
  ctx.fillStyle = "#fff8e7";
  ctx.font = "800 22px Trebuchet MS";
  ctx.fillText("arrows", 70, 170);
  ctx.fillStyle = "#3b2414";
  ctx.fillRect(40, 180, 160, 280);
  ctx.strokeStyle = "#f4d35e";
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 180, 160, 280);
  ctx.strokeStyle = "#7fff6a";
  ctx.beginPath();
  ctx.moveTo(48, 400);
  ctx.lineTo(192, 400);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(40, 180, 160, 280);
  ctx.clip();
  if (now >= ${String(Domain.MUSIC_LEAD_MS)}) {
    snapshot.notes.forEach(function (note) {
      if (judged[note.id]) {
        return;
      }
      var dt = note.hitMs - now;
      if (dt < -160 || dt > 1800) {
        return;
      }
      var y = 400 - dt * 0.12;
      var size = next && next.id === note.id ? 56 : 36;
      ctx.font = "900 " + String(size) + "px Trebuchet MS";
      ctx.fillStyle = next && next.id === note.id ? "#7fff6a" : "#ffe066";
      ctx.fillText(arrows[note.direction] || "?", 90, y);
    });
  }
  ctx.restore();
  if (t < fxUntil) {
    var fade = 1 - (fxUntil - t) / 900;
    var color = mix(fxFrom, fxTo, fade);
    fxEl.textContent = fxText;
    fxEl.style.color = color;
    fxEl.style.opacity = String(1 - fade);
    ctx.font = "900 64px Trebuchet MS";
    ctx.fillStyle = color;
    ctx.globalAlpha = 1 - fade;
    ctx.fillText(fxText, 240, 80);
    ctx.globalAlpha = 1;
  } else {
    fxEl.textContent = "";
  }
}

function frame() {
  if (snapshot !== null && snapshot.phase === "playing") {
    startMusic();
    lobby.hidden = true;
    canvas.hidden = false;
    var now = songTimeMs();
    var due = snapshot.notes.find(function (note) {
      return !judged[note.id] && now > note.hitMs + ${String(Domain.OKAY_WINDOW_MS)};
    });
    if (due) {
      send({ _tag: "Tick", songTimeMs: now });
    }
    paintGame();
  } else {
    paintLobby();
  }
  requestAnimationFrame(frame);
}

socket.addEventListener("message", function (event) {
  var message = JSON.parse(event.data);
  if (message._tag === "Kicked") {
    kickEl.hidden = false;
    kickEl.textContent = message.message;
    readyBtn.disabled = true;
    startBtn.disabled = true;
    return;
  }
  if (message._tag === "JudgmentFx") {
    judged[message.noteId] = message.judgment;
    var broken = Math.floor(message.depth);
    var prev = lastBroken[message.playerId] || 0;
    lastBroken[message.playerId] = broken;
    swingUntil = performance.now() + 240;
    if (snapshot !== null) {
      var seat = snapshot.players.find(function (player) {
        return player.id === message.playerId;
      });
      var col = seat ? 300 + seat.slot * 150 : 300;
      var face = 168 + Math.min(message.depth * 26, 360);
      shatter(col, face);
      if (broken > prev) {
        shatter(col, face);
      }
      if (message.playerId === snapshot.you) {
        showFx(message.judgment);
      }
    }
    return;
  }
  if (message._tag === "Snapshot") {
    snapshot = message;
    rememberJudged(message.players);
    syncSong(message);
    paintLobby();
  }
});

readyBtn.addEventListener("click", function () {
  armAudio();
  send({ _tag: "Ready" });
});

startBtn.addEventListener("click", function () {
  armAudio();
  send({ _tag: "Start" });
});

window.addEventListener("keydown", function (event) {
  var key = event.key.toLowerCase();
  if (key !== "w" && key !== "a" && key !== "s" && key !== "d") {
    return;
  }
  event.preventDefault();
  if (snapshot === null || snapshot.phase !== "playing") {
    return;
  }
  var note = snapshot.notes.find(function (item) {
    return !judged[item.id];
  });
  if (!note) {
    return;
  }
  send({ _tag: "Hit", noteId: note.id, direction: key, songTimeMs: songTimeMs() });
});

requestAnimationFrame(frame);
`;
