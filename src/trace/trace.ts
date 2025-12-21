export interface TraceEvent {
  cycle: string; // bigint as string
  type: "input" | "syscall" | "safepoint";
  task: number;
  [key: string]: unknown;
}

export interface TraceSnapshot {
  cycle: string;
  state_hash: string;
  data: unknown;
}

export interface TraceFile {
  image_hash: string;
  events: TraceEvent[];
  snapshots: TraceSnapshot[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isTraceEventType(v: unknown): v is TraceEvent["type"] {
  return v === "input" || v === "syscall" || v === "safepoint";
}

export function parseTraceFile(v: unknown): TraceFile {
  if (!isRecord(v)) throw new Error("TraceFile must be an object");

  const imageHash = v.image_hash;
  if (typeof imageHash !== "string") throw new Error("TraceFile.image_hash");

  const events = v.events;
  if (!Array.isArray(events)) throw new Error("TraceFile.events");

  const snapshots = v.snapshots;
  if (!Array.isArray(snapshots)) throw new Error("TraceFile.snapshots");

  return {
    image_hash: imageHash,
    events: events.map((e) => {
      if (!isRecord(e)) throw new Error("TraceEvent must be an object");
      if (typeof e.cycle !== "string") throw new Error("TraceEvent.cycle");
      if (!isTraceEventType(e.type)) throw new Error("TraceEvent.type");
      if (typeof e.task !== "number") throw new Error("TraceEvent.task");
      return e as TraceEvent;
    }),
    snapshots: snapshots.map((s) => {
      if (!isRecord(s)) throw new Error("TraceSnapshot must be an object");
      if (typeof s.cycle !== "string") throw new Error("TraceSnapshot.cycle");
      if (typeof s.state_hash !== "string")
        throw new Error("TraceSnapshot.state_hash");
      return {
        cycle: s.cycle,
        state_hash: s.state_hash,
        data: (s as { data?: unknown }).data,
      };
    }),
  };
}

export class TraceManager {
  private events: TraceEvent[] = [];
  private snapshots: TraceSnapshot[] = [];

  constructor(private imageHash: string) {}

  addEvent(
    cycle: bigint,
    type: TraceEvent["type"],
    task: number,
    detail?: Omit<TraceEvent, "cycle" | "type" | "task">,
  ): void {
    this.events.push({
      ...(detail as TraceEvent), // Spread detail first
      cycle: cycle.toString(),
      type,
      task,
    });
  }

  addSnapshot(cycle: bigint, hash: string, data: unknown): void {
    this.snapshots.push({
      cycle: cycle.toString(),
      state_hash: hash,
      data,
    });
  }

  getEventAt(
    cycle: bigint,
    type: TraceEvent["type"],
    task: number,
  ): TraceEvent | undefined {
    return this.events.find(
      (e) => e.cycle === cycle.toString() && e.type === type && e.task === task,
    );
  }

  getSnapshotAt(cycle: bigint): TraceSnapshot | undefined {
    return this.snapshots.find((s) => s.cycle === cycle.toString());
  }

  static fromJSON(trace: TraceFile): TraceManager {
    const tm = new TraceManager(trace.image_hash);
    tm.events = [...trace.events];
    tm.snapshots = [...trace.snapshots];
    return tm;
  }

  toJSON(): TraceFile {
    return {
      image_hash: this.imageHash,
      events: this.events,
      snapshots: this.snapshots,
    };
  }
}
