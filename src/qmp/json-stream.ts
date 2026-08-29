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
    for (let i = start; i < this.buf.length; i++) {
      if (this.buf[i] === "{") {
        depth++;
      } else if (this.buf[i] === "}") {
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
