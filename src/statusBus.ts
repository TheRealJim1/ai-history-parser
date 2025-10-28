// Global task/status bus for progress reporting.
// No dependencies; subscribe anywhere (React or non-React).

type Listener = (s: StatusState) => void;

export interface StatusState {
  active: boolean;
  id?: string;
  label?: string;
  sublabel?: string;
  percent?: number;          // 0..100
  indeterminate?: boolean;
  canCancel?: boolean;
  cancelled?: boolean;
  done?: boolean;
  etaSec?: number;           // optional ETA
  speedPerSec?: number;      // optional throughput
  completed?: number;        // units done
  total?: number;            // units total
}

export interface Task {
  id: string;
  label: string;
  total?: number;
  indeterminate?: boolean;
  canCancel?: boolean;
}

class Speedometer {
  private lastT = performance.now();
  private lastN = 0;
  private avg = 0;

  tick(n: number) {
    const t = performance.now();
    const dt = (t - this.lastT) / 1000;
    const dn = n - this.lastN;
    if (dt > 0) {
      const inst = dn / dt;
      this.avg = this.avg === 0 ? inst : this.avg * 0.8 + inst * 0.2;
    }
    this.lastT = t;
    this.lastN = n;
    return this.avg;
  }
}

class StatusBus {
  private listeners = new Set<Listener>();
  private state: StatusState = { active: false };
  private startTs?: number;
  private speedo = new Speedometer();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() { 
    console.log("📊 StatusBus emit:", this.state);
    for (const fn of this.listeners) fn(this.state); 
  }

  begin(task: Task) {
    this.startTs = performance.now();
    this.speedo = new Speedometer();

    this.state = {
      active: true,
      id: task.id,
      label: task.label,
      sublabel: "",
      percent: task.indeterminate ? undefined : 0,
      indeterminate: !!task.indeterminate,
      canCancel: !!task.canCancel,
      cancelled: false,
      done: false,
      completed: 0,
      total: task.total
    };
    this.emit();

    return {
      setTotal: (total: number) => { 
        this.state.total = total; 
        this.emit(); 
      },
      setSub: (s: string) => { 
        this.state.sublabel = s; 
        this.emit(); 
      },
      stepTo: (completed: number) => this.updateProgress(completed),
      tick: (delta = 1) => this.updateProgress((this.state.completed ?? 0) + delta),
      indeterminate: (on = true) => { 
        this.state.indeterminate = on; 
        if (on) this.state.percent = undefined; 
        this.emit(); 
      },
      cancel: () => { 
        if (this.state.canCancel) { 
          this.state.cancelled = true; 
          this.emit(); 
        } 
      },
      isCancelled: () => !!this.state.cancelled,
      end: () => this.finish(),
      fail: (msg?: string) => this.finish(msg),
    };
  }

  private updateProgress(completed: number) {
    this.state.completed = Math.max(0, completed);
    const total = this.state.total ?? 0;
    const pct = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : undefined;
    if (pct !== undefined) this.state.percent = pct;

    // speed + ETA
    const speed = this.speedo.tick(completed);
    this.state.speedPerSec = isFinite(speed) ? speed : undefined;
    if (speed && total > 0) {
      const remain = Math.max(0, total - completed);
      this.state.etaSec = remain / Math.max(0.1, speed);
    } else {
      this.state.etaSec = undefined;
    }
    this.emit();
  }

  private finish(error?: string) {
    this.state.done = true;
    this.state.active = false;
    if (error) this.state.sublabel = error;
    this.emit();
  }
}

export const statusBus = new StatusBus();
export type StatusHandle = ReturnType<StatusBus["begin"]>;
