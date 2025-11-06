// Graph export - edges-only option for lightweight link cloud generation
import type { App } from "obsidian";
import { safeJson, type ConversationAnnotation } from "./jsonUtils";

export interface ExportEdgesOptions {
  indexFolder: string;
  historyFolder: string;
}

function slug(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function exportEdgesOnly(
  app: App,
  conversations: ConversationAnnotation[],
  opts: ExportEdgesOptions
): Promise<void> {
  const vault = app.vault;
  const idx = opts.indexFolder;
  const hist = opts.historyFolder;

  async function ensure(path: string, content: string) {
    try {
      const exists = await vault.adapter.exists(path);
      if (!exists) {
        await vault.create(path, content);
      } else {
        // Optionally update existing file
        await vault.adapter.write(path, content);
      }
    } catch (error) {
      console.warn(`Failed to create/update ${path}:`, error);
    }
  }

  // Seed typed folders
  const folders = ["people", "orgs", "products", "medical", "legal", "topics"];
  for (const folder of folders) {
    try {
      await app.vault.createFolder(`${idx}/${folder}`).catch(() => {});
    } catch {
      // Folder might already exist, ignore
    }
  }

  // Process each conversation
  for (const r of conversations) {
    const tags = r.tags || [];
    const topics = r.topics || [];
    const entities = r.entities || {};
    const title = r.title || 'Untitled';
    const dateStr = r.ts ? r.ts.slice(0, 10).replace(/[^0-9]/g, '-') : '0000-00-00';
    const base = `${hist}/${dateStr} ${title.replace(/[<>:"/\\|?*]/g, '_')}.md`;
    const links: string[] = [];

    function w(cat: string, name: string): string {
      const s = slug(name);
      const filePath = `${idx}/${cat}/${s}.md`;
      const linkText = `[[${cat}/${s}|${name}]]`;
      if (!links.includes(linkText)) {
        links.push(linkText);
      }
      return filePath;
    }

    // Create entity/topic pages
    (entities.people || []).forEach(n => {
      const filePath = w('people', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: person\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    (entities.orgs || []).forEach(n => {
      const filePath = w('orgs', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: organization\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    (entities.products || []).forEach(n => {
      const filePath = w('products', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: product\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    (entities.medical_terms || []).forEach(n => {
      const filePath = w('medical', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: medical_term\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    (entities.legal_terms || []).forEach(n => {
      const filePath = w('legal', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: legal_term\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    topics.forEach(n => {
      const filePath = w('topics', n);
      const content = `---\ntitle: ${JSON.stringify(n)}\ntype: topic\n---\n# ${n}\n`;
      ensure(filePath, content);
    });

    const linkCloud = links.length ? links.join(' ') + '\n\n---\n' : '';
    const fm = [
      '---',
      `source: "ai_history.db"`,
      `conversation_id: ${JSON.stringify(r.id)}`,
      `provider: ${JSON.stringify(r.provider || '')}`,
      `date: ${JSON.stringify(r.ts ? r.ts.slice(0, 19) : '')}`,
      '---\n'
    ].join('\n');

    const content = `${fm}# ${title}\n\n${linkCloud}_Edges export only (use full exporter for bodies/images)_\n`;

    try {
      const exists = await vault.adapter.exists(base);
      if (exists) {
        // Update existing file - append links if not present
        const existing = await vault.adapter.read(base);
        if (!existing.includes(linkCloud) && links.length > 0) {
          await vault.adapter.write(base, existing + '\n' + linkCloud);
        }
      } else {
        await vault.create(base, content);
      }
    } catch (error) {
      console.warn(`Failed to create/update conversation file ${base}:`, error);
    }
  }
}



