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
      this.appendChild(node);
    }
  }

  // The search reorders the list. appendChild moves a node that already has a parent.
  appendChild(node: Element): Element {
    if (node.parent !== null) {
      const index = node.parent.children.indexOf(node);
      if (index >= 0) {
        node.parent.children.splice(index, 1);
      }
    }
    node.parent = this;
    this.children.push(node);
    return node;
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
    if (selector === "a") {
      return this.tag === "a";
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

const index = (
  labels: ReadonlyArray<string> = ["install", "lock-screen"],
): { readonly input: Element; readonly list: Element; readonly miss: Element } => {
  const search = new Element("search");
  const input = new Element("input");
  input.type = "search";
  search.append(input);
  const list = new Element("ul", "definition-list");
  for (const name of labels) {
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
  it("narrows the names as the box is typed, ignoring case, and puts the matches first", () => {
    const { input, list, miss } = index();
    input.value = "LOCK";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "lock-screen", hidden: false },
      { name: "install", hidden: true },
    ]);
    expect(miss.hidden).toBe(true);
  });

  it("matches the name and not the rate or a later pill drawn on the same line", () => {
    const { input, list, miss } = index();
    const item = list.querySelectorAll("li")[1];
    const rate = new Element("span", "definition-rate");
    rate.text = "15 out of 17";
    const pill = new Element("a");
    pill.text = "passed";
    item?.append(rate, pill);
    input.value = "out";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "install", hidden: true },
      { name: "lock-screen15 out of 17passed", hidden: true },
    ]);
    expect(miss.hidden).toBe(false);

    input.value = "pass";
    document.dispatch("input", input);
    expect(names(list).every((entry) => entry.hidden)).toBe(true);
    expect(miss.hidden).toBe(false);

    input.value = "LOCK";
    document.dispatch("input", input);
    expect(names(list)[0]).toEqual({ name: "lock-screen15 out of 17passed", hidden: false });
    expect(names(list)[1]).toEqual({ name: "install", hidden: true });
    expect(miss.hidden).toBe(true);
  });

  it("finds a name from letters in order that are not a contiguous substring", () => {
    const { input, list, miss } = index(["install", "screen", "lock-screen"]);
    input.value = "lscr";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "lock-screen", hidden: false },
      { name: "install", hidden: true },
      { name: "screen", hidden: true },
    ]);
    expect(miss.hidden).toBe(true);
  });

  it("sorts a tighter, earlier match ahead of a scattered one, and ties by name", () => {
    const { input, list, miss } = index(["lock-screen", "scroll", "screen", "install"]);
    input.value = "scr";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "screen", hidden: false },
      { name: "scroll", hidden: false },
      { name: "lock-screen", hidden: false },
      { name: "install", hidden: true },
    ]);
    expect(miss.hidden).toBe(true);

    const ranked = index(["clock", "lock-screen"]);
    ranked.input.value = "lock";
    document.dispatch("input", ranked.input);
    expect(names(ranked.list)).toEqual([
      { name: "lock-screen", hidden: false },
      { name: "clock", hidden: false },
    ]);

    const tied = index(["alpine", "Alpha"]);
    tied.input.value = "alp";
    document.dispatch("input", tied.input);
    expect(names(tied.list)).toEqual([
      { name: "Alpha", hidden: false },
      { name: "alpine", hidden: false },
    ]);
  });

  it("sorts every name A to Z when the box is blank, whatever order the page was rendered in", () => {
    const { input, list, miss } = index(["lock-screen", "Zebra", "install", "alpha"]);
    input.value = "   ";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "alpha", hidden: false },
      { name: "install", hidden: false },
      { name: "lock-screen", hidden: false },
      { name: "Zebra", hidden: false },
    ]);
    expect(miss.hidden).toBe(true);
  });

  it("sorts the list when the page opens, before anyone types", () => {
    const { list } = index(["lock-screen", "install"]);
    document.dispatch("DOMContentLoaded", list);
    expect(names(list)).toEqual([
      { name: "install", hidden: false },
      { name: "lock-screen", hidden: false },
    ]);
  });

  it("requires every word, and the words may sit in either order", () => {
    const { input, list, miss } = index(["lock-screen", "clock", "screen-time"]);
    input.value = "screen lock";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "lock-screen", hidden: false },
      { name: "clock", hidden: true },
      { name: "screen-time", hidden: true },
    ]);
    expect(miss.hidden).toBe(true);

    input.value = "lock screen";
    document.dispatch("input", input);
    expect(
      names(list)
        .filter((item) => !item.hidden)
        .map((item) => item.name),
    ).toEqual(["lock-screen"]);
  });

  it("brings the names back, sorted, when the box is cleared", () => {
    const { input, list, miss } = index(["lock-screen", "install"]);
    input.value = "lock";
    document.dispatch("input", input);
    expect(names(list)[0]).toEqual({ name: "lock-screen", hidden: false });
    input.value = "";
    document.dispatch("input", input);
    expect(names(list)).toEqual([
      { name: "install", hidden: false },
      { name: "lock-screen", hidden: false },
    ]);
    expect(miss.hidden).toBe(true);
  });
});

describe("dashboard.js definition search unhappy path", () => {
  it("does not match characters that are out of order", () => {
    const { input, list, miss } = index(["lock-screen"]);
    input.value = "kcol";
    document.dispatch("input", input);
    expect(names(list)).toEqual([{ name: "lock-screen", hidden: true }]);
    expect(miss.hidden).toBe(false);
    expect(miss.querySelector("code")?.textContent).toBe("kcol");
  });

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
