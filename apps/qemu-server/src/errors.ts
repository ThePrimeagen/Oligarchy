import { Schema } from "effect";
import * as Domain from "@oligarchy/shared/domain";

export class QmpError extends Schema.TaggedError<QmpError>("@oligarchy/shared/errors/QmpError")(
  "QmpError",
  {
    command: Schema.String,
    class: Schema.String,
    desc: Schema.String,
    raw: Domain.QmpFailure,
  },
) {
  override get message(): string {
    return `${this.class}: ${this.desc}`;
  }
}

export class QmpTimeout extends Schema.TaggedError<QmpTimeout>(
  "@oligarchy/shared/errors/QmpTimeout",
)("QmpTimeout", { command: Schema.String }) {
  override get message(): string {
    return `qemu: ${this.command} timed out`;
  }
}

export class QmpClosed extends Schema.TaggedError<QmpClosed>("@oligarchy/shared/errors/QmpClosed")(
  "QmpClosed",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export class QmpProtocolError extends Schema.TaggedError<QmpProtocolError>(
  "@oligarchy/shared/errors/QmpProtocolError",
)("QmpProtocolError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

export class QemuStartError extends Schema.TaggedError<QemuStartError>(
  "@oligarchy/shared/errors/QemuStartError",
)("QemuStartError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

export class HostRequirementsMissing extends Schema.TaggedError<HostRequirementsMissing>(
  "@oligarchy/shared/errors/HostRequirementsMissing",
)("HostRequirementsMissing", { missing: Schema.Array(Schema.String) }) {
  override get message(): string {
    return `missing host requirements:\n${this.missing.join("\n")}`;
  }
}

export class IsoError extends Schema.TaggedError<IsoError>("@oligarchy/shared/errors/IsoError")(
  "IsoError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class KeysError extends Schema.TaggedError<KeysError>("@oligarchy/shared/errors/KeysError")(
  "KeysError",
  { message: Schema.String },
) {}
