import { imageSize } from "image-size";
import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";
import type * as Types from "./types.ts";

export const Content = z.union([z.string(), z.array(z.json()), z.record(z.string(), z.json())]);
const Instructions = z.union([
  z.string().trim().min(1),
  z.array(z.json()),
  z.record(z.string(), z.json()),
]);
const Question = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("noul"),
      instructions: Instructions,
      criteria: z.object({ true: Content.optional(), false: Content.optional() }).optional(),
    }),
    z.object({
      type: z.literal("choice"),
      instructions: Instructions,
      criteria: z.record(z.string().min(1), Content.nullable()).refine((value) => {
        const count = Object.keys(value).length;
        return count >= 2 && count <= 255;
      }, "choice needs 2 to 255 options"),
    }),
    z.object({
      type: z.literal("score"),
      instructions: Instructions,
      criteria: z.array(Content).min(2).max(10),
    }),
  ])
  .transform((question): Types.Question => {
    if (question.type !== "noul") return question;
    const criteria = question.criteria;
    return {
      type: question.type,
      instructions: question.instructions,
      ...(criteria === undefined
        ? {}
        : {
            criteria: {
              ...(criteria.true === undefined ? {} : { true: criteria.true }),
              ...(criteria.false === undefined ? {} : { false: criteria.false }),
            },
          }),
    };
  });

const ImageType = z.enum(["image/png", "image/jpeg", "image/webp"]);
const Input = z.object({
  model: z.enum(["clef", "clef-flash"]),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(2 ** 31 - 1),
  state: z.json(),
  questions: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), Question).refine((value) => {
    const count = Object.keys(value).length;
    return count >= 1 && count <= 64;
  }, "supply 1 to 64 questions"),
  images: z
    .array(
      z.union([
        z.object({ contentType: ImageType, bytes: z.instanceof(Uint8Array) }),
        z.object({ dataUrl: z.string() }),
      ]),
    )
    .max(4)
    .optional(),
});

const MIB = 1024 * 1024;

// Check before z.json traverses: cycles and values JSON.stringify silently changes
// must be refused, not sent as a different state. Shared subobjects are allowed.
const assertJson = (value: unknown, parents = new Set<object>()): void => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null) {
    throw new Errors.InvalidRequest("state and questions must contain only JSON values");
  }
  if (parents.has(value))
    throw new Errors.InvalidRequest("state and questions must not contain cycles");
  // Zod record parsing omits this key. Refuse it before parsing so a typed
  // question or a piece of state can never silently disappear.
  if (Object.hasOwn(value, "__proto__"))
    throw new Errors.InvalidRequest("JSON key __proto__ is not supported");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Errors.InvalidRequest("state and questions must contain plain JSON objects");
  }
  parents.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value))
    assertJson(child, parents);
  parents.delete(value);
};

const encodeImage = (
  image:
    | { readonly contentType: Types.ImageType; readonly bytes: Uint8Array }
    | { readonly dataUrl: string },
): { content_type: Types.ImageType; base64: string; size: number } => {
  let bytes: Uint8Array;
  let contentType: Types.ImageType;
  if ("bytes" in image) {
    bytes = image.bytes;
    contentType = image.contentType;
  } else {
    // Bound allocation before decoding. Buffer's permissive base64 decoder alone
    // would silently accept malformed data URLs.
    if (image.dataUrl.length > Math.ceil((4 * MIB) / 3) * 4 + 64) {
      throw new Errors.InvalidRequest("an image exceeds 4 MiB");
    }
    const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      image.dataUrl,
    );
    const parsedType = ImageType.safeParse(matched?.[1]);
    const base64 = matched?.[2];
    if (!parsedType.success || base64 === undefined || base64.length === 0) {
      throw new Errors.InvalidRequest("supply an embedded PNG, JPEG, or WebP data URL");
    }
    bytes = Buffer.from(base64, "base64");
    if (Buffer.from(bytes).toString("base64") !== base64) {
      throw new Errors.InvalidRequest("image data URL has invalid base64");
    }
    contentType = parsedType.data;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 4 * MIB) {
    throw new Errors.InvalidRequest("each image must contain 1 byte to 4 MiB");
  }
  // Header validation establishes format and dimensions. Cloudflare decodes the
  // complete image and may still refuse corrupt pixel data.
  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw new Errors.InvalidRequest("image header could not be read");
  }
  const detected = dimensions.type === "jpg" ? "image/jpeg" : `image/${dimensions.type}`;
  if (detected !== contentType)
    throw new Errors.InvalidRequest("image bytes do not match contentType");
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > 16_000_000
  ) {
    throw new Errors.InvalidRequest("each image must have 1 to 16 million pixels");
  }
  return {
    content_type: contentType,
    base64: Buffer.from(bytes).toString("base64"),
    size: bytes.byteLength,
  };
};

export type Prepared = {
  readonly body: string;
  readonly model: Types.Model;
  readonly timeoutMs: number;
  readonly questions: Types.Questions;
};

export const prepare = (
  request: Types.Request,
  options: Types.Options,
): jarl.Result<Prepared, Errors.InvalidRequest> => {
  try {
    assertJson(request.state);
    assertJson(request.questions);
    const input = Input.safeParse({
      ...request,
      model: request.model ?? options.model ?? "clef",
      timeoutMs: request.timeoutMs ?? options.timeoutMs ?? 10_000,
    });
    if (!input.success) return jarl.err(new Errors.InvalidRequest(input.error.message));
    if (!/^[a-f0-9]{32}$/i.test(options.accountId))
      return jarl.err(
        new Errors.InvalidRequest(
          "accountId must be a 32-character hexadecimal Cloudflare account ID",
        ),
      );
    const { model, state, questions, timeoutMs } = input.data;
    const images = (input.data.images ?? []).map(encodeImage);
    if (images.reduce((sum, image) => sum + image.size, 0) > 8 * MIB) {
      return jarl.err(new Errors.InvalidRequest("images exceed 8 MiB combined"));
    }
    const body = JSON.stringify({
      model,
      state,
      questions,
      ...(images.length === 0
        ? {}
        : { images: images.map(({ content_type, base64 }) => ({ content_type, base64 })) }),
    });
    if (Buffer.byteLength(body) > 13 * MIB)
      return jarl.err(new Errors.InvalidRequest("request exceeds 13 MiB"));
    return jarl.ok({ body, model, timeoutMs, questions });
  } catch (error) {
    if (jarl.error.is(error, Errors.InvalidRequest)) return jarl.err(error);
    return jarl.err(new Errors.InvalidRequest("request could not be serialized as JSON"));
  }
};
