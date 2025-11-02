
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
    // Version banner for debugging
    console.info("AIHP DB-first v0.9.99 loaded - Test Mode + Agent Macros enabled");
    
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

    // Agent Macros - one-click test commands for Cursor agent
    this.addCommand({
      id: "aihp-agent-test-sync",
      name: "Agent: Test Sync (slice)",
      callback: async () => {
        const { pythonPipeline } = this.settings;
        if (!pythonPipeline?.testMode?.enabled) {
          new Notice("⚠️ Test Mode must be enabled in settings");
          return;
        }
        
        if (this.settings.sources.length === 0) {
          new Notice("❌ No sources configured. Add a source first.");
          return;
        }
        
        const source = this.settings.sources[0]; // Use first source for test
        const leaf = this.app.workspace.getLeavesOfType("ai-history-parser-view")[0];
        if (leaf) {
          const view = leaf.view as any;
          if (view.handleTestSync) {
            await view.handleTestSync(source.id);
            new Notice("✅ Test Sync complete - check results");
          } else {
            new Notice("⚠️ Test Sync handler not available");
          }
        } else {
          new Notice("⚠️ Please open the AI History Parser view first");
        }
      }
    });

    this.addCommand({
      id: "aihp-agent-test-annotate",
      name: "Agent: Test Annotate (20)",
      callback: async () => {
        const { pythonPipeline } = this.settings;
        if (!pythonPipeline?.testMode?.enabled) {
          new Notice("⚠️ Test Mode must be enabled in settings");
          return;
        }
        
        if (!pythonPipeline?.aiAnnotation?.enabled) {
          new Notice("⚠️ AI Annotation must be enabled in settings");
          return;
        }
        
        const leaf = this.app.workspace.getLeavesOfType("ai-history-parser-view")[0];
        if (leaf) {
          const view = leaf.view as any;
          if (view.handleTestAnnotate) {
            await view.handleTestAnnotate();
            new Notice("✅ Test Annotate complete - check results");
          } else {
            new Notice("⚠️ Test Annotate handler not available");
          }
        } else {
          new Notice("⚠️ Please open the AI History Parser view first");
        }
      }
    });

    this.addCommand({
      id: "aihp-agent-test-export",
      name: "Agent: Test Export (Staging)",
      callback: async () => {
        const { pythonPipeline } = this.settings;
        if (!pythonPipeline?.testMode?.enabled) {
          new Notice("⚠️ Test Mode must be enabled in settings");
          return;
        }
        
        const leaf = this.app.workspace.getLeavesOfType("ai-history-parser-view")[0];
        if (leaf) {
          const view = leaf.view as any;
          if (view.handleTestExport) {
            await view.handleTestExport();
            new Notice(`✅ Test Export complete - check ${pythonPipeline.testMode.stagingFolder}`);
          } else {
            new Notice("⚠️ Test Export handler not available");
          }
        } else {
          new Notice("⚠️ Please open the AI History Parser view first");
        }
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
          .setName(`${(source.label || source.vendor.toUpperCase())}`)
          .setDesc(`ID: ${source.id}  •  Path: ${source.root}`)
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

    // Python Pipeline Configuration
    containerEl.createEl('h3', { text: 'Python Pipeline Configuration' });
    
    // Ensure pythonPipeline exists
    if (!this.plugin.settings.pythonPipeline) {
      this.plugin.settings.pythonPipeline = DEFAULT_SETTINGS.pythonPipeline!;
    }
    
    const pp = this.plugin.settings.pythonPipeline;
    
    // Database Path
    new Setting(containerEl)
      .setName('Database Path')
      .setDesc('SQLite database path (supports <vault> token for vault-relative paths)')
      .addText(text => text
        .setPlaceholder('C:\\Dev\\ai-history-parser\\ai_history.db')
        .setValue(pp.dbPath)
        .onChange(async (value) => {
          pp.dbPath = value;
          await this.plugin.saveSettings();
        }));
    
    // Python Executable
    new Setting(containerEl)
      .setName('Python Executable')
      .setDesc('Path to python.exe (or "python" if in PATH)')
      .addText(text => text
        .setPlaceholder('python')
        .setValue(pp.pythonExecutable)
        .onChange(async (value) => {
          pp.pythonExecutable = value;
          await this.plugin.saveSettings();
        }));
    
    // Scripts Root
    new Setting(containerEl)
      .setName('Scripts Root')
      .setDesc('Folder containing Python scripts (ai_history_to_sqlite_images.py, etc.)')
      .addText(text => text
        .setPlaceholder('C:\\Dev\\ai-history-parser')
        .setValue(pp.scriptsRoot)
        .onChange(async (value) => {
          pp.scriptsRoot = value;
          await this.plugin.saveSettings();
        }));
    
    // Media Source Folder
    new Setting(containerEl)
      .setName('Media Source Folder')
      .setDesc('Source media directory (where images are extracted and deduped)')
      .addText(text => text
        .setPlaceholder('C:\\Dev\\ai-history-parser\\media')
        .setValue(pp.mediaSourceFolder)
        .onChange(async (value) => {
          pp.mediaSourceFolder = value;
          await this.plugin.saveSettings();
        }));
    
    // Output Folder
    new Setting(containerEl)
      .setName('Output Folder')
      .setDesc('Vault-relative folder for exported Markdown files')
      .addText(text => text
        .setPlaceholder('AI-History')
        .setValue(pp.outputFolder)
        .onChange(async (value) => {
          pp.outputFolder = value;
          await this.plugin.saveSettings();
        }));
    
    // AI Annotation Section
    containerEl.createEl('h4', { text: 'AI Annotation (Optional)' });
    
    new Setting(containerEl)
      .setName('Enable AI Annotation')
      .setDesc('Automatically tag and summarize conversations using local LLM')
      .addToggle(toggle => toggle
        .setValue(pp.aiAnnotation.enabled)
        .onChange(async (value) => {
          pp.aiAnnotation.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide annotation settings
        }));
    
    if (pp.aiAnnotation.enabled) {
      new Setting(containerEl)
        .setName('Backend')
        .setDesc('LLM backend: Ollama or LM Studio (OpenAI-compatible)')
        .addDropdown(dropdown => dropdown
          .addOption('ollama', 'Ollama')
          .addOption('openai', 'LM Studio / OpenAI-compatible')
          .setValue(pp.aiAnnotation.backend)
          .onChange(async (value) => {
            pp.aiAnnotation.backend = value as 'ollama' | 'openai';
            await this.plugin.saveSettings();
          }));
      
      new Setting(containerEl)
        .setName('API URL')
        .setDesc('Base URL for LLM API')
        .addText(text => text
          .setPlaceholder('http://127.0.0.1:11434')
          .setValue(pp.aiAnnotation.url)
          .onChange(async (value) => {
            pp.aiAnnotation.url = value;
            await this.plugin.saveSettings();
          }));
      
      new Setting(containerEl)
        .setName('Model')
        .setDesc('Model name (e.g., llama3.2:3b-instruct)')
        .addText(text => text
          .setPlaceholder('llama3.2:3b-instruct')
          .setValue(pp.aiAnnotation.model)
          .onChange(async (value) => {
            pp.aiAnnotation.model = value;
            await this.plugin.saveSettings();
          }));
      
      new Setting(containerEl)
        .setName('Batch Size')
        .setDesc('Number of conversations to annotate per batch')
        .addText(text => text
          .setPlaceholder('100')
          .setValue(pp.aiAnnotation.batchSize.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.aiAnnotation.batchSize = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Max Characters')
        .setDesc('Maximum characters per conversation sent to model')
        .addText(text => text
          .setPlaceholder('8000')
          .setValue(pp.aiAnnotation.maxChars.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.aiAnnotation.maxChars = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Auto-annotate on Sync')
        .setDesc('Automatically annotate after syncing from backups')
        .addToggle(toggle => toggle
          .setValue(pp.aiAnnotation.autoAnnotate)
          .onChange(async (value) => {
            pp.aiAnnotation.autoAnnotate = value;
            await this.plugin.saveSettings();
          }));
    }
    
    // Export Settings Section
    containerEl.createEl('h4', { text: 'Export Settings' });
    
    new Setting(containerEl)
      .setName('Chunk Size')
      .setDesc('Characters per Markdown chunk')
      .addText(text => text
        .setPlaceholder('20000')
        .setValue(pp.exportSettings.chunkSize.toString())
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            pp.exportSettings.chunkSize = num;
            await this.plugin.saveSettings();
          }
        }));
    
    new Setting(containerEl)
      .setName('Overlap')
      .setDesc('Character overlap between chunks')
      .addText(text => text
        .setPlaceholder('500')
        .setValue(pp.exportSettings.overlap.toString())
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            pp.exportSettings.overlap = num;
            await this.plugin.saveSettings();
          }
        }));
    
    new Setting(containerEl)
      .setName('Link Cloud')
      .setDesc('Generate link cloud in exported notes')
      .addToggle(toggle => toggle
        .setValue(pp.exportSettings.linkCloud)
        .onChange(async (value) => {
          pp.exportSettings.linkCloud = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Add Hashtags')
      .setDesc('Add hashtags from annotations to exported notes')
      .addToggle(toggle => toggle
        .setValue(pp.exportSettings.addHashtags)
        .onChange(async (value) => {
          pp.exportSettings.addHashtags = value;
          await this.plugin.saveSettings();
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

    // Test Mode Section
    containerEl.createEl('h3', { text: 'Test Mode' });
    
    if (!pp.testMode) {
      pp.testMode = DEFAULT_SETTINGS.pythonPipeline!.testMode!;
    }
    
    new Setting(containerEl)
      .setName('Enable Test Mode')
      .setDesc('Run everything against Staging with limits for quick testing')
      .addToggle(toggle => toggle
        .setValue(pp.testMode!.enabled)
        .onChange(async (value) => {
          pp.testMode!.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide test mode settings
        }));
    
    if (pp.testMode!.enabled) {
      new Setting(containerEl)
        .setName('Staging Folder')
        .setDesc('Vault-relative folder for test exports (excluded from Omnisearch)')
        .addText(text => text
          .setPlaceholder('AI-Staging')
          .setValue(pp.testMode!.stagingFolder)
          .onChange(async (value) => {
            pp.testMode!.stagingFolder = value;
            await this.plugin.saveSettings();
          }));
      
      containerEl.createEl('h4', { text: 'Ingest Limits' });
      
      new Setting(containerEl)
        .setName('Max Sources')
        .setDesc('Maximum number of source folders to process')
        .addText(text => text
          .setPlaceholder('1')
          .setValue(pp.testMode!.ingestLimits.maxSources.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.testMode!.ingestLimits.maxSources = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Max Files')
        .setDesc('Maximum number of files to process')
        .addText(text => text
          .setPlaceholder('20')
          .setValue(pp.testMode!.ingestLimits.maxFiles.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.testMode!.ingestLimits.maxFiles = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Max Conversations')
        .setDesc('Maximum number of conversations to import')
        .addText(text => text
          .setPlaceholder('25')
          .setValue(pp.testMode!.ingestLimits.maxConversations.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.testMode!.ingestLimits.maxConversations = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Since Days (optional)')
        .setDesc('Only process conversations from the last N days')
        .addText(text => text
          .setPlaceholder('90')
          .setValue(pp.testMode!.ingestLimits.sinceDays?.toString() || '')
          .onChange(async (value) => {
            const num = parseInt(value);
            if (value === '' || (!isNaN(num) && num > 0)) {
              pp.testMode!.ingestLimits.sinceDays = value === '' ? undefined : num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Annotation Limit')
        .setDesc('Maximum conversations to annotate in test mode')
        .addText(text => text
          .setPlaceholder('20')
          .setValue(pp.testMode!.annotationLimit.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              pp.testMode!.annotationLimit = num;
              await this.plugin.saveSettings();
            }
          }));
      
      new Setting(containerEl)
        .setName('Auto Rebuild Omnisearch')
        .setDesc('Automatically rebuild Omnisearch index after export (disabled during testing)')
        .addToggle(toggle => toggle
          .setValue(pp.testMode!.autoRebuildOmnisearch)
          .onChange(async (value) => {
            pp.testMode!.autoRebuildOmnisearch = value;
            await this.plugin.saveSettings();
          }));
    }

    containerEl.createEl('div', { 
      text: '💡 Tip: Add backup source folders in the main view, then use "Sync from Backups" to import data. The plugin reads from the database, not directly from folders.',
      cls: 'setting-item-description',
      attr: { style: 'margin-top: 20px; padding: 10px; background: var(--background-secondary); border-radius: 6px;' }
    });
  }
}
