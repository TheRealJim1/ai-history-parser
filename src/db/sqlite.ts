
import initSqlJs from 'sql.js';
import type { App, TFile } from 'obsidian';

export type SqlDB = any;
const DB_PATH_DEFAULT = 'ahp-db/aihp.sqlite';

export class AHPDB {
  private app: App;
  private db: SqlDB | null = null;
  private path: string;
  constructor(app: App, path?: string) { this.app = app; this.path = path || DB_PATH_DEFAULT; }

  async open(): Promise<SqlDB> {
    if (this.db) return this.db;
    const SQL = await initSqlJs({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/sql.js@1.9.0/dist/${f}` });
    const data = await this.loadFromVault();
    this.db = data ? new SQL.Database(new Uint8Array(data)) : new SQL.Database();
    this.ensureSchema();
    return this.db;
  }

  private async loadFromVault(): Promise<ArrayBuffer | null> {
    // @ts-ignore
    const file = this.app.vault.getAbstractFileByPath(this.path) as TFile | null;
    if (!file) return null;
    // @ts-ignore
    if (this.app.vault.adapter.readBinary) {
      // @ts-ignore
      return await this.app.vault.adapter.readBinary(this.path);
    }
    const txt = await this.app.vault.read(file);
    return new TextEncoder().encode(txt).buffer;
  }

  private ensureFolder(path: string) {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts.slice(0,-1)) {
      cur = cur ? `${cur}/${p}` : p;
      // @ts-ignore
      if (!this.app.vault.getAbstractFileByPath(cur)) this.app.vault.createFolder(cur).catch(()=>{});
    }
  }

  async save(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    const buf = data as Uint8Array;
    this.ensureFolder(this.path);
    // @ts-ignore
    if (this.app.vault.adapter.writeBinary) {
      // @ts-ignore
      await this.app.vault.adapter.writeBinary(this.path, buf);
      return;
    }
    const b64 = btoa(String.fromCharCode(...buf));
    await this.app.vault.adapter.write(this.path, b64);
  }

  private ensureSchema() {
    const sql = `
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS backup_set (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT,
        source TEXT,
        discovered_at INTEGER,
        root_path TEXT,
        folder_hash TEXT
      );
      CREATE TABLE IF NOT EXISTS conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ext_id TEXT,
        source TEXT NOT NULL,
        title TEXT,
        started_at INTEGER,
        updated_at INTEGER,
        backup_id INTEGER,
        raw_path TEXT,
        sha256 TEXT,
        UNIQUE(source, ext_id) ON CONFLICT IGNORE
      );
      CREATE TABLE IF NOT EXISTS message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conv_id INTEGER NOT NULL,
        role TEXT,
        ts INTEGER,
        text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversation(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON message(conv_id);
      CREATE INDEX IF NOT EXISTS idx_msg_ts ON message(ts);
    `;
    this.db!.exec(sql);
  }

  insertConversation(fields: Record<string, any>) {
    const stmt = this.db!.prepare(`
      INSERT OR IGNORE INTO conversation (ext_id, source, title, started_at, updated_at, backup_id, raw_path, sha256)
      VALUES (:ext_id, :source, :title, :started_at, :updated_at, :backup_id, :raw_path, :sha256)
    `);
    stmt.bind(fields);
    stmt.step();
    stmt.free();
    const q = this.db!.prepare(`SELECT id FROM conversation WHERE source=? AND ext_id=?`);
    q.bind([fields.source, fields.ext_id]);
    const has = q.step() ? q.getAsObject() : null;
    q.free();
    if (has && has.id) return has.id as number;
    const q2 = this.db!.prepare(`SELECT id FROM conversation WHERE sha256=? ORDER BY updated_at DESC LIMIT 1`);
    q2.bind([fields.sha256]);
    const got = q2.step() ? q2.getAsObject() : null;
    q2.free();
    return got?.id as number;
  }

  insertMessage(conv_id: number, role: string, ts: number, text: string) {
    const stmt = this.db!.prepare(`INSERT INTO message (conv_id, role, ts, text) VALUES (?, ?, ?, ?)`);
    stmt.bind([conv_id, role, ts, text]);
    stmt.step();
    stmt.free();
  }

  selectConversations(opts: { source?: string; q?: RegExp } = {}) {
    const res = this.db!.exec(`SELECT id, ext_id, source, title, started_at, updated_at FROM conversation ORDER BY updated_at DESC`);
    if (!res.length) return [];
    const cols = res[0].columns;
    const rows = res[0].values.map(v => Object.fromEntries(v.map((val, i) => [cols[i], val])));
    let out = rows;
    if (opts.source) out = out.filter((r:any) => r.source === opts.source);
    if (opts.q) out = out.filter((r:any) => (r.title||'').match(opts.q!));
    return out;
  }

  getConversationBlob(conv_id: number) {
    const res = this.db!.exec(`SELECT role, ts, text FROM message WHERE conv_id=? ORDER BY ts ASC`, [conv_id]);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(v => Object.fromEntries(v.map((val, i) => [cols[i], val])));
  }
}
