
import initSqlJs from 'sql.js';
import type { App, TFile } from 'obsidian';
import { fnv1a64, normText } from '../lib/hash';

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
        text TEXT,
        hash TEXT
      );
      CREATE TABLE IF NOT EXISTS message_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        embedding TEXT NOT NULL,
        model_name TEXT,
        embedding_dim INTEGER,
        created_at INTEGER,
        FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_relationship (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conv_id_1 INTEGER NOT NULL,
        conv_id_2 INTEGER NOT NULL,
        relationship_type TEXT,
        similarity_score REAL,
        metadata TEXT,
        created_at INTEGER,
        FOREIGN KEY(conv_id_1) REFERENCES conversation(id) ON DELETE CASCADE,
        FOREIGN KEY(conv_id_2) REFERENCES conversation(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS topic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS message_topic (
        message_id INTEGER NOT NULL,
        topic_id INTEGER NOT NULL,
        relevance_score REAL,
        PRIMARY KEY(message_id, topic_id),
        FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE CASCADE,
        FOREIGN KEY(topic_id) REFERENCES topic(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversation(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON message(conv_id);
      CREATE INDEX IF NOT EXISTS idx_msg_ts ON message(ts);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_message_dedupe ON message(conv_id, ts, role, hash);
      CREATE INDEX IF NOT EXISTS idx_embedding_msg ON message_embedding(message_id);
      CREATE INDEX IF NOT EXISTS idx_relationship_conv1 ON conversation_relationship(conv_id_1);
      CREATE INDEX IF NOT EXISTS idx_relationship_conv2 ON conversation_relationship(conv_id_2);
      CREATE INDEX IF NOT EXISTS idx_msg_topic_msg ON message_topic(message_id);
      CREATE INDEX IF NOT EXISTS idx_msg_topic_topic ON message_topic(topic_id);
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
    const hash = fnv1a64(`${role}|${ts}|${normText(text)}`);
    const stmt = this.db!.prepare(`INSERT OR IGNORE INTO message (conv_id, role, ts, text, hash) VALUES (?, ?, ?, ?, ?)`);
    stmt.bind([conv_id, role, ts, text, hash]);
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

  insertMessageEmbedding(message_id: number, embedding: number[], model_name: string, embedding_dim: number) {
    const embeddingJson = JSON.stringify(embedding);
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO message_embedding (message_id, embedding, model_name, embedding_dim, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.bind([message_id, embeddingJson, model_name, embedding_dim, Date.now()]);
    stmt.step();
    stmt.free();
  }

  getMessageEmbedding(message_id: number): number[] | null {
    const stmt = this.db!.prepare(`SELECT embedding FROM message_embedding WHERE message_id=? LIMIT 1`);
    stmt.bind([message_id]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    if (result && result.embedding) {
      try {
        return JSON.parse(result.embedding as string);
      } catch {
        return null;
      }
    }
    return null;
  }

  insertConversationRelationship(
    conv_id_1: number,
    conv_id_2: number,
    relationship_type: string,
    similarity_score: number,
    metadata?: Record<string, any>
  ) {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO conversation_relationship 
      (conv_id_1, conv_id_2, relationship_type, similarity_score, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([conv_id_1, conv_id_2, relationship_type, similarity_score, metadataJson, Date.now()]);
    stmt.step();
    stmt.free();
  }

  getConversationRelationships(conv_id: number) {
    const res = this.db!.exec(`
      SELECT cr.*, c1.title as conv1_title, c2.title as conv2_title
      FROM conversation_relationship cr
      JOIN conversation c1 ON cr.conv_id_1 = c1.id
      JOIN conversation c2 ON cr.conv_id_2 = c2.id
      WHERE cr.conv_id_1 = ? OR cr.conv_id_2 = ?
      ORDER BY cr.similarity_score DESC
    `, [conv_id, conv_id]);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(v => Object.fromEntries(v.map((val, i) => [cols[i], val])));
  }

  insertTopic(name: string, description?: string): number {
    const stmt = this.db!.prepare(`
      INSERT OR IGNORE INTO topic (name, description, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.bind([name, description || null, Date.now()]);
    stmt.step();
    stmt.free();
    
    const q = this.db!.prepare(`SELECT id FROM topic WHERE name=? LIMIT 1`);
    q.bind([name]);
    const result = q.step() ? q.getAsObject() : null;
    q.free();
    return result?.id as number || -1;
  }

  insertMessageTopic(message_id: number, topic_id: number, relevance_score: number) {
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO message_topic (message_id, topic_id, relevance_score)
      VALUES (?, ?, ?)
    `);
    stmt.bind([message_id, topic_id, relevance_score]);
    stmt.step();
    stmt.free();
  }

  getAllMessageEmbeddings(): Map<number, number[]> {
    const res = this.db!.exec(`SELECT message_id, embedding FROM message_embedding`);
    const embeddings = new Map<number, number[]>();
    
    if (!res.length) return embeddings;
    const cols = res[0].columns;
    
    for (const row of res[0].values) {
      const obj = Object.fromEntries(row.map((val, i) => [cols[i], val]));
      if (obj.embedding) {
        try {
          const embedding = JSON.parse(obj.embedding as string);
          embeddings.set(obj.message_id as number, embedding);
        } catch {
          // Skip invalid embeddings
        }
      }
    }
    
    return embeddings;
  }
}
