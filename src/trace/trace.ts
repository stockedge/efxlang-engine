export interface TraceEvent {
  cycle: string; // bigint as string
  type: "input" | "syscall" | "safepoint";
  task: number;
  [key: string]: string | number | boolean | null | undefined | unknown;
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
