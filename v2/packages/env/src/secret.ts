const REDACTED = "<redacted>";

export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  // Call it once, at the header or SDK that needs the text.
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
