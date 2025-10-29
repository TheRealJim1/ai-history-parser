import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { statusBus } from "./statusBus"; // optional; comment out if not using

// ---------- types (adapt to your in-memory shapes) ----------
export interface Conversation {
  id: string;                       // stable ID you already generate
  title: string;
  date?: number;                    // epoch ms
  project?: string;                 // inferred or chosen project name
  entities?: string[];              // unique entity names (people/orgs/tools)
  tags?: string[];                  // extra tags
  urlSlug?: string;                 // optional filename override
}

export interface ProjectBucket {
  name: string;                     // e.g., "Health-Radiculopathy-EMR"
  conversations: Conversation[];
  tags?: string[];
  meta?: Record<string, any>;
}

export interface GraphEmitOptions {
  rootFolder: string;               // e.g., "_ai-graph"
  emitEntities?: boolean;           // default true
  emitMonthHubs?: boolean;          // default false
  dryRun?: boolean;                 // default false
}

// ---------- emitter ----------
export class GraphEmitter {
  constructor(private app: App) {}

  async emit(projects: ProjectBucket[], opts: GraphEmitOptions) {
    const root = normalizePath(opts.rootFolder || "_ai-graph");
    await this.ensureFolder(root);

    const flatConvs = projects.flatMap(p => p.conversations);
    const uniqueEntities = new Set<string>();
    if (opts.emitEntities !== false) {
      for (const c of flatConvs) for (const e of (c.entities || [])) uniqueEntities.add(e);
    }

    const task = statusBus.begin({
      id: "emit-graph",
      label: "Building native graph notes",
      total: projects.length + flatConvs.length + (opts.emitEntities === false ? 0 : uniqueEntities.size),
      canCancel: true
    });

    try {
      // 1) Project notes
      for (const p of projects) {
        if (task.isCancelled()) break;
        task.setSub(`Project: ${p.name}`);
        await this.writeProjectNote(root, p, !!opts.dryRun);
        task.tick();
      }

      // 2) Conversation notes
      for (const p of projects) {
        for (const c of p.conversations) {
          if (task.isCancelled()) break;
          task.setSub(`Conversation: ${c.title}`);
          await this.writeConversationNote(root, p.name, c, !!opts.dryRun);
          task.tick();
        }
      }

      // 3) Entity notes (optional)
      if (opts.emitEntities !== false) {
        for (const e of uniqueEntities) {
          if (task.isCancelled()) break;
          task.setSub(`Entity: ${e}`);
          await this.writeEntityNote(root, e, !!opts.dryRun);
          task.tick();
        }
      }

      // 4) Month hubs (optional)
      if (opts.emitMonthHubs) {
        const byMonth = new Map<string, Conversation[]>();
        for (const c of flatConvs) {
          if (!c.date) continue;
          const d = new Date(c.date);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
          if (!byMonth.has(key)) byMonth.set(key, []);
          byMonth.get(key)!.push(c);
        }
        for (const [ym, list] of byMonth) {
          if (task.isCancelled()) break;
          task.setSub(`Month: ${ym}`);
          await this.writeMonthHub(root, ym, list, !!opts.dryRun);
          task.tick();
        }
      }

      task.end();
    } catch (err: any) {
      task.fail(err?.message || String(err));
      throw err;
    }
  }

  // ---------- file helpers ----------
  private async ensureFolder(path: string): Promise<TFolder> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFolder) return existing;
    await this.app.vault.createFolder(path);
    return this.app.vault.getAbstractFileByPath(path) as TFolder;
  }

  private slugFileName(s: string): string {
    return s
      .replace(/[\\/#?%*:|"<>]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "-")
      .toLowerCase();
  }

  private projectPath(root: string, name: string) {
    return normalizePath(`${root}/projects/${this.slugFileName(name)}.md`);
  }
  private conversationPath(root: string, projName: string, conv: Conversation) {
    const base = conv.urlSlug || `${this.slugFileName(conv.title || "untitled")}-${conv.id.slice(0,8)}`;
    return normalizePath(`${root}/conversations/${this.slugFileName(projName)}/${base}.md`);
  }
  private entityPath(root: string, entity: string) {
    return normalizePath(`${root}/entities/${this.slugFileName(entity)}.md`);
  }
  private monthPath(root: string, ym: string) {
    return normalizePath(`${root}/months/${ym}.md`);
  }

  private async writeIfChanged(path: string, next: string, dry: boolean) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const curr = await this.app.vault.read(file);
      if (curr === next) return; // no-op
      if (!dry) await this.app.vault.modify(file, next);
    } else {
      const folderPath = path.split("/").slice(0,-1).join("/");
      if (folderPath) await this.ensureFolder(folderPath);
      if (!dry) await this.app.vault.create(path, next);
    }
  }

  // ---------- note writers ----------
  private async writeProjectNote(root: string, p: ProjectBucket, dry: boolean) {
    const path = this.projectPath(root, p.name);
    const tags = ["ai/project", ...(p.tags || [])].map(t => `#${t}`).join(" ");
    const convLinks = p.conversations
      .map(c => `- [[${this.slugFileName(p.name)}/${(c.urlSlug || `${this.slugFileName(c.title)}-${c.id.slice(0,8)}`).toLowerCase()}|${c.title || "(untitled)"}]]`)
      .join("\n");

    const yaml = [
      "---",
      `type: project`,
      `name: ${escapeY(p.name)}`,
      `tags: [${["ai/project", ...(p.tags||[])].join(", ")}]`,
      `conversations: ${p.conversations.length}`,
      p.meta ? `meta: ${JSON.stringify(p.meta)}` : null,
      "---"
    ].filter(Boolean).join("\n");

    const body = `${yaml}

# ${p.name}


${tags}


## Conversations
${convLinks || "_(none yet)_"}


`;

    await this.writeIfChanged(path, body, dry);
  }

  private async writeConversationNote(root: string, projName: string, c: Conversation, dry: boolean) {
    const path = this.conversationPath(root, projName, c);
    const tags = ["ai/conversation", ...(c.tags || [])].map(t => `#${t}`).join(" ");
    const dateStr = c.date ? new Date(c.date).toISOString().slice(0,10) : "";
    const entityLinks = (c.entities || []).map(e => `[[${this.slugFileName(e)}|${e}]]`).join(" ");

    const yaml = [
      "---",
      `type: conversation`,
      `id: ${c.id}`,
      c.date ? `date: ${new Date(c.date).toISOString()}` : null,
      `project: [[${this.slugFileName(projName)}|${projName}]]`,
      c.tags?.length ? `tags: [${["ai/conversation", ...(c.tags||[])].join(", ")}]` : `tags: [ai/conversation]`,
      "---"
    ].filter(Boolean).join("\n");

    const body = `${yaml}

# ${c.title || "(untitled)"} ${dateStr ? "· " + dateStr : ""}


Project: [[${this.slugFileName(projName)}|${projName}]]


${tags}


${entityLinks ? `**Mentions:** ${entityLinks}\n` : ""}


> This is a stub to light up the Graph. Open the original in the parser UI for full content.
`;

    await this.writeIfChanged(path, body, dry);
  }

  private async writeEntityNote(root: string, entity: string, dry: boolean) {
    const path = this.entityPath(root, entity);
    const yaml = [
      "---",
      `type: entity`,
      `name: ${escapeY(entity)}`,
      `tags: [ai/entity]`,
      "---"
    ].join("\n");

    const body = `${yaml}

# ${entity}


Used across conversations. Backlinks will show usage.
`;
    await this.writeIfChanged(path, body, dry);
  }

  private async writeMonthHub(root: string, ym: string, list: Conversation[], dry: boolean) {
    const path = this.monthPath(root, ym);
    const links = list.map(c => `- [[${this.slugFileName(c.project || "misc")}/${(c.urlSlug || `${this.slugFileName(c.title)}-${c.id.slice(0,8)}`).toLowerCase()}|${c.title}]]`).join("\n");
    const yaml = [
      "---",
      `type: month`,
      `ym: ${ym}`,
      `tags: [ai/month]`,
      `count: ${list.length}`,
      "---"
    ].join("\n");

    const body = `${yaml}

# ${ym}


## Conversations (${list.length})
${links}
`;
    await this.writeIfChanged(path, body, dry);
  }
}

function escapeY(s: string) {
  return String(s).replace(/"/g, '\\"');
}

