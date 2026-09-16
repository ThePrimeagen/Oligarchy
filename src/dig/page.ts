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
        <button id="ready" type="button">Ready</button>
        <button id="start" type="button">Start Game</button>
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
var songOrigin = 0;
var musicStarted = false;
var audio = null;
var fxUntil = 0;
var fxText = "";
var fxFrom = "#7fff6a";
var fxTo = "#ffe066";
var protocol = location.protocol === "https:" ? "wss:" : "ws:";
var socket = new WebSocket(protocol + "//" + location.host + "/ws");

function send(message) {
  socket.send(JSON.stringify(message));
}

function songTimeMs() {
  if (songOrigin === 0) {
    return 0;
  }
  return performance.now() - songOrigin;
}

function startMusic() {
  if (musicStarted) {
    return;
  }
  musicStarted = true;
  songOrigin = performance.now();
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  audio = new AudioCtx();
  var t = audio.currentTime;
  for (var i = 0; i < 40; i++) {
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = i % 4 === 0 ? 220 : 165;
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.12);
    t += 0.5;
  }
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

function miner(x, y, ghost, opacity) {
  ctx.save();
  ctx.globalAlpha = ghost ? opacity : 1;
  ctx.lineWidth = 3;
  ctx.strokeStyle = ghost ? "#fff8e7" : "#ffe066";
  ctx.fillStyle = ghost ? "transparent" : "#f4d35e";
  ctx.beginPath();
  ctx.arc(x, y - 18, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(x - 8, y - 8, 16, 22);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function hole(x, top, depthPx, ghost, opacity) {
  ctx.save();
  ctx.globalAlpha = ghost ? opacity : 1;
  ctx.strokeStyle = "#3b2414";
  ctx.fillStyle = ghost ? "transparent" : "#4a2a14";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(x - 28, top, 56, Math.max(18, depthPx));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function paintGame() {
  var now = songTimeMs();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#87c5e8";
  ctx.fillRect(0, 0, canvas.width, 120);
  ctx.fillStyle = "#c48a4a";
  ctx.fillRect(0, 120, canvas.width, canvas.height);
  ctx.fillStyle = "#fff8e7";
  ctx.font = "700 22px Trebuchet MS";
  ctx.fillText("WASD", 24, 36);
  if (snapshot === null) {
    return;
  }
  ctx.fillText(snapshot.readyLabel, 24, 64);
  var opacity = snapshot.ghostOpacity;
  var ground = 140;
  var colW = 140;
  var originX = 280;
  snapshot.players.forEach(function (player) {
    var x = originX + player.slot * colW;
    var depthPx = Math.min(player.depth * 36, canvas.height - ground - 40);
    hole(x, ground, depthPx, player.ghost, opacity);
    miner(x, ground + depthPx + 20, player.ghost, opacity);
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
  ctx.restore();
  if (performance.now() < fxUntil) {
    var t = 1 - (fxUntil - performance.now()) / 900;
    fxEl.textContent = fxText;
    fxEl.style.color = t < 0.5 ? fxFrom : fxTo;
    fxEl.style.opacity = String(1 - t * 0.2);
    ctx.font = "900 64px Trebuchet MS";
    ctx.fillStyle = t < 0.5 ? fxFrom : fxTo;
    ctx.fillText(fxText, 240, 80);
  } else {
    fxEl.textContent = "";
  }
}

function frame() {
  if (snapshot !== null && snapshot.phase === "playing") {
    startMusic();
    lobby.hidden = true;
    canvas.hidden = false;
    send({ _tag: "Tick", songTimeMs: songTimeMs() });
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
    if (snapshot !== null && message.playerId === snapshot.you) {
      showFx(message.judgment);
    }
    return;
  }
  if (message._tag === "Snapshot") {
    snapshot = message;
    paintLobby();
  }
});

readyBtn.addEventListener("click", function () {
  send({ _tag: "Ready" });
});

startBtn.addEventListener("click", function () {
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
