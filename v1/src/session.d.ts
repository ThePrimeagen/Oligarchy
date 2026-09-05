type SessionStartStatus = "downloading" | "running";
type SessionEndStatus = "succeeded" | "failed" | "aborted" | "timed_out";

// One line of GET /follow: the session's state, its intent, each action by name, and each image.
type FollowEvent =
  | { type: "session"; status: "pending" | "running" | SessionEndStatus }
  | { type: "intent"; state: "started"; message: string }
  | { type: "intent"; state: "completed" | "cancelled" }
  | { type: "action"; id: number; name: string; state: "running" }
  | { type: "action"; id: number; state: "completed" | "failed" }
  | { type: "image"; id: string; png: string };
