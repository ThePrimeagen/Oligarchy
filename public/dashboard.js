// Every name is already on the page — tests are rarely added — so finding and sorting
// stay here. Nothing is requested again. A blank box is every name, A to Z. Typed text is
// a case-insensitive fuzzy match: words split on whitespace, and each word's characters
// must occur in order, not necessarily together. The list is reordered by score, highest
// first. The query is written as text, so it cannot become markup. A page with no list is
// left alone.
//
// Letters that all occur, and none of them touch, are worth one each: the amount typed.
// A letter that touches the previous match is worth twice that previous letter, so a
// contiguous "lock" is 1 + 2 + 4 + 8. A gap starts the doubling over at 1. The score kept
// is the alignment that sums highest; words add. -1 is no match; an empty query is 0, so
// the names fall through to alphabetical order.
const scoreRun = (word, text) => {
  let paths = [];
  for (let at = 0; at < text.length; at++) {
    if (text[at] === word[0]) {
      paths.push({ at, total: 1, last: 1 });
    }
  }
  if (paths.length === 0) {
    return -1;
  }
  for (let index = 1; index < word.length; index++) {
    const next = [];
    for (let at = 0; at < text.length; at++) {
      if (text[at] !== word[index]) {
        continue;
      }
      // A path that has kept doubling can be tied with, or behind, one that reset.
      // The next letter still prefers the doubled step, so both stay.
      const bestByLast = new Map();
      for (const path of paths) {
        if (path.at >= at) {
          continue;
        }
        const step = path.at + 1 === at ? path.last * 2 : 1;
        const total = path.total + step;
        const kept = bestByLast.get(step);
        if (kept === undefined || total > kept) {
          bestByLast.set(step, total);
        }
      }
      for (const [last, total] of bestByLast) {
        next.push({ at, total, last });
      }
    }
    if (next.length === 0) {
      return -1;
    }
    paths = next;
  }
  let best = -1;
  for (const path of paths) {
    if (path.total > best) {
      best = path.total;
    }
  }
  return best;
};

const scoreDefinition = (query, name) => {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const text = name.toLowerCase();
  if (words.length === 0) {
    return 0;
  }
  let score = 0;
  for (const word of words) {
    const wordScore = scoreRun(word, text);
    if (wordScore < 0) {
      return -1;
    }
    score += wordScore;
  }
  return score;
};

const narrowDefinitions = (target) => {
  if (!(target instanceof Element) || target.closest("search") === null) {
    return;
  }
  const list = document.querySelector(".definition-list");
  if (list === null) {
    return;
  }
  // The rate and the pills sit on the same line, and a pill is its own link. The query is
  // the name, the first link, not a count or a status.
  const ranked = [...list.querySelectorAll("li")].map((item) => {
    const link = item.querySelector("a");
    const name = link === null ? "" : link.textContent;
    return { item, name, score: scoreDefinition(target.value, name) };
  });
  ranked.sort((left, right) => {
    const leftMiss = left.score < 0;
    const rightMiss = right.score < 0;
    if (leftMiss !== rightMiss) {
      return leftMiss ? 1 : -1;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return (
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
      left.name.localeCompare(right.name, "en")
    );
  });
  let shown = 0;
  for (const row of ranked) {
    row.item.hidden = row.score < 0;
    if (row.score >= 0) {
      shown += 1;
    }
    list.appendChild(row.item);
  }
  const miss = document.querySelector(".definition-miss");
  miss.querySelector("code").textContent = target.value.trim();
  miss.hidden = shown > 0;
};

document.addEventListener("input", (event) => {
  narrowDefinitions(event.target);
});

// defer runs before DOMContentLoaded, so this orders the list on open, before a keystroke.
document.addEventListener("DOMContentLoaded", () => {
  const search = document.querySelector("search");
  if (search === null) {
    return;
  }
  const input = search.querySelector("input[type=search]");
  if (input !== null) {
    narrowDefinitions(input);
  }
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
