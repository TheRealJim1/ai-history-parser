import { ItemView, Modal, TAbstractFile, WorkspaceLeaf } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { parseMultipleSources, searchMessages, highlightText } from "./parser";
import { openDb, upsertBatch, saveDbToVault, loadDbFromVault, getStats } from "./db";
import { detectVendor, generateSourceId, pickColor } from "./settings";
import { MessageContent } from "./components/ToolBlock";
import { HeaderProgress } from "./components/HeaderProgress";
import { Paginator } from "./components/Paginator";
import { usePagination } from "./hooks/usePagination";
import { rankedMessageSearch, getSearchStats } from "./lib/score";
import { enableColumnResizers } from "./resize";
import { statusBus } from "./statusBus";
import GraphControls from "./ui/GraphControls";
import type { FlatMessage, Source, Vendor, SearchFacets, SearchProgress, ParseError } from "./types";
import type AIHistoryParser from "./main";

export const VIEW_TYPE = "ai-history-parser-view";

export class ParserView extends ItemView {
  plugin: AIHistoryParser;
  root?: ReactDOM.Root;

  constructor(leaf: WorkspaceLeaf, plugin: AIHistoryParser) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "AI History Parser"; }
  getIcon() { return "blocks"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("aihp-root");
    this.root = ReactDOM.createRoot(this.contentEl);
    this.root.render(<UI plugin={this.plugin} />);
  }

  async onClose() {
    this.root?.unmount();
  }
}

// Debounce hook for search
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Health check interface
interface HealthCheck {
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: any;
}

// Health check functions
function checkPluginHealth(plugin: AIHistoryParser): HealthCheck[] {
  const checks: HealthCheck[] = [];
  
  // Check plugin object
  if (!plugin) {
    checks.push({ status: 'error', message: 'Plugin object is null/undefined' });
    return checks;
  }
  
  // Check settings
  if (!plugin.settings) {
    checks.push({ status: 'error', message: 'Plugin settings are missing' });
  } else {
    if (!Array.isArray(plugin.settings.sources)) {
      checks.push({ status: 'warning', message: 'Settings sources is not an array', details: plugin.settings.sources });
    }
    if (!Array.isArray(plugin.settings.lastActiveSourceIds)) {
      checks.push({ status: 'warning', message: 'Settings lastActiveSourceIds is not an array', details: plugin.settings.lastActiveSourceIds });
    }
  }
  
  // Check app
  if (!plugin.app) {
    checks.push({ status: 'error', message: 'Plugin app is missing' });
  } else {
    if (!plugin.app.vault) {
      checks.push({ status: 'error', message: 'Plugin vault is missing' });
    }
  }
  
  return checks;
}

function checkMessagesHealth(messages: FlatMessage[]): HealthCheck[] {
  const checks: HealthCheck[] = [];
  
  if (!Array.isArray(messages)) {
    checks.push({ status: 'error', message: 'Messages is not an array', details: typeof messages });
    return checks;
  }
  
  if (messages.length === 0) {
    checks.push({ status: 'warning', message: 'No messages loaded' });
    return checks;
  }
  
  // Check message structure
  const invalidMessages = messages.filter(msg => 
    !msg.uid || !msg.vendor || !msg.text || !msg.conversationId
  );
  
  if (invalidMessages.length > 0) {
    checks.push({ 
      status: 'warning', 
      message: `${invalidMessages.length} messages have missing required fields`,
      details: invalidMessages.slice(0, 3) // Show first 3 invalid messages
    });
  }
  
  return checks;
}

function checkSourcesHealth(sources: Source[]): HealthCheck[] {
  const checks: HealthCheck[] = [];
  
  if (!Array.isArray(sources)) {
    checks.push({ status: 'error', message: 'Sources is not an array', details: typeof sources });
    return checks;
  }
  
  if (sources.length === 0) {
    checks.push({ status: 'warning', message: 'No sources configured' });
    return checks;
  }
  
  // Check source structure
  const invalidSources = sources.filter(source => 
    !source.id || !source.vendor || !source.root
  );
  
  if (invalidSources.length > 0) {
    checks.push({ 
      status: 'warning', 
      message: `${invalidSources.length} sources have missing required fields`,
      details: invalidSources
    });
  }
  
  return checks;
}

// Health check component
function HealthCheckPanel({ checks }: { checks: HealthCheck[] }) {
  if (checks.length === 0) return null;
  
  return (
    <div className="aip-health-panel">
      <h4>Health Check</h4>
      {checks.map((check, index) => (
        <div key={index} className={`aip-health-check aip-health-${check.status}`}>
          <strong>{check.status.toUpperCase()}:</strong> {check.message}
          {check.details && (
            <details style={{ marginTop: 4, fontSize: 11 }}>
              <summary>Details</summary>
              <pre style={{ margin: 4, fontSize: 10, overflow: 'auto' }}>
                {JSON.stringify(check.details, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// Main UI Component
function UI({ plugin }: { plugin: AIHistoryParser }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinHeader, setPinHeader] = useState<boolean>(() => {
    const v = localStorage.getItem("aip.pinHeader");
    return v ? v === "1" : true; // default: pinned
  });
  const [activeSources, setActiveSources] = useState<Set<string>>(
    new Set(plugin.settings.lastActiveSourceIds)
  );
  const [status, setStatus] = useState<"idle"|"loading"|"ready"|"error">("idle");
  const [error, setError] = useState<string>("");
  const [messages, setMessages] = useState<FlatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState(plugin.settings.lastQuery || "");
  const [facets, setFacets] = useState<SearchFacets>({
    vendor: 'all',
    role: 'any',
    titleBody: true,
    regex: false
  });
  const [searchProgress, setSearchProgress] = useState<SearchProgress>({
    isSearching: false,
    progress: 0,
    total: 0,
    current: 0
  });
  const [selectedMessage, setSelectedMessage] = useState<FlatMessage | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [dbStats, setDbStats] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  // Debounce search query
  const debouncedQuery = useDebounce(searchQuery, 300);

  // Calculate filter hash for pagination reset
  const filterHash = useMemo(() => {
    return JSON.stringify({
      q: debouncedQuery.trim(),
      vendor: facets.vendor,
      role: facets.role,
      from: facets.from,
      to: facets.to,
      regex: facets.regex,
      titleBody: facets.titleBody,
      sourceIds: Array.from(activeSources).sort()
    });
  }, [debouncedQuery, facets, activeSources]);

  // Filtered messages based on search and facets with ranking
  const filteredMessages = useMemo(() => {
    if (!messages.length) return [];
    
    let filtered: FlatMessage[];
    
    if (debouncedQuery.trim()) {
      // Use ranked search for better results
      filtered = rankedMessageSearch(messages, debouncedQuery, facets.regex || false, {
        vendor: facets.vendor,
        role: facets.role,
        from: facets.from ? new Date(facets.from).getTime() : undefined,
        to: facets.to ? new Date(facets.to).getTime() + 86400000 : undefined,
        sourceIds: Array.from(activeSources)
      });
    } else {
      // No query, just apply filters
      filtered = messages.filter(msg => {
        if (facets.vendor && facets.vendor !== 'all' && msg.vendor !== facets.vendor) return false;
        if (facets.role && facets.role !== 'any' && msg.role !== facets.role) return false;
        if (facets.from && msg.createdAt < new Date(facets.from).getTime()) return false;
        if (facets.to && msg.createdAt > new Date(facets.to).getTime() + 86400000) return false;
        if (activeSources.size > 0 && !activeSources.has(msg.sourceId)) return false;
        return true;
      });
    }
    
    return filtered;
  }, [messages, debouncedQuery, facets, activeSources]);

  // Handle search state separately
  useEffect(() => {
    if (debouncedQuery.trim()) {
      setIsSearching(true);
      const timer = setTimeout(() => setIsSearching(false), 100);
      return () => clearTimeout(timer);
    } else {
      setIsSearching(false);
    }
  }, [debouncedQuery]);

  // Group ALL filtered messages by conversation for the left list
  const groupedByConversation = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; vendor: string; count: number }>();
    for (const msg of filteredMessages) {
      const key = `${msg.vendor}:${msg.conversationId}`;
      if (!groups.has(key)) groups.set(key, { key, title: msg.title || "(untitled)", vendor: msg.vendor, count: 0 });
      groups.get(key)!.count++;
    }
    // Stable order: newest message title first by occurrence in filteredMessages
    return Array.from(groups.values());
  }, [filteredMessages]);

  // Selected conversation
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedConvKey && groupedByConversation.length > 0) {
      setSelectedConvKey(groupedByConversation[0].key);
    }
  }, [groupedByConversation, selectedConvKey]);

  // Messages for the selected conversation
  const selectedConvMessages = useMemo(() => {
    if (!selectedConvKey) return [] as FlatMessage[];
    return filteredMessages
      .filter(m => `${m.vendor}:${m.conversationId}` === selectedConvKey)
      .sort((a,b) => a.createdAt - b.createdAt);
  }, [filteredMessages, selectedConvKey]);

  // Pagination for the selected conversation messages (middle pane)
  const {
    page: msgPage,
    setPage: setMsgPage,
    pageCount: msgPageCount,
    pageSize: msgPageSize,
    setPageSize: setMsgPageSize,
    total: msgTotal,
    paged: pagedConvMessages,
    gotoFirst: msgFirst, gotoLast: msgLast, next: msgNext, prev: msgPrev
  } = usePagination(selectedConvMessages, {
    defaultPageSize: 100,
    persistKey: "aip.pageSize",
    currentFilterHash: `${filterHash}|conv=${selectedConvKey ?? ""}`
  });

  // Load messages from active sources with comprehensive error handling
  const loadMessages = useCallback(async () => {
    console.log("🔄 ===== LOADMESSAGES START =====");
    console.log("🔄 Starting loadMessages...");
    console.log("🔄 Plugin:", !!plugin);
    console.log("🔄 Plugin settings:", plugin?.settings);
    console.log("🔄 Active sources:", Array.from(activeSources));
    console.log("🔄 Current status:", status);
    console.log("🔄 Current error:", error);
    console.log("🔄 Current messages count:", messages.length);
    
    // Health check before starting
    const pluginChecks = checkPluginHealth(plugin);
    if (pluginChecks.some(c => c.status === 'error')) {
      console.error("❌ Plugin health check failed:", pluginChecks);
      setError("Plugin health check failed. See console for details.");
      setStatus("error");
      return;
    }

    const activeSourcesArray = plugin.settings.sources.filter(s => activeSources.has(s.id));
    console.log("🔄 Active sources array:", activeSourcesArray);
    console.log("🔄 Active sources array length:", activeSourcesArray.length);
    
    if (activeSourcesArray.length === 0) {
      console.log("⚠️ No active sources, clearing messages");
      setMessages([]);
      setStatus("idle");
      console.log("🔄 ===== LOADMESSAGES END (NO SOURCES) =====");
      return;
    }

    setStatus("loading");
    setError("");

    console.log("📊 Starting status bus task...");
    const task = statusBus.begin({ 
      id: "index", 
      label: "Indexing exports", 
      total: activeSourcesArray.length, 
      canCancel: true 
    });
    console.log("📊 Status bus task created:", task);

    try {
      let completed = 0;
      const allMessages: FlatMessage[] = [];
      const allErrors: ParseError[] = [];

      console.log("🔄 Starting to process sources...");
      for (const source of activeSourcesArray) {
        if (task.isCancelled()) {
          console.log("🔄 Task cancelled, breaking loop");
          break;
        }

        console.log(`📁 ===== PROCESSING SOURCE ${completed + 1}/${activeSourcesArray.length} =====`);
        console.log(`📁 Processing source: ${source.id} (${source.root})`);
        console.log("📊 Setting task sublabel...");
        task.setSub(source.root.split(/[\\/]/).slice(-2).join("/"));
        
        // Start indeterminate while discovering files
        console.log("📊 Setting task indeterminate...");
        task.indeterminate(true);
        
        try {
          console.log("🔄 Calling parseMultipleSources...");
          const result = await parseMultipleSources(plugin.app, [source]);
          console.log(`✅ Parsed ${result.messages.length} messages from ${source.id}`);
          console.log(`✅ Parse errors: ${result.errors.length}`);
          
          task.indeterminate(false);
          task.setTotal(result.messages.length);
          
          let processed = 0;
          console.log("🔄 Processing individual messages...");
          for (const msg of result.messages) {
            if (task.isCancelled()) {
              console.log("🔄 Task cancelled during message processing");
              break;
            }
            
            // Validate message structure
            if (!msg.uid || !msg.vendor || !msg.text || !msg.conversationId) {
              console.warn("⚠️ Invalid message structure:", msg);
              continue;
            }
            
            allMessages.push(msg);
            processed++;
            if (processed % 50 === 0) {
              console.log(`🔄 Processed ${processed}/${result.messages.length} messages`);
              task.stepTo(processed);
              await new Promise(r => setTimeout(r, 0)); // Yield to UI
            }
          }
          
          console.log(`✅ Finished processing ${processed} messages from ${source.id}`);
          allErrors.push(...result.errors);
        } catch (sourceError) {
          console.error(`❌ Error processing source ${source.id}:`, sourceError);
          console.error(`❌ Source error details:`, {
            message: sourceError.message,
            stack: sourceError.stack,
            name: sourceError.name
          });
          allErrors.push({
            source: source.root,
            error: String(sourceError),
            timestamp: Date.now()
          });
        }
        
        completed++;
        console.log(`📁 Completed source ${completed}/${activeSourcesArray.length}`);
        task.tick(0); // Keep speed/ETA in sync
      }

      console.log(`📊 ===== LOADMESSAGES COMPLETION =====`);
      console.log(`📊 Loaded ${allMessages.length} messages total`);
      console.log(`⚠️ ${allErrors.length} errors occurred`);

      if (allErrors.length > 0) {
        console.warn("Parse errors:", allErrors);
        setError(`${allErrors.length} errors occurred during parsing`);
      }

      console.log("🔄 Setting messages state...");
      setMessages(allMessages);
      console.log("🔄 Setting status to ready...");
      setStatus("ready");
      console.log("📊 Ending status bus task...");
      task.end();
      console.log("📊 Status bus task ended");
      console.log("🔄 ===== LOADMESSAGES SUCCESS =====");
    } catch (e: any) {
      console.error("❌ ===== LOADMESSAGES FATAL ERROR =====");
      console.error("❌ Fatal error in loadMessages:", e);
      console.error("❌ Fatal error details:", {
        message: e?.message,
        stack: e?.stack,
        name: e?.name
      });
      setStatus("error");
      setError(String(e?.message ?? e));
      task.fail(e?.message);
      console.error("❌ ===== LOADMESSAGES FAILED =====");
    }
  }, [plugin, activeSources]);

  // Add new source
  const addSource = useCallback(async () => {
    console.log("➕ Adding new source...");
    
    try {
      const chosen = await new FolderSuggestModal(plugin).openAndPick();
      if (!chosen) {
        console.log("❌ No folder chosen");
        return;
      }

      console.log("📁 Chosen folder:", chosen);

      const vendor = detectVendor(chosen, '');
      const id = generateSourceId(vendor, chosen);
      const color = pickColor();

      console.log("🏷️ Generated source:", { id, vendor, color });

      const newSource: Source = {
        id,
        vendor,
        root: chosen,
        addedAt: Date.now(),
        color
      };

      console.log("💾 Saving new source...");
      const sources = [...plugin.settings.sources, newSource];
      await plugin.saveSetting('sources', sources);
      await plugin.saveSetting('lastActiveSourceIds', [...activeSources, id]);
      
      console.log("✅ Source saved, updating UI...");
      setActiveSources(prev => new Set([...prev, id]));
      
      // The useEffect will automatically trigger loadMessages when activeSources changes
      
    } catch (error) {
      console.error("❌ Error adding source:", error);
      setError(`Failed to add source: ${error}`);
    }
  }, [plugin, activeSources]);

  // Toggle source active state
  const toggleSource = useCallback(async (sourceId: string) => {
    console.log("🔄 Toggling source:", sourceId);
    console.log("Current active sources:", Array.from(activeSources));
    
    const next = new Set(activeSources);
    if (next.has(sourceId)) {
      next.delete(sourceId);
      console.log("➖ Removed source:", sourceId);
    } else {
      next.add(sourceId);
      console.log("➕ Added source:", sourceId);
    }
    
    console.log("New active sources:", Array.from(next));
    setActiveSources(next);
    await plugin.saveSetting('lastActiveSourceIds', Array.from(next));
  }, [activeSources, plugin]);

  // Import to SQLite
  const importToDb = useCallback(async () => {
    setIsImporting(true);
    
    try {
      await openDb();
      upsertBatch(filteredMessages.length > 0 ? filteredMessages : messages);
      await saveDbToVault(plugin);
      
      // Update stats
      const stats = getStats();
      setDbStats(stats);
    } catch (error) {
      console.error("Import failed:", error);
      setError(`Import failed: ${error}`);
    } finally {
      setIsImporting(false);
    }
  }, [plugin, filteredMessages, messages]);

  // Load database stats
  const loadDbStats = useCallback(async () => {
    try {
      const dbData = await loadDbFromVault(plugin);
      if (dbData) {
        await openDb(dbData);
        const stats = getStats();
        setDbStats(stats);
      }
    } catch (error) {
      console.warn("Failed to load database stats:", error);
    }
  }, [plugin]);

  // Load messages when active sources change
  useEffect(() => {
    console.log("🔄 useEffect triggered - activeSources changed:", Array.from(activeSources));
    loadMessages();
  }, [activeSources]);

  // Load database stats on mount
  useEffect(() => {
    loadDbStats();
  }, [loadDbStats]);

  // Function to fetch current messages for graph building
  const getMessagesForCurrentView = useCallback(async () => {
    console.log("📊 getMessagesForCurrentView called, filteredMessages length:", filteredMessages.length);
    return filteredMessages.map(msg => ({
      id: msg.uid,
      role: msg.role,
      text: msg.text,
      ts: msg.createdAt,
      convId: msg.conversationId,
      convTitle: msg.title || "(untitled)",
      sourceId: msg.sourceId
    }));
  }, [filteredMessages]);

  // Save search query
  useEffect(() => {
    plugin.saveSetting('lastQuery', searchQuery);
  }, [searchQuery, plugin]);

  // Enable column resizers
  useEffect(() => {
    if (rootRef.current) {
      enableColumnResizers(rootRef.current);
    }
  }, []);

  // Save pin header state
  useEffect(() => {
    localStorage.setItem("aip.pinHeader", pinHeader ? "1" : "0");
  }, [pinHeader]);

  // Keyboard navigation for pagination
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "ArrowRight") msgNext();
      if (e.ctrlKey && e.key === "ArrowLeft") msgPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [msgNext, msgPrev]);

  return (
    <div ref={rootRef} className="aip-root">
      {/* Sticky Header */}
      <header className={`aip-header ${pinHeader ? "is-sticky" : ""}`}>
        <div className="aip-header-row">
          {/* LEFT: App title + status */}
          <div className="aip-header-left">
            <strong>AI History Parser</strong>
            <span className="aip-dot" />
            <span className="aip-status">
              {status === "idle" && "Ready"}
              {status === "loading" && "Indexing…"}
              {status === "ready" && `${messages.length} messages`}
              {status === "error" && "Error"}
            </span>
          </div>

          {/* MIDDLE: Primary controls */}
          <div className="aip-header-center">
            <button className="aihp-btn" onClick={addSource}>Add Source…</button>
            <button className="aihp-btn primary" onClick={loadMessages}>Load & Index</button>
            
            <select 
              title="Merge mode"
              value={plugin.settings.mergeMode} 
              onChange={e => plugin.saveSetting('mergeMode', e.target.value as any)}
            >
              <option value="separate">View: Separate</option>
              <option value="chronological">View: Merge (time)</option>
              <option value="linkOnly">View: Link Only</option>
            </select>

            <input
              className="aihp-input search"
              placeholder="Search messages… (regex ok)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />

            <button 
              className="aihp-btn" 
              onClick={importToDb}
              disabled={isImporting || messages.length === 0}
            >
              {isImporting ? 'Importing...' : 'Import → SQLite'}
            </button>
          </div>

          {/* RIGHT: Header actions */}
          <div className="aip-header-right">
            <button 
              className="aihp-btn"
              onClick={() => plugin.app.workspace.openPopoutLeaf().setViewState({ type: VIEW_TYPE, active: true })}
            >
              Pop-out
            </button>
            <label className="aip-toggle">
              <input
                type="checkbox"
                checked={pinHeader}
                onChange={(e) => setPinHeader(e.target.checked)}
              />
              <span>Pin header</span>
            </label>
          </div>
        </div>

        {/* Source Manager Row */}
        <div className="aip-sources-row">
          <div className="aip-sources-header">
            <span>Active Sources:</span>
            <span className="aip-sources-count">{activeSources.size} selected</span>
          </div>
          <div className="aip-chips">
            {plugin.settings.sources.map(source => (
              <span
                key={source.id}
                className={`aihp-chip ${activeSources.has(source.id) ? 'active' : 'inactive'}`}
                style={{ borderColor: source.color || '#666' }}
                onClick={() => toggleSource(source.id)}
                title={`${source.vendor.toUpperCase()} - ${source.root}`}
              >
                {source.id}
              </span>
            ))}
          </div>
        </div>

        {/* Search Facets Row */}
        <div className="aip-facets-row">
          <select 
            title="Vendor filter"
            value={facets.vendor} 
            onChange={e => setFacets(prev => ({ ...prev, vendor: e.target.value as any }))}
          >
            <option value="all">All vendors</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="grok">Grok</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>

          <select 
            title="Role filter"
            value={facets.role} 
            onChange={e => setFacets(prev => ({ ...prev, role: e.target.value as any }))}
          >
            <option value="any">Any role</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
            <option value="tool">Tool</option>
            <option value="system">System</option>
          </select>

          <input
            type="date"
            value={facets.from || ''}
            onChange={e => setFacets(prev => ({ ...prev, from: e.target.value || undefined }))}
            placeholder="From date"
          />

          <input
            type="date"
            value={facets.to || ''}
            onChange={e => setFacets(prev => ({ ...prev, to: e.target.value || undefined }))}
            placeholder="To date"
          />

          <label className="aihp-toggle">
            <input 
              type="checkbox" 
              checked={facets.regex} 
              onChange={e => setFacets(prev => ({ ...prev, regex: e.target.checked }))} 
            />
            <span>regex</span>
          </label>

          <label className="aihp-toggle">
            <input 
              type="checkbox" 
              checked={facets.titleBody} 
              onChange={e => setFacets(prev => ({ ...prev, titleBody: e.target.checked }))} 
            />
            <span>title+body</span>
          </label>
        </div>

        {/* Progress Bar */}
        <HeaderProgress />
      </header>

      {/* Body: 3 columns (left list, center detail, right filters) */}
      <div className="aip-body">
        {/* Left Pane: Conversation List */}
        <section className="aip-pane aip-left">
          <div className="aip-pane-header">
            {status === "loading" && <span>Loading…</span>}
            {status === "ready" && (
              <span>
                {groupedByConversation.length.toLocaleString()} conversations
                {dbStats && ` • ${dbStats.totalMessages} msgs in DB`}
              </span>
            )}
            {status === "error" && <span className="aihp-err">{error}</span>}
            {searchProgress.isSearching && (
              <span>Searching... {searchProgress.current}/{searchProgress.total}</span>
            )}
          </div>
          
          <div className="aip-messages">
            {status === "loading" ? (
              <div>
                <div className="aip-skeleton skel-row" />
                <div className="aip-skeleton skel-row" />
                <div className="aip-skeleton skel-card" />
                <div className="aip-skeleton skel-row" />
                <div className="aip-skeleton skel-card" />
                <div className="aip-skeleton skel-row" />
              </div>
            ) : (
              groupedByConversation.map(g => (
                <div
                  key={g.key}
                  className={`aihp-conversation ${selectedConvKey === g.key ? 'selected' : ''}`}
                  onClick={() => setSelectedConvKey(g.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="aihp-conv-header">
                    <span className="aihp-conv-title">{g.title || "(untitled)"}</span>
                    <span className="aihp-conv-meta">{g.vendor} • {g.count} msgs</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Center Pane: Selected Conversation Messages + Pagination */}
        <section className="aip-pane aip-center">
          {isSearching && (
            <div className="aip-overlay">
              <div>
                <div className="aip-progress-bar" style={{ width: 240 }}>
                  <div className="aip-progress-fill is-indeterminate" />
                </div>
                <div style={{ marginTop: 8, textAlign: "center", fontSize: 12 }}>Searching…</div>
              </div>
            </div>
          )}
          
          {selectedConvMessages.length === 0 && (
            <div className="aihp-empty">Select a conversation from the left</div>
          )}

          {selectedConvMessages.length > 0 && (
            <div className="aihp-message-detail">
              <div className="aihp-detail-header">
                <h3>{selectedConvMessages[0].title || "(untitled)"}</h3>
                <div className="aihp-detail-meta">{new Date(selectedConvMessages[0].createdAt).toLocaleString()}</div>
              </div>

              {pagedConvMessages.map(msg => (
                <div key={msg.uid} className="aihp-message" onClick={() => setSelectedMessage(msg)}>
                  <span className={`aihp-role aihp-role-${msg.role}`}>{msg.role}</span>
                  <MessageContent
                    text={msg.text}
                    toolName={(msg as any).toolName}
                    toolPayload={(msg as any).toolJson ? JSON.parse((msg as any).toolJson) : null}
                    query={debouncedQuery}
                    useRegex={facets.regex}
                    highlightText={highlightText}
                  />
                  <div className="aihp-message-meta">{new Date(msg.createdAt).toLocaleString()}</div>
                </div>
              ))}

              <Paginator
                page={msgPage}
                pageCount={msgPageCount}
                pageSize={msgPageSize}
                setPageSize={setMsgPageSize}
                total={msgTotal}
                gotoFirst={msgFirst}
                gotoLast={msgLast}
                next={msgNext}
                prev={msgPrev}
              />
            </div>
          )}
        </section>

        {/* Right Pane: Filters & Stats */}
        <aside className="aip-pane aip-right">
          <div className="aip-pane-header">
            <span>Filters & Stats</span>
          </div>
          
          <div className="aip-filters">
            <h4>Search Statistics</h4>
            <div className="aip-stats">
              <div>Total Messages: {messages.length.toLocaleString()}</div>
              <div>Filtered: {filteredMessages.length.toLocaleString()}</div>
              <div>Showing: {pagedConvMessages.length.toLocaleString()}</div>
              <div>Page: {msgPage} / {msgPageCount}</div>
              <div>Active Sources: {activeSources.size}</div>
              {dbStats && (
                <>
                  <div>In Database: {dbStats.totalMessages.toLocaleString()}</div>
                  <div>Conversations: {dbStats.totalConversations.toLocaleString()}</div>
                </>
              )}
            </div>

            <h4>Vendor Breakdown</h4>
            <div className="aip-vendor-stats">
              {Object.entries(
                filteredMessages.reduce((acc, msg) => {
                  acc[msg.vendor] = (acc[msg.vendor] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([vendor, count]) => (
                <div key={vendor} className="aip-vendor-item">
                  <span className="aip-vendor-name">{vendor.toUpperCase()}</span>
                  <span className="aip-vendor-count">{count}</span>
                </div>
              ))}
            </div>

            <h4>Graph Builder</h4>
            <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
              <p>Graph Builder temporarily disabled for debugging</p>
              {/* <GraphControls 
                app={plugin.app} 
                fetchCurrentMessages={getMessagesForCurrentView} 
              /> */}
            </div>

            <h4>Debug & Health</h4>
            <div className="aip-debug-controls">
              <label className="aip-toggle">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                />
                <span>Debug Mode</span>
              </label>
              <button 
                onClick={() => {
                  console.log("🧪 Test State button clicked!");
                  console.log("🧪 Manual test - current state:");
                  console.log("Messages:", messages.length);
                  console.log("Filtered:", filteredMessages.length);
                  console.log("Active Sources:", Array.from(activeSources));
                  console.log("Status:", status);
                  console.log("Error:", error);
                  console.log("Plugin:", !!plugin);
                  console.log("Plugin settings:", plugin?.settings);
                }}
                style={{ 
                  marginLeft: '8px', 
                  padding: '6px 12px', 
                  fontSize: '12px',
                  backgroundColor: '#007acc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Test State
              </button>
              <button 
                onClick={async () => {
                  console.log("🧪 Test Load button clicked!");
                  console.log("🧪 Testing direct loadMessages...");
                  try {
                    await loadMessages();
                    console.log("✅ loadMessages completed");
                  } catch (e) {
                    console.error("❌ loadMessages failed:", e);
                  }
                }}
                style={{ 
                  marginLeft: '8px', 
                  padding: '6px 12px', 
                  fontSize: '12px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Test Load
              </button>
              <button 
                onClick={() => {
                  console.log("🧪 Test Status button clicked!");
                  console.log("🧪 Testing status bar...");
                  const task = statusBus.begin({
                    id: "test",
                    label: "Testing Status Bar",
                    total: 10,
                    canCancel: true
                  });
                  
                  let i = 0;
                  const interval = setInterval(() => {
                    i++;
                    task.tick(1);
                    if (i >= 10) {
                      clearInterval(interval);
                      task.end();
                    }
                  }, 500);
                }}
                style={{ 
                  marginLeft: '8px', 
                  padding: '6px 12px', 
                  fontSize: '12px',
                  backgroundColor: '#ffc107',
                  color: 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Test Status
              </button>
              <button 
                onClick={() => {
                  console.log("🧪 Test Direct button clicked!");
                  console.log("🧪 Testing direct status bar...");
                  // Find the status bar element directly
                  const statusBar = document.querySelector('.aihp-status-bar');
                  if (statusBar) {
                    console.log("📊 Found status bar element:", statusBar);
                    console.log("📊 Status bar text:", statusBar.textContent);
                    console.log("📊 Status bar visible:", statusBar.offsetParent !== null);
                    statusBar.textContent = "Direct Test: Working!";
                    statusBar.style.backgroundColor = "red";
                    statusBar.style.color = "white";
                    setTimeout(() => {
                      statusBar.textContent = "AI Parser: idle";
                      statusBar.style.backgroundColor = "";
                      statusBar.style.color = "";
                    }, 2000);
                  } else {
                    console.log("❌ Status bar element not found!");
                  }
                }}
                style={{ 
                  marginLeft: '8px', 
                  padding: '6px 12px', 
                  fontSize: '12px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Test Direct
              </button>
              <button 
                onClick={() => {
                  console.log("🧪 Test Header button clicked!");
                  console.log("🧪 Testing HeaderProgress...");
                  const task = statusBus.begin({
                    id: "header-test",
                    label: "Testing Header Progress",
                    total: 5,
                    canCancel: true
                  });
                  
                  let i = 0;
                  const interval = setInterval(() => {
                    i++;
                    task.tick(1);
                    task.setSub(`Step ${i}/5`);
                    if (i >= 5) {
                      clearInterval(interval);
                      setTimeout(() => task.end(), 500);
                    }
                  }, 1000);
                }}
                style={{ 
                  marginLeft: '8px', 
                  padding: '6px 12px', 
                  fontSize: '12px',
                  backgroundColor: '#6f42c1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Test Header
              </button>
            </div>

            {debugMode && (
              <>
                <HealthCheckPanel checks={checkPluginHealth(plugin)} />
                <HealthCheckPanel checks={checkSourcesHealth(plugin.settings.sources)} />
                <HealthCheckPanel checks={checkMessagesHealth(messages)} />
                
                <div className="aip-debug-info">
                  <h5>Debug Info</h5>
                  <div><strong>Status:</strong> {status}</div>
                  <div><strong>Messages:</strong> {messages.length}</div>
                  <div><strong>Active Sources:</strong> {activeSources.size}</div>
                  <div><strong>Filtered Messages:</strong> {filteredMessages.length}</div>
                  <div><strong>Selected Conv:</strong> {selectedConvKey || 'none'}</div>
                  <div><strong>Selected Conv Messages:</strong> {selectedConvMessages.length}</div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* Folder picker modal */
class FolderSuggestModal extends Modal {
  plugin: AIHistoryParser;
  resolve!: (v: string | null) => void;
  picked: string | null = null;

  constructor(plugin: AIHistoryParser) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    this.titleEl.setText("Pick a folder in this vault");
    const body = this.contentEl.createDiv({ cls: "aihp-modal" });
    const input = body.createEl("input", { 
      type: "text", 
      value: "", 
      cls: "aihp-input",
      placeholder: "Enter folder path or browse below..."
    });
    const list = body.createEl("div", { cls: "aihp-folder-list" });

    const folders: string[] = [];
    const collect = (f: TAbstractFile) => {
      if ("children" in f) {
        folders.push(f.path);
        for (const c of f.children) collect(c);
      }
    };
    collect(this.app.vault.getRoot());

    for (const f of folders.filter(Boolean)) {
      const item = list.createDiv({ text: f, cls: "aihp-folder-item" });
      item.onClickEvent(() => { input.value = f; });
    }

    const bar = body.createDiv({ cls: "aihp-modal-actions" });
    const ok = bar.createEl("button", { text: "Use folder" });
    const cancel = bar.createEl("button", { text: "Cancel" });
    ok.onClickEvent(() => { this.picked = input.value.trim(); this.close(); });
    cancel.onClickEvent(() => { this.picked = null; this.close(); });
  }

  onClose() { 
    this.contentEl.empty(); 
    this.resolve(this.picked); 
  }

  openAndPick(): Promise<string | null> { 
    super.open(); 
    return new Promise(res => this.resolve = res); 
  }
}