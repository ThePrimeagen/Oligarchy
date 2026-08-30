/** A drizzle-orm NodePgDatabase client. */
type Db = unknown;

type SessionStartStatus = "downloading" | "running";
type SessionEndStatus = "succeeded" | "failed" | "aborted" | "timed_out";

type Action = {
  sessionId: string;
  agentId: string;
  request: QemuCommand;
};

type Outcome =
  | { state: "completed"; response: QemuGreetingResponse | QemuSuccessResponse }
  | { state: "failed"; response: QemuErrorResponse | string };

function connectDatabase(): Db;
function insertSession(db: Db, id: string, config: unknown, status: SessionStartStatus): Promise<void>;
function sessionRunning(db: Db, id: string): Promise<void>;
function endSession(db: Db, id: string, status: SessionEndStatus, reason: string | null): Promise<void>;
function registerAgent(db: Db, agentId: string, sessionId: string): Promise<void>;
function startAction(db: Db, action: Action): Promise<number>;
function finishAction(db: Db, id: number, outcome: Outcome, image?: Buffer): Promise<void>;
