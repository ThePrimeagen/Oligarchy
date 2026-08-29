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
}
