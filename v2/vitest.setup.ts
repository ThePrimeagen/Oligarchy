import { afterEach, beforeEach, vi } from "vitest";

// Database transports need real I/O scheduling. Every test has a fake wall clock;
// tests exercising delays and deadlines also enable the timer APIs locally.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
