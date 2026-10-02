import * as jarl from "jarl";
import * as z from "zod";

export type ProviderDetails = {
  readonly status?: number;
  readonly codes?: readonly (number | string)[];
  readonly retryAfter?: string;
};

export const InvalidRequest = jarl.error.define("DecisionApiInvalidRequest");
export type InvalidRequest = InstanceType<typeof InvalidRequest>;
export const InvalidResponse = jarl.error.define("DecisionApiInvalidResponse");
export type InvalidResponse = InstanceType<typeof InvalidResponse>;
export const Refused = jarl.error.define("DecisionApiRefused");
export type Refused = InstanceType<typeof Refused> & ProviderDetails;
export const RateLimited = jarl.error.define("DecisionApiRateLimited");
export type RateLimited = InstanceType<typeof RateLimited> & ProviderDetails;
export const Unavailable = jarl.error.define("DecisionApiUnavailable");
export type Unavailable = InstanceType<typeof Unavailable> & ProviderDetails;
export const TimedOut = jarl.error.define("DecisionApiTimedOut");
export type TimedOut = InstanceType<typeof TimedOut> & ProviderDetails;

const ProviderErrors = z.object({
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]), message: z.string() })),
});

// Preserve Cloudflare codes even when the failure arrives in a successful HTTP response.
export const providerFailure = (
  body: unknown,
  status?: number,
  retryAfter?: string,
): Refused | RateLimited | Unavailable | TimedOut => {
  const parsed = ProviderErrors.safeParse(body);
  const errors = parsed.success ? parsed.data.errors : [];
  const codes = errors.map((error) => error.code);
  const details: ProviderDetails = {
    codes,
    ...(status === undefined ? {} : { status }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
  const message =
    errors
      .map((error) => error.message)
      .join("; ")
      .slice(0, 1024) || "provider refused request";
  const named = (code: number) => codes.some((value) => String(value) === String(code));
  if (status === 429 || named(3036) || named(3040)) {
    return Object.assign(new RateLimited(message), details);
  }
  if (status === 408 || status === 504 || named(3007) || named(3008)) {
    return Object.assign(new TimedOut(message), details);
  }
  if (status !== undefined && status >= 500) {
    return Object.assign(new Unavailable(message), details);
  }
  return Object.assign(new Refused(message), details);
};

export const parseBody = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};
