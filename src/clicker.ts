export const clickerPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>clicker</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        user-select: none;
      }
      :root {
        --size: 80px;
      }
      #blue {
        position: absolute;
        left: var(--size);
        top: 0;
        z-index: 1;
        display: grid;
        place-items: center;
        width: var(--size);
        height: var(--size);
        background: blue;
        color: #fff;
        cursor: pointer;
        font: 32px/1 sans-serif;
      }
      #red {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 2;
        width: var(--size);
        height: var(--size);
        background: red;
        cursor: grab;
        touch-action: none;
      }
      #red:active {
        cursor: grabbing;
      }
      #target {
        position: absolute;
        right: 10px;
        bottom: 10px;
        z-index: 0;
        box-sizing: border-box;
        width: calc(var(--size) * 2);
        height: calc(var(--size) * 2);
        border: 2px dashed #000;
      }
      #target.in {
        background: purple;
        border-color: purple;
      }
    </style>
  </head>
  <body>
    <div id="blue">0</div>
    <div id="target"></div>
    <div id="red"></div>
    <script>
      const blue = document.getElementById("blue");
      const red = document.getElementById("red");
      const target = document.getElementById("target");
      const size = red.offsetWidth;
      let x = 0;
      let y = 0;
      let grabX = 0;
      let grabY = 0;
      let dragging = false;

      function contained() {
        const r = red.getBoundingClientRect();
        const t = target.getBoundingClientRect();
        return r.left >= t.left && r.top >= t.top && r.right <= t.right && r.bottom <= t.bottom;
      }

      function place(nextX, nextY) {
        x = Math.min(Math.max(0, nextX), innerWidth - size);
        y = Math.min(Math.max(0, nextY), innerHeight - size);
        red.style.left = x + "px";
        red.style.top = y + "px";
        target.classList.toggle("in", contained());
      }

      blue.addEventListener("click", () => {
        blue.textContent = String(Number(blue.textContent) + 1);
      });

      red.addEventListener("pointerdown", (event) => {
        dragging = true;
        red.setPointerCapture(event.pointerId);
        grabX = event.clientX - x;
        grabY = event.clientY - y;
      });

      red.addEventListener("pointermove", (event) => {
        if (!dragging) {
          return;
        }
        place(event.clientX - grabX, event.clientY - grabY);
      });

      red.addEventListener("pointerup", () => {
        dragging = false;
      });

      red.addEventListener("pointercancel", () => {
        dragging = false;
      });

      addEventListener("resize", () => {
        place(x, y);
      });
    </script>
  </body>
</html>
`;
