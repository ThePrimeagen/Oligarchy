import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// public/dashboard.js refreshes the pills on the page. The unit project has no DOM, so this is the
// part that refresh uses: an element, IntersectionObserver, fetch, and a clock the test moves.
class ClassList {
  private readonly element: Element;

  constructor(element: Element) {
    this.element = element;
  }

  add(name: string): void {
    const names = this.element.className.split(" ").filter((item) => item !== "");
    if (!names.includes(name)) {
      names.push(name);
    }
    this.element.className = names.join(" ");
  }

  remove(name: string): void {
    this.element.className = this.element.className
      .split(" ")
      .filter((item) => item !== name)
      .join(" ");
  }

  contains(name: string): boolean {
    return this.element.className.split(" ").includes(name);
  }
}

class Element {
  readonly tag: string;
  className: string;
  readonly children: Element[] = [];
  parent: Element | null = null;
  hidden = false;
  text = "";
  readonly dataset: Record<string, string> = {};
  readonly classList: ClassList;

  constructor(tag: string, className = "") {
    this.tag = tag;
    this.className = className;
    this.classList = new ClassList(this);
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

  addEventListener(): void {}

  replaceWith(next: Element): void {
    const parent = this.parent;
    if (parent === null) {
      return;
    }
    const index = parent.children.indexOf(this);
    next.parent = parent;
    parent.children.splice(index, 1, next);
    this.parent = null;
  }

  matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      return this.className.split(" ").includes(selector.slice(1));
    }
    return this.tag === selector;
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

class IntersectionObserver {
  readonly targets: Element[] = [];
  private readonly callback: (
    entries: ReadonlyArray<{
      readonly target: Element;
      readonly isIntersecting: boolean;
    }>,
  ) => void;

  constructor(
    callback: (
      entries: ReadonlyArray<{
        readonly target: Element;
        readonly isIntersecting: boolean;
      }>,
    ) => void,
  ) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    const index = this.targets.indexOf(target);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
  }

  fire(
    entries: ReadonlyArray<{ readonly target: Element; readonly isIntersecting: boolean }>,
  ): void {
    this.callback(entries);
  }
}

class DOMParser {
  parseFromString(text: string): { querySelectorAll(selector: string): Element[] } {
    const root = new Element("body");
    for (const match of text.matchAll(
      /<div class="definition-history" data-name="([^"]*)">([\s\S]*?)<\/div>/g,
    )) {
      const node = new Element("div", "definition-history");
      node.dataset.name = match[1] ?? "";
      node.text = match[2] ?? "";
      root.append(node);
    }
    return { querySelectorAll: (selector) => root.querySelectorAll(selector) };
  }
}

const script = readFileSync("public/dashboard.js", "utf8");

type Boot = {
  readonly document: Element;
  readonly rows: ReadonlyArray<Element>;
  readonly fetches: string[];
  readonly intervals: Array<{ readonly fn: () => void; readonly ms: number }>;
  readonly observers: IntersectionObserver[];
  readonly resolve: (value: { ok: boolean; text: () => Promise<string> }) => void;
  now: number;
};

const row = (name: string, text: string): Element => {
  const item = new Element("li");
  const link = new Element("a");
  link.text = name;
  const history = new Element("div", "definition-history");
  history.dataset.name = name;
  history.text = text;
  item.append(link, history);
  return history;
};

const boot = (names: ReadonlyArray<string>, observer: boolean): Boot => {
  const document = new Element("document");
  const list = new Element("ul", "definition-list");
  const rows = names.map((name) => row(name, `old ${name}`));
  for (const history of rows) {
    const item = history.parent;
    if (item !== null) {
      list.append(item);
    }
  }
  document.append(list);
  const fetches: string[] = [];
  const intervals: Array<{ readonly fn: () => void; readonly ms: number }> = [];
  const observers: IntersectionObserver[] = [];
  const pending: Array<(value: { ok: boolean; text: () => Promise<string> }) => void> = [];
  const state = { now: 1_000_000 };
  const context: Record<string, unknown> = {
    document,
    Element,
    DOMParser,
    fetch: (url: string) => {
      fetches.push(url);
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    },
    Date: { now: () => state.now },
    setInterval: (fn: () => void, ms: number) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    encodeURIComponent,
    Array,
    Error,
    Promise,
    Set,
    Number,
    String,
  };
  if (observer) {
    context.IntersectionObserver = class extends IntersectionObserver {
      constructor(
        callback: (
          entries: ReadonlyArray<{
            readonly target: Element;
            readonly isIntersecting: boolean;
          }>,
        ) => void,
      ) {
        super(callback);
        observers.push(this);
      }
    };
  }
  vm.runInContext(script, vm.createContext(context), { filename: "public/dashboard.js" });
  return {
    document,
    rows,
    fetches,
    intervals,
    observers,
    resolve: (value) => {
      const pendingResolve = pending.shift();
      if (pendingResolve === undefined) {
        throw new Error("no history fetch is waiting");
      }
      pendingResolve(value);
    },
    get now() {
      return state.now;
    },
    set now(value: number) {
      state.now = value;
    },
  };
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

const answer = (name: string, body: string) => ({
  ok: true,
  text: () => Promise.resolve(`<div class="definition-history" data-name="${name}">${body}</div>`),
});

describe("dashboard.js definition histories happy path", () => {
  it("refreshes only the rows on screen once a minute, and covers them while that is in flight", async () => {
    const page = boot(["install", "lock-screen", "wide layout"], true);
    expect(page.intervals).toEqual([{ fn: expect.any(Function), ms: 60_000 }]);
    expect(page.fetches).toEqual([]);
    expect(page.rows[1]?.dataset.updated).toBe("1000000");
    const observer = page.observers[0];
    expect(observer).toBeDefined();
    observer?.fire([
      { target: page.rows[0], isIntersecting: false },
      { target: page.rows[1], isIntersecting: true },
      { target: page.rows[2], isIntersecting: true },
    ]);
    expect(page.fetches).toEqual([]);

    page.now += 60_000;
    page.intervals[0]?.fn();
    expect(page.fetches).toEqual(["/definitions/histories?name=lock-screen&name=wide%20layout"]);
    expect(page.rows[1]?.classList.contains("definition-history--loading")).toBe(true);
    expect(page.rows[0]?.classList.contains("definition-history--loading")).toBe(false);
    page.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          '<div class="definition-history" data-name="lock-screen">16 out of 17</div><div class="definition-history" data-name="wide layout">next</div>',
        ),
    });
    await settle();
    const list = page.document.querySelectorAll("ul")[0];
    const histories = list?.querySelectorAll(".definition-history") ?? [];
    const lock = histories.find((item) => item.dataset.name === "lock-screen");
    const wide = histories.find((item) => item.dataset.name === "wide layout");
    expect(lock?.textContent).toBe("16 out of 17");
    expect(lock?.dataset.updated).toBe("1060000");
    expect(lock?.classList.contains("definition-history--loading")).toBe(false);
    expect(wide?.textContent).toBe("next");
    expect(histories.filter((item) => item.dataset.name === "lock-screen")).toHaveLength(1);

    page.now += 60_000;
    page.intervals[0]?.fn();
    expect(page.fetches).toEqual([
      "/definitions/histories?name=lock-screen&name=wide%20layout",
      "/definitions/histories?name=lock-screen&name=wide%20layout",
    ]);
  });

  it("refreshes a row that scrolls into view once that row is older than a minute", async () => {
    const page = boot(["install", "lock-screen"], true);
    const observer = page.observers[0];
    observer?.fire([{ target: page.rows[0], isIntersecting: true }]);
    expect(page.fetches).toEqual([]);
    page.now += 60_000;
    observer?.fire([{ target: page.rows[1], isIntersecting: true }]);
    expect(page.fetches).toEqual(["/definitions/histories?name=lock-screen"]);
    page.resolve(answer("lock-screen", "fresh"));
    await settle();
    const histories = page.document.querySelectorAll(".definition-history");
    expect(histories.find((item) => item.dataset.name === "install")?.textContent).toBe(
      "old install",
    );
    expect(histories.find((item) => item.dataset.name === "lock-screen")?.textContent).toBe(
      "fresh",
    );
  });
});

describe("dashboard.js definition histories unhappy path", () => {
  it("drops the loading cover and keeps the pills when the refresh fails", async () => {
    const page = boot(["lock-screen"], true);
    page.observers[0]?.fire([{ target: page.rows[0], isIntersecting: true }]);
    page.now += 60_000;
    page.intervals[0]?.fn();
    expect(page.rows[0]?.classList.contains("definition-history--loading")).toBe(true);
    page.resolve({ ok: false, text: () => Promise.resolve("<p>error: internal error</p>") });
    await settle();
    expect(page.rows[0]?.parent).not.toBeNull();
    expect(page.rows[0]?.textContent).toBe("old lock-screen");
    expect(page.rows[0]?.classList.contains("definition-history--loading")).toBe(false);
  });

  it("does not fetch a row that was refreshed less than a minute ago, or one already in flight", async () => {
    const page = boot(["lock-screen"], true);
    page.observers[0]?.fire([{ target: page.rows[0], isIntersecting: true }]);
    page.now += 59_999;
    page.intervals[0]?.fn();
    expect(page.fetches).toEqual([]);

    page.now += 1;
    page.intervals[0]?.fn();
    expect(page.fetches).toEqual(["/definitions/histories?name=lock-screen"]);
    page.intervals[0]?.fn();
    expect(page.fetches).toEqual(["/definitions/histories?name=lock-screen"]);
    page.resolve(answer("lock-screen", "fresh"));
    await settle();
    page.intervals[0]?.fn();
    expect(page.fetches).toHaveLength(1);
  });

  it("stamps the rows and does not poll when the page cannot tell what is on screen", () => {
    const page = boot(["lock-screen"], false);
    expect(page.intervals).toEqual([]);
    expect(page.fetches).toEqual([]);
    expect(page.observers).toEqual([]);
    expect(page.rows[0]?.dataset.updated).toBe("1000000");
  });
});
