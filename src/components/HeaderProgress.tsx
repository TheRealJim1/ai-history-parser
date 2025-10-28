import React, { useEffect, useState } from "react";
import { statusBus, StatusState } from "../statusBus";

export const HeaderProgress: React.FC = () => {
  const [s, setS] = useState<StatusState>({ active: false });
  useEffect(() => statusBus.subscribe(setS), []);

  console.log("📊 HeaderProgress render:", s);

  if (!s.active) return null;

  const eta = s.etaSec ? formatEta(s.etaSec) : "";
  const pct = s.percent?.toFixed?.(0);

  return (
    <div className="aip-progress" style={{ 
      border: '2px solid red', 
      backgroundColor: 'rgba(255,0,0,0.1)', 
      padding: '8px',
      margin: '4px 0'
    }}>
      <div className="aip-progress-row">
        <div className="aip-progress-main">
          <strong>{s.label}</strong>
          {s.sublabel ? <span className="aip-sub"> · {s.sublabel}</span> : null}
          {s.speedPerSec ? <span className="aip-sub"> · {fmtNumber(s.speedPerSec)}/s</span> : null}
          {eta ? <span className="aip-sub"> · ETA {eta}</span> : null}
          <span className="aip-sub"> · {pct}%</span>
        </div>
        <div className="aip-progress-actions">
          {s.canCancel ? (
            <button 
              className="aip-btn-ghost" 
              onClick={() => {
                // Find the current task and cancel it
                const currentTask = statusBus as any;
                if (currentTask.currentHandle) {
                  currentTask.currentHandle.cancel();
                }
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="aip-progress-bar" style={{ 
        backgroundColor: 'rgba(255,0,0,0.2)', 
        height: '8px',
        border: '1px solid red'
      }}>
        <div
          className={`aip-progress-fill ${s.indeterminate ? "is-indeterminate" : ""}`}
          style={!s.indeterminate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
};

function formatEta(sec: number) {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

function fmtNumber(n?: number) {
  if (n == null) return "";
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`;
  return n.toFixed(0);
}
