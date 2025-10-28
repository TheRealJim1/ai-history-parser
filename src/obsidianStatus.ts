import type { Plugin } from "obsidian";
import { statusBus, StatusState } from "./statusBus";

export function attachStatusBar(plugin: Plugin) {
  const el = plugin.addStatusBarItem();
  el.setText("AI Parser: idle");
  
  // Make sure the status bar is visible
  el.addClass("aihp-status-bar");
  el.style.color = "var(--text-muted)";
  el.style.fontSize = "12px";
  el.style.padding = "2px 8px";
  el.style.borderRadius = "4px";
  el.style.backgroundColor = "var(--background-secondary)";
  el.style.border = "1px solid var(--background-modifier-border)";
  el.style.position = "relative";
  el.style.zIndex = "1000";
  el.style.display = "inline-block";
  el.style.minWidth = "100px";
  
  console.log("📊 Status bar element created:", el);
  console.log("📊 Status bar element visible:", el.isShown());
  console.log("📊 Status bar element text:", el.getText());

  const unsub = statusBus.subscribe((s: StatusState) => {
    console.log("📊 StatusBar update:", s);
    console.log("📊 StatusBar element exists:", !!el);
    console.log("📊 StatusBar element visible:", el.isShown());
    
    if (!s.active) { 
      const text = "AI Parser: idle";
      console.log("📊 Setting idle text:", text);
      el.setText(text); 
      return; 
    }

    const pct = s.percent != null ? ` ${s.percent.toFixed(0)}%` : "";
    const eta = s.etaSec != null ? ` · ETA ${formatEta(s.etaSec)}` : "";
    const spd = s.speedPerSec ? ` · ${fmt(s.speedPerSec)}/s` : "";
    const text = `${s.label ?? "Working"}${pct}${spd}${eta}`;
    console.log("📊 Setting active text:", text);
    el.setText(text);
    
    // Force a re-render by toggling visibility
    el.hide();
    setTimeout(() => el.show(), 10);
  });

  plugin.register(() => unsub());
}

function formatEta(sec: number) {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

function fmt(n: number) { 
  return n >= 1000 ? `${(n/1000).toFixed(1)}k` : n.toFixed(0); 
}
