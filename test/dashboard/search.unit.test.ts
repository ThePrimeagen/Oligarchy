import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// public/dashboard.js is the page script, and the unit project has no DOM. This is the part it
// uses: an element, its descendants, and document as the listener.
class Element {
  readonly tag: string;
  readonly className: string;
  readonly children: Element[] = [];
  parent: Element | null = null;
  hidden = false;
  text = "";
  value = "";
  defaultValue = "";
  disabled = false;
  type = "";
  private readonly listeners: Record<string, Array<(event: { target: unknown }) => void>> = {};

  constructor(tag: string, className = "") {
    this.tag = tag;
    this.className = className;
  }

  append(...nodes: Element[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  get textContent(): string {
    return this.children.length === 0
      ? this.text
      : this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.text = value;
  }

  addEventListener(type: string, handler: (event: { target: unknown }) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  dispatch(type: string, target: Element): void {
    for (const handler of this.listeners[type] ?? []) {
      handler({ target });
    }
  }

  matches(selector: string): boolean {
    if (selector === "search") {
      return this.tag === "search";
    }
    if (selector === "form.definition__form") {
      return this.tag === "form" && this.className === "definition__form";
    }
    if (selector === "input[type=search]") {
      return this.tag === "input" && this.type === "search";
    }
    if (selector === "textarea") {
      return this.tag === "textarea";
    }
    if (selector === "button[type=submit]") {
      return this.tag === "button" && this.type === "submit";
    }
    if (selector === "li") {
      return this.tag === "li";
    }
    if (selector === "code") {
      return this.tag === "code";
    }
    if (selector === ".definition-list") {
      return this.className === "definition-list";
    }
    if (selector === ".definition-miss") {
      return this.className === "definition-miss";
    }
    return false;
  }

  closest(selector: string): Element | null {
    if (this.matches(selector)) {
      return this;
    }
    return this.parent === null ? null : this.parent.closest(selector);
  }

  querySelector(selector: string): Element | null {
    const [found] = this.querySelectorAll(selector);
    return found ?? null;
  }

  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const document = new Element("document");
vm.runInContext(
  readFileSync("public/dashboard.js", "utf8"),
  vm.createContext({ document, Element }),
  {
    filename: "public/dashboard.js",
  },
);

const names = (list: Element): Array<{ readonly name: string; readonly hidden: boolean }> =>
  list.querySelectorAll("li").map((item) => ({ name: item.textContent, hidden: item.hidden }));

const index = (): { readonly input: Element; readonly list: Element; readonly miss: Element } => {
  const search = new Element("search");
  const input = new Element("input");
  input.type = "search";
  search.append(input);
  const list = new Element("ul", "definition-list");
  for (const name of ["install", "lock-screen"]) {
    const item = new Element("li");
    const link = new Element("a");
    link.text = name;
    item.append(link);
    list.append(item);
  }
  const miss = new Element("p", "definition-miss");
  miss.hidden = true;
  miss.append(new Element("code"));
  document.children.length = 0;
  document.append(search, list, miss);
  return { input, list, miss };
};

describe("dashboard.js definition search happy path", () => {
  it("narrows the names as the box is typed, ignoring case, and a blank box is every name", () => {
    const { input, list, miss } = index();
    input.value = "LOCK";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "install", hidden: true },
      { name: "lock-screen", hidden: false },
    ]);
    expect(miss.hidden).toBe(true);

    input.value = "   ";
    document.dispatch("input", input);
    expect(names(list).every((item) => !item.hidden)).toBe(true);
    expect(miss.hidden).toBe(true);
  });

  it("brings the names back when the box is cleared", () => {
    const { input, list, miss } = index();
    input.value = "lock";
    document.dispatch("input", input);
    expect(names(list)[0]).toEqual({ name: "install", hidden: true });
    input.value = "";
    document.dispatch("input", input);
    expect(names(list).every((item) => !item.hidden)).toBe(true);
    expect(miss.hidden).toBe(true);
  });
});

describe("dashboard.js definition search unhappy path", () => {
  it("says nothing matches, and the query is text rather than markup", () => {
    const { input, list, miss } = index();
    input.value = "<script>";
    document.dispatch("input", input);
    expect(names(list).every((item) => item.hidden)).toBe(true);
    expect(miss.hidden).toBe(false);
    const code = miss.querySelector("code");
    expect(code?.textContent).toBe("<script>");
    expect(code?.children).toEqual([]);
  });

  it("does nothing on a page that has no list", () => {
    const search = new Element("search");
    const input = new Element("input");
    input.type = "search";
    input.value = "lock";
    search.append(input);
    document.children.length = 0;
    document.append(search);
    expect(() => document.dispatch("input", input)).not.toThrow();
  });
});

describe("dashboard.js update button", () => {
  it("enables a definition's update once a field differs from the wording it was rendered with", () => {
    const form = new Element("form", "definition__form");
    const field = new Element("textarea");
    field.defaultValue = "second";
    field.value = "second edited";
    const button = new Element("button");
    button.type = "submit";
    button.disabled = true;
    form.append(field, button);
    document.children.length = 0;
    document.append(form);
    document.dispatch("input", field);
    expect(button.disabled).toBe(false);
  });

  it("leaves the update disabled when the wording is unchanged", () => {
    const form = new Element("form", "definition__form");
    const field = new Element("textarea");
    field.defaultValue = "second";
    field.value = "second";
    const button = new Element("button");
    button.type = "submit";
    button.disabled = true;
    form.append(field, button);
    document.children.length = 0;
    document.append(form);
    document.dispatch("input", field);
    expect(button.disabled).toBe(true);
  });
});
