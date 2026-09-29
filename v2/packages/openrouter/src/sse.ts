// Server-sent events, from text as it arrives. A comment line and the event and id fields are
// dropped; a retry field is handed on as it is read, since a chat completion never sends one.
export type Event = { readonly kind: "data"; readonly data: string } | { readonly kind: "retry" };

export type Parser = { readonly feed: (text: string) => ReadonlyArray<Event> };

const LINE_END = /\r\n|\r|\n/;

export const parser = (): Parser => {
  let buffer = "";
  let data: Array<string> = [];

  const line = (text: string, events: Array<Event>): void => {
    if (text === "") {
      if (data.length > 0) {
        events.push({ kind: "data", data: data.join("\n") });
      }
      data = [];
      return;
    }
    if (text.startsWith(":")) {
      return;
    }
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? "" : text.slice(colon + 1).replace(/^ /, "");
    if (field === "data") {
      data.push(value);
    } else if (field === "retry") {
      events.push({ kind: "retry" });
    }
  };

  return {
    feed: (text) => {
      buffer += text;
      const events: Array<Event> = [];
      for (let end = LINE_END.exec(buffer); end !== null; end = LINE_END.exec(buffer)) {
        // A "\r" that ends what has arrived may be the first half of a "\r\n".
        if (end[0] === "\r" && end.index === buffer.length - 1) {
          break;
        }
        line(buffer.slice(0, end.index), events);
        buffer = buffer.slice(end.index + end[0].length);
      }
      return events;
    },
  };
};
