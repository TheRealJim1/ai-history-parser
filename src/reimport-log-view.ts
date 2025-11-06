import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";

export const VIEW_TYPE_REIMPORT_LOG = 'ai-foundry-reimport-log';

export class ReimportLogView extends ItemView {
  logEl!: HTMLPreElement;
  barInner!: HTMLDivElement;
  statusEl!: HTMLDivElement;
  killCb: (()=>void) | null = null;

  getViewType() { return VIEW_TYPE_REIMPORT_LOG; }
  getDisplayText() { return 'AI‑Foundry Re‑import Log'; }
  getIcon() { return 'play'; }

  async onOpen() {
    const container = this.containerEl;
    container.empty();

    const header = container.createDiv({ cls: 'af-log-header' });
    header.createEl('div', { text: 'Reset & Re‑import (Folder‑Ordered)', cls: 'af-title' });
    const actions = header.createDiv({ cls: 'af-actions' });
    const killBtn = actions.createEl('button', { text: 'Stop', cls: 'af-btn' });
    try { setIcon(killBtn, 'square'); } catch {}
    killBtn.onclick = ()=>{ if(this.killCb){ this.killCb(); new Notice('Stopping…'); } };

    const bar = container.createDiv({ cls: 'af-progress' });
    this.barInner = bar.createDiv({ cls: 'af-progress-inner' });
    this.statusEl = container.createDiv({ cls: 'af-status' });

    this.logEl = container.createEl('pre', { cls: 'af-log' });
  }

  append(line: string) {
    if (!this.logEl) return;
    const node = document.createTextNode((line ?? '') + '\n');
    this.logEl.appendChild(node);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    const m = line.match(/^\[(\d+)\/(\d+)\]\s+Import/);
    if (m && this.barInner && this.statusEl) {
      const a = +m[1], b = +m[2];
      const pct = Math.max(0, Math.min(100, Math.round(100 * a / b)));
      this.barInner.style.width = pct + '%';
      this.statusEl.setText(`${pct}%  (${a}/${b})`);
    }
  }

  setKillCb(cb: ()=>void){ this.killCb = cb; }
}


