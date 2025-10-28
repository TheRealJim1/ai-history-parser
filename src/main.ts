
import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting, Notice, TFile } from "obsidian";
import { DEFAULT_SETTINGS, validateFolderPath, sanitizeFolderPath, migrateLegacySettings } from "./settings";
import { ParserView, VIEW_TYPE } from "./view";
import { statusBus } from "./ui/status";
import type { ParserSettings } from "./types";
import { GraphEmitter, type ProjectBucket, type Conversation as GraphConversation } from "./graphEmitter";
import { getMessages } from "./db";

export default class AIHistoryParser extends Plugin {
  settings: ParserSettings;
  private statusItem?: HTMLElement;

  async onload() {
    // Load and migrate settings
    const loadedData = await this.loadData();
    this.settings = migrateLegacySettings(loadedData);

    // Attach status bar
    try {
      const el = this.addStatusBarItem();
      this.statusItem = el;
      el.setText("AI Parser: idle");
      statusBus.subscribe(s => {
        if (!this.statusItem) return;
        if (!s) { this.statusItem.setText("AI Parser: idle"); return; }
        const pct = s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : undefined;
        this.statusItem.setText(`AI Parser: ${s.label}${pct!=null?` ${pct}%`:""}`);
      });
    } catch { /* if status bar plugin is disabled, no problem */ }

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ParserView(leaf, this));

    const open = async () => {
      const leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    };

    const openPopout = async () => {
      const leaf = this.app.workspace.openPopoutLeaf();
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    };

    this.addRibbonIcon("blocks", "AI History Parser", open);
    this.addCommand({ id: "aihp-open", name: "Open AI History Parser", callback: open });
    this.addCommand({ id: "aihp-popout", name: "Open AI History Parser (Pop-out)", callback: openPopout });
    this.addCommand({ id: "aihp-rebuild-ids", name: "Rebuild Stable IDs", callback: () => this.rebuildStableIds() });
    this.addCommand({ id: "aihp-reindex", name: "Reindex Search", callback: () => this.reindexSearch() });
    this.addCommand({ id: "aihp-export-graph", name: "Export to Graph", callback: () => this.exportToGraph() });
    this.addCommand({
      id: "aip-emit-native-graph",
      name: "Emit Native Graph (Projects ↔ Conversations ↔ Entities)",
      callback: async () => {
        try {
          const emitter = new GraphEmitter(this.app);
          const opts = {
            rootFolder: (this.settings as any).graphRoot || "_ai-graph",
            emitEntities: (this.settings as any).emitEntities ?? true,
            emitMonthHubs: (this.settings as any).emitMonthHubs ?? false,
            dryRun: false,
          };
          const projects: ProjectBucket[] = buildBucketsFromStore();
          await emitter.emit(projects, opts);
          new Notice("Graph notes updated.");
        } catch (e: any) {
          console.error(e);
          new Notice("Failed to emit graph notes. See console.");
        }
      }
    });

    this.addCommand({
      id: "aihp-graph-build",
      name: "Graph – Build from current results",
      callback: async () => {
        // This will be handled by the UI component
        new Notice("Use the Graph Builder controls in the right pane");
      }
    });

    this.addCommand({
      id: "aihp-debug-test",
      name: "Debug – Run Health Check",
      callback: async () => {
        console.log("🔍 Running health check...");
        console.log("Plugin:", !!this);
        console.log("Settings:", this.settings);
        console.log("App:", !!this.app);
        console.log("Vault:", !!this.app?.vault);
        console.log("Sources:", this.settings.sources);
        console.log("Active Sources:", this.settings.lastActiveSourceIds);
        new Notice("Health check complete - see console for details");
      }
    });

    this.addCommand({
      id: "aihp-test-source",
      name: "Debug – Test Add Source",
      callback: async () => {
        console.log("🧪 Testing source addition...");
        
        // Create a test source
        const testSource = {
          id: "test-chatgpt-" + Date.now(),
          vendor: "chatgpt" as const,
          root: "test-folder",
          addedAt: Date.now(),
          color: "#8bd0ff"
        };
        
        console.log("Test source:", testSource);
        
        // Add to settings
        const sources = [...this.settings.sources, testSource];
        await this.saveSetting('sources', sources);
        await this.saveSetting('lastActiveSourceIds', [...this.settings.lastActiveSourceIds, testSource.id]);
        
        console.log("✅ Test source added");
        new Notice("Test source added - check if it appears in the UI");
      }
    });

    this.addCommand({
      id: "aihp-debug-files",
      name: "Debug – List Source Files",
      callback: async () => {
        console.log("🔍 Debugging source files...");
        
        for (const source of this.settings.sources) {
          console.log(`\n📁 Source: ${source.id} (${source.root})`);
          
          try {
            const folder = this.app.vault.getAbstractFileByPath(source.root);
            if (!folder || !("children" in folder)) {
              console.log("❌ Folder not found or not accessible");
              continue;
            }
            
            console.log(`📂 Found ${folder.children.length} items:`);
            folder.children.forEach((child, index) => {
              console.log(`  ${index + 1}. ${child.name} (${child instanceof TFile ? 'file' : 'folder'})`);
              if (child instanceof TFile) {
                console.log(`     Size: ${child.stat.size} bytes`);
                console.log(`     Path: ${child.path}`);
              }
            });
            
            // Look for JSON files specifically
            const jsonFiles = folder.children.filter(child => 
              child instanceof TFile && child.extension === 'json'
            );
            console.log(`📄 JSON files found: ${jsonFiles.length}`);
            jsonFiles.forEach(f => console.log(`  - ${f.name}`));
            
          } catch (error) {
            console.error(`❌ Error accessing source ${source.id}:`, error);
          }
        }
        
        new Notice("Source file listing complete - see console for details");
      }
    });

    this.addSettingTab(new AHPSettingsTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(l => l.detach());
  }

  async saveSettings() { 
    await this.saveData(this.settings); 
  }

  async saveSetting<K extends keyof ParserSettings>(key: K, value: ParserSettings[K]) {
    this.settings[key] = value;
    await this.saveSettings();
  }

  async rebuildStableIds() {
    // This would trigger a rebuild of all stable IDs
    // Implementation would depend on the current data structure
    console.log("Rebuilding stable IDs...");
    // TODO: Implement stable ID rebuilding
  }

  async reindexSearch() {
    // This would trigger a reindex of the search cache
    console.log("Reindexing search...");
    // TODO: Implement search reindexing
  }

  async exportToGraph() {
    // This would export conversations to Obsidian graph format
    console.log("Exporting to graph...");
    // TODO: Implement graph export
  }
}

// Replace with your real data access: bucket by conversation.project (fallback "Misc")
function buildBucketsFromStore(): ProjectBucket[] {
  try {
    const convs = (getMessages?.() || []) as any[];
    const byProj = new Map<string, ProjectBucket>();
    for (const m of convs) {
      // Map FlatMessage → GraphConversation (one per conversation)
      const convKey = `${m.vendor}:${m.conversationId}`;
      const projName = (m.project?.trim?.() || m.title || "Misc").trim();
      if (!byProj.has(projName)) byProj.set(projName, { name: projName, conversations: [] });

      // Upsert conversation shell
      let conv = (byProj.get(projName)!.conversations as GraphConversation[]).find(c => c.id === convKey);
      if (!conv) {
        conv = {
          id: convKey,
          title: m.title || "(untitled)",
          date: m.createdAt,
          project: projName,
          entities: [],
          tags: [],
          urlSlug: undefined,
        } as GraphConversation;
        byProj.get(projName)!.conversations.push(conv);
      }

      // Optionally enrich entities/tags here if available on FlatMessage
      // e.g., if (m.entities) conv.entities = Array.from(new Set([...(conv.entities||[]), ...m.entities]));
    }
    return Array.from(byProj.values()).sort((a,b)=> a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

class AHPSettingsTab extends PluginSettingTab {
  plugin: AIHistoryParser;

  constructor(app: any, plugin: AIHistoryParser) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'AI History Parser Settings' });

    // Sources section
    containerEl.createEl('h3', { text: 'Data Sources' });
    
    new Setting(containerEl)
      .setName('Sources')
      .setDesc('Manage your AI conversation export folders')
      .addButton(button => button
        .setButtonText('Add Source')
        .setCta()
        .onClick(async () => {
          // This will be handled by the main view
          const leaf = this.app.workspace.getRightLeaf(false);
          await leaf.setViewState({ type: VIEW_TYPE, active: true });
          this.app.workspace.revealLeaf(leaf);
        }));

    // Display current sources
    if (this.plugin.settings.sources.length > 0) {
      this.plugin.settings.sources.forEach((source, index) => {
        const setting = new Setting(containerEl)
          .setName(`${source.vendor.toUpperCase()} - ${source.id}`)
          .setDesc(`Path: ${source.root}`)
          .addColorPicker(color => color
            .setValue(source.color || '#8bd0ff')
            .onChange(async (value) => {
              source.color = value;
              await this.plugin.saveSettings();
            }))
          .addButton(button => button
            .setButtonText('Remove')
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.sources.splice(index, 1);
              this.plugin.settings.lastActiveSourceIds = this.plugin.settings.lastActiveSourceIds.filter(id => id !== source.id);
              await this.plugin.saveSettings();
              this.display(); // Refresh
            }));
      });
    } else {
      containerEl.createEl('div', { 
        text: 'No sources configured. Use the main view to add your first export folder.',
        cls: 'setting-item-description',
        attr: { style: 'opacity: 0.7; font-style: italic;' }
      });
    }

    // Display settings
    containerEl.createEl('h3', { text: 'Display Settings' });

    new Setting(containerEl)
      .setName('Merge mode')
      .setDesc('How to display messages from multiple sources')
      .addDropdown(dropdown => dropdown
        .addOption('separate', 'Separate by source')
        .addOption('chronological', 'Merge chronologically')
        .addOption('linkOnly', 'Link only (no merge)')
        .setValue(this.plugin.settings.mergeMode)
        .onChange(async (value) => {
          this.plugin.settings.mergeMode = value as any;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Color theme for the interface')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Auto (follow Obsidian)')
        .addOption('dark', 'Dark')
        .addOption('light', 'Light')
        .setValue(this.plugin.settings.theme)
        .onChange(async (value) => {
          this.plugin.settings.theme = value as any;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Accent color')
      .setDesc('Primary accent color for the interface')
      .addColorPicker(color => color
        .setValue(this.plugin.settings.accent || '#8bd0ff')
        .onChange(async (value) => {
          this.plugin.settings.accent = value;
          await this.plugin.saveSettings();
        }));

    // Pane sizes
    new Setting(containerEl)
      .setName('Pane sizes')
      .setDesc('Left/right pane size percentages')
      .addText(text => text
        .setPlaceholder('32,68')
        .setValue(`${this.plugin.settings.paneSizes[0]},${this.plugin.settings.paneSizes[1]}`)
        .onChange(async (value) => {
          const parts = value.split(',').map(p => parseInt(p.trim()));
          if (parts.length === 2 && parts.every(p => !isNaN(p) && p > 0 && p < 100)) {
            this.plugin.settings.paneSizes = [parts[0], parts[1]];
            await this.plugin.saveSettings();
          }
        }));

    // Legacy support
    containerEl.createEl('h3', { text: 'Legacy Settings' });
    
    new Setting(containerEl)
      .setName('Export folder (legacy)')
      .setDesc('Legacy single-folder setting (for backward compatibility)')
      .addText(text => text
        .setPlaceholder('chatgpt-export')
        .setValue(this.plugin.settings.exportFolder)
        .onChange(async (value) => {
          const sanitized = sanitizeFolderPath(value);
          const validation = validateFolderPath(sanitized);
          
          if (validation.isValid) {
            this.plugin.settings.exportFolder = sanitized;
            await this.plugin.saveSettings();
          } else {
            console.warn('Invalid folder path:', validation.error);
          }
        }));

    containerEl.createEl('div', { 
      text: '💡 Tip: Use the main view to add multiple sources and manage your AI conversation exports.',
      cls: 'setting-item-description',
      attr: { style: 'margin-top: 20px; padding: 10px; background: var(--background-secondary); border-radius: 6px;' }
    });
  }
}
