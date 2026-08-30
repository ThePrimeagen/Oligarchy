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

  // The commands this program sends: the exact JSON written to the QMP
  // socket, one type per command in use.
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

  // How one QMP exchange ended. completed: QEMU's exact reply (the greeting
  // for qmp_capabilities at boot). failed: QEMU's {error} reply, or this
  // server's error message when the failure never reached QEMU.
  type QemuExchangeOutcome =
    | { state: "completed"; response: QemuGreetingResponse | QemuSuccessResponse }
    | { state: "failed"; response: QemuErrorResponse | string };

  // The proxy's hook into the wire: awaited with the exact command JSON
  // before it goes out (a refused insert fails the exchange up front); the
  // returned close lands the outcome when the reply arrives.
  type QemuExchangeRecorder = (
    command: QemuCommand,
  ) => Promise<(outcome: QemuExchangeOutcome) => Promise<void>>;
}
