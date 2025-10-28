type Listener = (s?: StatusSnapshot) => void;

export type StatusSnapshot = {
  id: string;
  label: string;
  sublabel?: string;
  total?: number;       // provide this → percent works
  done?: number;
  active: boolean;
  error?: string;
  startedAt?: number;
  etaSec?: number;
  cancelled?: boolean;
};

class StatusBus {
  private s?: StatusSnapshot;
  private L = new Set<Listener>();
  private timer?: number;

  subscribe(fn: Listener) { 
    this.L.add(fn); 
    return () => this.L.delete(fn); 
  }
  
  get() { 
    return this.s; 
  }

  private emit(s?: StatusSnapshot) {
    this.s = s;
    for (const fn of this.L) fn(this.s);
  }

  begin(id: string, label: string, total?: number) {
    const startedAt = Date.now();
    const snapshot: StatusSnapshot = { id, label, total, done: 0, active: true, startedAt, cancelled: false };
    this.emit(snapshot);

    return {
      tick: (delta=1, sublabel?: string) => {
        if (this.s?.cancelled) return;
        const done = Math.max(0, (this.s?.done ?? 0) + delta);
        const totalNow = this.s?.total;
        let etaSec: number | undefined;
        
        if (totalNow && done > 0) {
          const rate = (Date.now() - startedAt) / done;           // ms per unit
          etaSec = Math.max(0, Math.round(((totalNow - done) * rate) / 1000));
        }
        
        this.emit({ ...(this.s as StatusSnapshot), done, sublabel, etaSec, active: true });
      },
      
      set: (done: number, sublabel?: string) => {
        if (this.s?.cancelled) return;
        let etaSec: number | undefined;
        if (this.s?.total && done > 0) {
          const rate = (Date.now() - startedAt) / done;
          etaSec = Math.max(0, Math.round(((this.s.total - done) * rate) / 1000));
        }
        this.emit({ ...(this.s as StatusSnapshot), done, sublabel, etaSec, active: true });
      },
      
      setTotal: (total: number) => {
        this.emit({ ...(this.s as StatusSnapshot), total, active: true });
      },
      
      label: (label: string, sublabel?: string) => {
        this.emit({ ...(this.s as StatusSnapshot), label, sublabel, active: true });
      },
      
      cancel: () => {
        this.emit({ ...(this.s as StatusSnapshot), cancelled: true, active: false });
      },
      
      isCancelled: () => {
        return this.s?.cancelled ?? false;
      },
      
      end: () => {
        this.emit({ ...(this.s as StatusSnapshot), active: false });
        // keep the final bar visible briefly so you can see 100%
        if (this.timer) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.emit(undefined), 1200);
      },
      
      fail: (error: string) => {
        this.emit({ ...(this.s as StatusSnapshot), active: false, error });
      }
    };
  }
}

export const statusBus = new StatusBus();
