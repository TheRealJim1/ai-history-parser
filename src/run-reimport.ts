import { App, Notice } from 'obsidian';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { VIEW_TYPE_REIMPORT_LOG, ReimportLogView } from './reimport-log-view';
import type { ParserSettings } from './types';

export interface RunOpts { reset: boolean; dryRun?: boolean }

export class ReimportRunner {
  constructor(private app: App, private settings: any, private pluginDir: string) {}

  async openLog(): Promise<ReimportLogView> {
    const leaf = this.app.workspace.getRightLeaf(false) as any;
    await leaf.setViewState({ type: VIEW_TYPE_REIMPORT_LOG, active: true });
    return leaf.view as ReimportLogView;
  }

  async run(opts: RunOpts) {
    const pp = this.settings.pythonPipeline;
    if (!pp?.dbPath || !pp?.scriptsRoot) {
      new Notice('Set Database Path and Scripts Root in settings first.');
      return;
    }

    const view = await this.openLog();
    const logsDir = path.join(this.getVaultBase(), '.ai-foundry', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const logPath = path.join(logsDir, `reimport-${stamp}.log`);
    const logStream = fs.createWriteStream(logPath);

    const write = (line: string) => { view.append(line); logStream.write(line + '\n'); };
    const chain: ChildProcessWithoutNullStreams[] = [];
    const killAll = () => { for (const p of chain) { try { p.kill('SIGTERM'); } catch(_){} } };
    view.setKillCb(killAll);

    try {
      if (opts.reset) {
        write('# Reset: wiping tables via sqlite3 + tools/wipe_data.sql');
        const wipe = spawn(pp.sqlite3Bin || 'sqlite3', [pp.dbPath, '.read', 'tools/wipe_data.sql'], {
          cwd: this.pluginDir,
          shell: process.platform === 'win32',
        });
        chain.push(wipe);
        wipe.stdout.on('data', d => write(String(d).trimEnd()));
        wipe.stderr.on('data', d => write(String(d).trimEnd()));
        const code: number = await new Promise(res=> wipe.on('close', res));
        if (code !== 0) write(`! sqlite3 exited with code ${code} (continuing without reset)`);
      }

      const base = this.settings.sources?.[0]?.root || '';
      const backupsBase = base || this.settings.exportFolder || '';
      if (!backupsBase) {
        new Notice('No backups base folder detected. Add a source in the main view or set exportFolder.');
        return;
      }

      const args = ['tools/reimport_by_folders.py', '--base', backupsBase, '--db', pp.dbPath];
      if (opts.dryRun) args.push('--dry-run');

      write(`# Re-import: ${pp.pythonExecutable} ${args.join(' ')}`);
      const proc = spawn(pp.pythonExecutable || 'python', args, {
        cwd: this.pluginDir,
        shell: process.platform === 'win32',
      });
      chain.push(proc);

      proc.stdout.on('data', d => write(String(d).trimEnd()));
      proc.stderr.on('data', d => write(String(d).trimEnd()));

      const code: number = await new Promise(res=> proc.on('close', res));
      write(code === 0 ? '# Done.' : `! python exited with code ${code}`);
      new Notice(code === 0 ? 'Re‑import complete' : 'Re‑import finished with errors');
    } finally {
      logStream.end();
    }
  }

  getVaultBase(): string {
    const adapter: any = (this.app.vault as any).adapter;
    return adapter?.getBasePath ? adapter.getBasePath() : process.cwd();
  }
}


