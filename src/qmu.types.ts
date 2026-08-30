export {};

declare global {
  type QemuErrorBody = {
    class: string;
    desc: string;
  };

  type QemuSuccessResponse = {
    return: unknown;
    id?: unknown;
  };

  type QemuErrorResponse = {
    error: QemuErrorBody;
    id?: unknown;
  };

  type QemuEventResponse = {
    event: string;
    data?: unknown;
    timestamp?: {
      seconds: number;
      microseconds: number;
    };
  };

  type QemuGreetingResponse = {
    QMP: {
      version: unknown;
      capabilities: unknown[];
    };
  };

  type QemuResponse =
    | QemuSuccessResponse
    | QemuErrorResponse
    | QemuEventResponse
    | QemuGreetingResponse;

  type QemuKeyValue = {
    type: "qcode" | "number";
    data: string | number;
  };

  type QemuCapabilitiesCommand = {
    execute: "qmp_capabilities";
    arguments: Record<string, never>;
    id: number;
  };

  type QemuSendKeyCommand = {
    execute: "send-key";
    arguments: { keys: QemuKeyValue[] };
    id: number;
  };

  type QemuScreendumpCommand = {
    execute: "screendump";
    arguments: { filename: string; format: string };
    id: number;
  };

  type QemuCommand = QemuCapabilitiesCommand | QemuSendKeyCommand | QemuScreendumpCommand;

  type QemuStartResult = {
    id: string;
  };

  // failed: QEMU's {error} reply, or this server's error message when the failure
  // never reached QEMU (a timeout, a dead socket).
  type QemuExchangeOutcome =
    | { state: "completed"; response: QemuGreetingResponse | QemuSuccessResponse }
    | { state: "failed"; response: QemuErrorResponse | string };

  // Awaited with the exact command before it goes out (a refused insert fails the
  // exchange up front); the returned close records the outcome when the reply lands.
  type QemuExchangeRecorder = (
    command: QemuCommand,
  ) => Promise<(outcome: QemuExchangeOutcome) => Promise<void>>;
}
