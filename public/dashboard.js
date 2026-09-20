// Definitions do not change while the index is open, so the search narrows the list that was
// rendered. A blank box is every name; otherwise a case-insensitive substring of the name.
// The query is written as text, so it cannot become markup. A page with no list is left alone.
const narrowDefinitions = (target) => {
  if (!(target instanceof Element) || target.closest("search") === null) {
    return;
  }
  const list = document.querySelector(".definition-list");
  if (list === null) {
    return;
  }
  const needle = target.value.trim().toLowerCase();
  let shown = 0;
  for (const item of list.querySelectorAll("li")) {
    // The rate and the pills sit on the same line. The query is the name, not "out of" or a count.
    const name = item.querySelector("a");
    const text = name === null ? "" : name.textContent;
    const match = needle === "" || text.toLowerCase().includes(needle);
    item.hidden = !match;
    if (match) {
      shown += 1;
    }
  }
  const miss = document.querySelector(".definition-miss");
  miss.querySelector("code").textContent = target.value.trim();
  miss.hidden = shown > 0;
};

document.addEventListener("input", (event) => {
  narrowDefinitions(event.target);
});

// A definition's update button is handed over disabled and enabled here once a field differs from
// the wording the page was rendered with (a textarea's default value): an unchanged wording is not
// an update. Delegated from the document so it holds across the page's htmx swaps.
document.addEventListener("input", (event) => {
  const form = event.target instanceof Element ? event.target.closest("form.definition__form") : null;
  if (form === null) {
    return;
  }
  const changed = [...form.querySelectorAll("textarea")].some(
    (field) => field.value !== field.defaultValue,
  );
  form.querySelector("button[type=submit]").disabled = !changed;
});

// The strip beside a name is as fresh as the page until this reads it again. Once a minute, the
// rows on screen are fetched. A row that scrolls into view is fetched then too, if its last read
// is already a minute old. The cover stays up for the fetch, so what is on screen is not a strip
// that has already gone out of date. A failed read takes the cover off and leaves the old strip.
const HISTORY_MS = 60_000;

const staleHistory = (node, now) => {
  const updated = Number(node.dataset.updated);
  return !Number.isFinite(updated) || now - updated >= HISTORY_MS;
};

const watchDefinitionHistories = () => {
  const rows = [...document.querySelectorAll(".definition-history")];
  if (rows.length === 0) {
    return;
  }
  const stamped = Date.now();
  for (const row of rows) {
    if (row.dataset.updated === undefined || row.dataset.updated === "") {
      row.dataset.updated = String(stamped);
    }
  }
  if (typeof IntersectionObserver !== "function") {
    return;
  }
  const inflight = new Set();
  const visible = new Set();
  const refreshHistories = async (nodes) => {
    const due = [];
    for (const node of nodes) {
      const name = node.dataset.name;
      const item = node.closest("li");
      if (name === undefined || name === "" || inflight.has(name)) {
        continue;
      }
      if (item !== null && item.hidden) {
        continue;
      }
      due.push(node);
    }
    if (due.length === 0) {
      return;
    }
    for (const node of due) {
      inflight.add(node.dataset.name);
      node.classList.add("definition-history--loading");
    }
    try {
      const response = await fetch(
        "/definitions/histories?" +
          due.map((node) => "name=" + encodeURIComponent(node.dataset.name)).join("&"),
      );
      if (!response.ok) {
        throw new Error("histories");
      }
      const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
      const nextRows = [...parsed.querySelectorAll(".definition-history")];
      for (const node of due) {
        const next = nextRows.find((item) => item.dataset.name === node.dataset.name);
        if (next === undefined) {
          node.classList.remove("definition-history--loading");
          continue;
        }
        node.replaceWith(next);
        visible.delete(node);
        visible.add(next);
        observer.unobserve(node);
        observer.observe(next);
        next.dataset.updated = String(Date.now());
      }
    } catch {
      // parent is not a DOM property. A failed read leaves the row in place, so the cover
      // always comes off here; replacing the row is the success path only.
      for (const node of due) {
        node.classList.remove("definition-history--loading");
      }
    } finally {
      for (const node of due) {
        inflight.delete(node.dataset.name);
      }
    }
  };
  const observer = new IntersectionObserver((entries) => {
    const now = Date.now();
    const due = [];
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visible.add(entry.target);
        if (staleHistory(entry.target, now)) {
          due.push(entry.target);
        }
      } else {
        visible.delete(entry.target);
      }
    }
    if (due.length > 0) {
      refreshHistories(due);
    }
  });
  for (const row of rows) {
    observer.observe(row);
  }
  setInterval(() => {
    const now = Date.now();
    const due = [...visible].filter((row) => staleHistory(row, now));
    if (due.length > 0) {
      refreshHistories(due);
    }
  }, HISTORY_MS);
};

watchDefinitionHistories();
