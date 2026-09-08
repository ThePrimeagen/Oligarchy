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
