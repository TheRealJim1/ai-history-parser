import React from "react";
import { statusBus, type StatusSnapshot } from "./status";

export const HeaderProgress: React.FC = () => {
  const [s,setS] = React.useState<StatusSnapshot|undefined>(statusBus.get());

  React.useEffect(()=> statusBus.subscribe(setS), []);

  if (!s) return null;

  const pct = s.total ? Math.min(100, Math.round(((s.done??0)/s.total)*100)) : undefined;

  return (
    <div className="aip-header-progress" title={`${s.label}${s.sublabel?` — ${s.sublabel}`:""}`}>
      <div className="bar"><div className={`fill ${pct==null?"ind":""}`} style={pct!=null?{width:`${pct}%`}:undefined}/></div>
      <div className="txt">{s.error?`❌ ${s.error}`:`${s.label}${pct!=null?` ${pct}%`:""}${s.etaSec!=null?` · ETA ${s.etaSec}s`:""}`}</div>
    </div>
  );
};