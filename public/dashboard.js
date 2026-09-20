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
    const match = needle === "" || item.textContent.toLowerCase().includes(needle);
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
