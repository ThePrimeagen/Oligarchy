const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Oligarchy</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        background: #111;
        color: #f5f5f5;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
      }

      main {
        padding: 3rem;
        border: 1px solid #333;
        border-radius: 0.75rem;
        background: #181818;
        text-align: center;
      }

      p {
        margin: 0 0 0.75rem;
        color: #999;
        font-size: 0.75rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2.5rem, 8vw, 5rem);
      }
    </style>
  </head>
  <body>
    <main>
      <p>Oligarchy dashboard</p>
      <h1>Hello world</h1>
    </main>
  </body>
</html>`;

export default {
  fetch() {
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  },
};
