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

  type QemuStartResult = {
    id: string;
  };
}
