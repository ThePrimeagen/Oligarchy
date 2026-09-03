export class JSONStreamParser {
  private buf = "";

  push(input: string): void {
    this.buf += input;
  }

  pull(): QemuResponse | undefined {
    const out = this.next();
    if (out === undefined) {
      return undefined;
    }
    return JSON.parse(out) as QemuResponse;
  }

  private next(): string | undefined {
    const start = this.buf.indexOf("{");
    if (start < 0) {
      return undefined;
    }
    let depth = 0;
    // Braces inside JSON string values must not move the depth, or a QMP error
    // whose desc quotes a brace (e.g. a rejected key token) mis-frames the reply.
    let inString = false;
    let escaped = false;
    for (let i = start; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const substr = this.buf.slice(start, i + 1);
          this.buf = this.buf.slice(i + 1);
          return substr;
        }
      }
    }
    return undefined;
  }
}
