export type StatusSnapshot = {
  id: string; 
  label: string; 
  sublabel?: string;
  total?: number; 
  done?: number; 
  active: boolean;
  error?: string; 
  startedAt?: number; 
  etaSec?: number;
};

type Listener = (s?: StatusSnapshot)=>void;

class StatusBus {
  private s?: StatusSnapshot; 
  private L = new Set<Listener>(); 
  private timer?: number;

  subscribe(fn:Listener){ 
    this.L.add(fn); 
    return ()=>this.L.delete(fn); 
  }
  
  get(){ 
    return this.s; 
  }

  private emit(s?: StatusSnapshot){ 
    this.s = s; 
    this.L.forEach(f=>f(s)); 
  }

  begin(id:string,label:string,total?:number){
    const startedAt = Date.now();
    this.emit({ id,label,total,done:0, active:true, startedAt });

    return {
      setTotal:(t:number)=> this.emit({ ...(this.s as StatusSnapshot), total:t }),
      tick:(delta=1, sublabel?:string)=>{
        const s = this.s as StatusSnapshot; 
        const done = Math.max(0,(s.done??0)+delta);
        let etaSec; 
        if (s.total && done>0){ 
          const rate=(Date.now()- (s.startedAt||Date.now()))/done; 
          etaSec=Math.max(0,Math.round(((s.total-done)*rate)/1000)); 
        }
        this.emit({ ...s, done, sublabel, etaSec, active:true });
      },
      set:(done:number, sublabel?:string)=>{
        const s = this.s as StatusSnapshot; 
        let etaSec;
        if (s.total && done>0){ 
          const rate=(Date.now()-(s.startedAt||Date.now()))/done; 
          etaSec=Math.max(0,Math.round(((s.total-done)*rate)/1000)); 
        }
        this.emit({ ...s, done, sublabel, etaSec, active:true });
      },
      label:(l:string, sub?:string)=> this.emit({ ...(this.s as StatusSnapshot), label:l, sublabel:sub }),
      end:()=>{
        this.emit({ ...(this.s as StatusSnapshot), active:false });
        if (this.timer) clearTimeout(this.timer);
        this.timer = window.setTimeout(()=>this.emit(undefined), 1000);
      },
      fail:(err:string)=> this.emit({ ...(this.s as StatusSnapshot), active:false, error: err })
    };
  }
}

export const statusBus = new StatusBus();