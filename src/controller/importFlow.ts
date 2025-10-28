
import type { App } from 'obsidian';
import { listJsonFiles, indexConversations } from '../search';
import { AHPDB } from '../db/sqlite';
import { sha256Hex } from '../lib/hash';
import type { Conv } from '../types';

export async function indexFolderIntoDB(app: App, db: AHPDB, folder: string, source='chatgpt', label?: string) {
  const files = await listJsonFiles(app.vault, folder);
  const conversations: Conv[] = await indexConversations(app.vault, files);
  await db.open();

  let inserted = 0;
  for (const c of conversations) {
    const text = c.msgs.map(m => `[${m.role}] ${m.text}`).join('\n');
    const sha = await sha256Hex(text);
    const started = c.msgs.length ? (c.msgs[0].t || c.last) : c.last;
    const fields = {
      ':ext_id': c.id,
      ':source': source,
      ':title': c.title || '(untitled)',
      ':started_at': started,
      ':updated_at': c.last,
      ':backup_id': null,
      ':raw_path': c.blob || '',
      ':sha256': sha
    } as any;
    const conv_id = db.insertConversation(fields);
    if (conv_id) {
      for (const m of c.msgs) db.insertMessage(conv_id, m.role, (m.t || c.last), m.text || '');
      inserted++;
    }
  }
  await db.save();
  return { count: conversations.length, inserted };
}
