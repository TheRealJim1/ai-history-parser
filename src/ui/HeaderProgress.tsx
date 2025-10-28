import React from "react";
import { statusBus, StatusSnapshot } from "./status";

export const HeaderProgress: React.FC = () => {
  const [s, setS] = React.useState<StatusSnapshot|undefined>(statusBus.get());

  React.useEffect(() => statusBus.subscribe(setS), []);

  if (!s) return null;

  const pct = s.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : undefined;
  const eta = s.etaSec != null ? ` · ETA ${s.etaSec}s` : "";
  const msg = `${s.label}${s.sublabel ? " — " + s.sublabel : ""}${eta}`;

  return (
    <div className="aip-header-progress" title={msg}>
      <div className={`bar ${!s.active && pct===undefined ? "done" : ""}`}>
        <div className={`fill ${pct==null ? "indeterminate" : ""}`} style={pct!=null ? { width: `${pct}%` } : undefined}/>
      </div>
      <div className="label">
        {s.error ? `❌ ${s.error}` : `${s.label}${pct!=null ? ` ${pct}%` : ""}${eta}`}
      </div>
    </div>
  );
};
