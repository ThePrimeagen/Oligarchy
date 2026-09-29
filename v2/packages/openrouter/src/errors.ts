import * as jarl from "jarl";

// OpenRouter answered and refused the request: a 4xx other than 429. The message is the body's.
export class OpenRouterRefused extends jarl.error.define("OpenRouterRefused") {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`openrouter: ${String(status)}: ${message}`);
    this.status = status;
  }
}

// No completion came: nothing answered, the stream broke or was not a completion, or the provider
// failed in a way asking again will not mend.
export const OpenRouterUnreachable = jarl.error.define("OpenRouterUnreachable");
export type OpenRouterUnreachable = InstanceType<typeof OpenRouterUnreachable>;

// Asking again could have answered, but its wait would reach the request's deadline.
export const OpenRouterOutOfTime = jarl.error.define("OpenRouterOutOfTime");
export type OpenRouterOutOfTime = InstanceType<typeof OpenRouterOutOfTime>;

export const unreachable = (message: string, cause?: unknown): OpenRouterUnreachable => {
  const error = new OpenRouterUnreachable(message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
};
