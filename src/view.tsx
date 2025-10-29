import { ItemView, Modal, TAbstractFile, WorkspaceLeaf } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { parseMultipleSources, searchMessages, highlightText } from "./parser";
import { detectVendor, generateSourceId, pickColor } from "./settings";
import { MessageContent } from "./components/ToolBlock";
import { HeaderProgress } from "./ui/HeaderProgress";
import { Paginator } from "./components/Paginator";
import { usePagination } from "./hooks/usePagination";
import { rankedMessageSearch, getSearchStats } from "./lib/score";
import { enableColumnResizers } from "./resize";
import { statusBus } from "./ui/status";
import GraphControls from "./ui/GraphControls";
import TestView from "./ui/TestView";
import { buildConvIndex } from "./lib/convIndex";
import { groupTurns } from "./lib/grouping";
import { LoadingSpinner, LoadingOverlay, LoadingButton } from "./ui/LoadingSpinner";
import { ConversationCard } from "./ui/ConversationCard";
import { MultiSelectToolbar } from "./ui/MultiSelectToolbar";
import type { FlatMessage, Source, Vendor, SearchFacets, SearchProgress, ParseError } from "./types";
import type AIHistoryParser from "./main";

// Import the CSS
import "../styles/tw.css";

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

// Main UI Component with SQLite + TanStack Query
function UI({ plugin }: { plugin: AIHistoryParser }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinHeader, setPinHeader] = useState<boolean>(() => {
    const v = localStorage.getItem("aip.pinHeader");
    return v ? v === "1" : true; // default: pinned
  });
  const [activeSources, setActiveSources] = useState<Set<string>>(
    new Set(plugin.settings.lastActiveSourceIds)
  );
  const [searchQuery, setSearchQuery] = useState(plugin.settings.lastQuery || "");
  const [facets, setFacets] = useState<SearchFacets>({
    vendor: 'all',
    role: 'any',
    titleBody: true,
    regex: false
  });
  const [selectedMessage, setSelectedMessage] = useState<FlatMessage | null>(null);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [conversationLoading, setConversationLoading] = useState<Set<string>>(new Set());

  // Local state for messages and database
  const [messages, setMessages] = useState<FlatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  
  // Database stats
  const [dbStats, setDbStats] = useState({ totalMessages: 0, totalConversations: 0, sources: 0, lastUpdated: 0 });
  const [statsLoading, setStatsLoading] = useState(false);
  
  // Legacy state for compatibility (will be replaced by TanStack Query)
  const [status, setStatus] = useState<"idle"|"loading"|"ready"|"error">("idle");
  const [error, setError] = useState<string>("");
  const [searchProgress, setSearchProgress] = useState<SearchProgress>({
    isSearching: false,
    progress: 0,
    total: 0,
    current: 0
  });

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

  // Filter messages based on search and facets with ranking
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

  // Build conversation index using the new robust parser
  const groupedByConversation = useMemo(() => {
    console.log("🔄 Building conversation index from", filteredMessages.length, "messages");
    
    // First deduplicate messages by uid to prevent duplicates
    const uniqueMessages = new Map<string, FlatMessage>();
    for (const msg of filteredMessages) {
      uniqueMessages.set(msg.uid, msg);
    }
    const deduplicatedMessages = Array.from(uniqueMessages.values());
    console.log("🔄 After deduplication:", deduplicatedMessages.length, "unique messages");
    
    // Convert FlatMessage to ParsedMsg format for the index builder
    const parsedMessages = deduplicatedMessages.map(msg => ({
      id: msg.messageId,
      convId: msg.conversationId, // This is already in the format "vendor:convId"
      convTitle: msg.title,
      role: msg.role as 'user'|'assistant'|'tool'|'system',
      ts: msg.createdAt,
      text: msg.text,
      vendor: 'CHATGPT' as const
    }));
    
    const index = buildConvIndex(parsedMessages);
    console.log("🔄 Built index with", index.length, "conversations");
    
    // Convert to the format expected by the UI
    const result = index.map(conv => ({
      key: conv.convId, // This is already in the format "vendor:convId"
      title: conv.title,
      vendor: conv.vendor,
      count: conv.msgCount,
      lastMessage: { createdAt: conv.lastTs } as FlatMessage, // For sorting compatibility
      firstTs: conv.firstTs,
      lastTs: conv.lastTs
    }));
    
    console.log("🔄 First few conversations:", result.slice(0, 3).map(g => ({ 
      title: g.title, 
      count: g.count, 
      vendor: g.vendor,
      firstTs: new Date(g.firstTs).toLocaleString(),
      lastTs: new Date(g.lastTs).toLocaleString()
    })));
    
    return result;
  }, [filteredMessages]);

  // Selected conversations (multi-select)
  const [selectedConvKeys, setSelectedConvKeys] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [useNewView, setUseNewView] = useState(false);
  
  // Pagination for conversation list
  const {
    page: convPage,
    setPage: setConvPage,
    pageCount: convPageCount,
    pageSize: convPageSize,
    setPageSize: setConvPageSize,
    total: convTotal,
    paged: pagedConversations,
    gotoFirst: convFirst, 
    gotoLast: convLast, 
    next: convNext, 
    prev: convPrev
  } = usePagination(groupedByConversation, {
    defaultPageSize: 50,
    persistKey: "aip.convPageSize",
    currentFilterHash: filterHash
  });

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (selectedConvKeys.size === 0 && pagedConversations.length > 0) {
      setSelectedConvKeys(new Set([pagedConversations[0].key]));
    }
  }, [pagedConversations, selectedConvKeys]);

  // Handle conversation selection
  const handleConvClick = (convKey: string, ctrlKey: boolean) => {
    console.log("🔄 Conversation clicked:", convKey);
    console.log("🔄 Multi-select mode:", multiSelectMode);
    console.log("🔄 Ctrl key:", ctrlKey);
    console.log("🔄 Current selected keys:", Array.from(selectedConvKeys));
    
    if (multiSelectMode || ctrlKey) {
      setSelectedConvKeys(prev => {
        const newSet = new Set(prev);
        if (newSet.has(convKey)) {
          newSet.delete(convKey);
        } else {
          newSet.add(convKey);
        }
        console.log("🔄 New selected keys:", Array.from(newSet));
        return newSet;
      });
    } else {
      setSelectedConvKeys(new Set([convKey]));
      console.log("🔄 Single select, new selected keys:", [convKey]);
    }
  };

  // Messages for the selected conversations
  const selectedConvMessages = useMemo(() => {
    console.log("🔄 Filtering messages for selected conversations");
    console.log("🔄 Selected conv keys:", Array.from(selectedConvKeys));
    console.log("🔄 Total filtered messages:", filteredMessages.length);
    
    if (selectedConvKeys.size === 0) {
      console.log("🔄 No conversations selected, returning empty messages");
      return [] as FlatMessage[];
    }
    
    const selected = filteredMessages
      .filter(m => selectedConvKeys.has(m.conversationId))
      .sort((a,b) => a.createdAt - b.createdAt);
    
    console.log("🔄 Selected messages:", selected.length);
    console.log("🔄 Sample selected message:", selected[0]);
    
    return selected;
  }, [filteredMessages, selectedConvKeys]);

  // Group messages into turns for better display
  const selectedConvTurns = useMemo(() => {
    console.log("🔄 Building turns from", selectedConvMessages.length, "selected messages");
    
    if (selectedConvMessages.length === 0) {
      console.log("🔄 No selected messages, returning empty turns");
      return [];
    }
    
    // Convert to ParsedMsg format for turn grouping
    const parsedMessages = selectedConvMessages.map(msg => ({
      id: msg.messageId,
      convId: msg.conversationId,
      convTitle: msg.title,
      role: msg.role as 'user'|'assistant'|'tool'|'system',
      ts: msg.createdAt,
      text: msg.text,
      vendor: 'CHATGPT' as const
    }));
    
    console.log("🔄 Converted to parsed messages:", parsedMessages.length);
    console.log("🔄 Sample parsed message:", parsedMessages[0]);
    
    const turns = groupTurns(parsedMessages, 7 * 60 * 1000); // 7 minute gap
    console.log("🔄 Grouped into", turns.length, "turns");
    console.log("🔄 Sample turn:", turns[0]);
    
    return turns;
  }, [selectedConvMessages]);

  // Multi-select helper functions
  const handleToggleMultiSelect = useCallback(() => {
    setIsMultiSelectMode(prev => !prev);
    if (isMultiSelectMode) {
      setSelectedConversations(new Set());
    }
  }, [isMultiSelectMode]);

  const handleSelectConversation = useCallback((convId: string) => {
    if (isMultiSelectMode) {
      setSelectedConversations(prev => {
        const newSet = new Set(prev);
        if (newSet.has(convId)) {
          newSet.delete(convId);
        } else {
          newSet.add(convId);
        }
        return newSet;
      });
    } else {
      setSelectedConvKeys(new Set([convId]));
    }
  }, [isMultiSelectMode]);

  const handleSelectAll = useCallback(() => {
    const allConvIds = new Set(groupedByConversation.map(conv => conv.convId));
    setSelectedConversations(allConvIds);
  }, [groupedByConversation]);

  const handleSelectNone = useCallback(() => {
    setSelectedConversations(new Set());
  }, []);

  const handleExportSelected = useCallback(() => {
    console.log("Exporting selected conversations:", Array.from(selectedConversations));
    // TODO: Implement export functionality
  }, [selectedConversations]);

  // Pagination for the selected conversation turns (middle pane)
  const {
    page: msgPage,
    setPage: setMsgPage,
    pageCount: msgPageCount,
    pageSize: msgPageSize,
    setPageSize: setMsgPageSize,
    total: msgTotal,
    paged: pagedConvTurns,
    gotoFirst: msgFirst, gotoLast: msgLast, next: msgNext, prev: msgPrev
  } = usePagination(selectedConvTurns, {
    defaultPageSize: 50, // Fewer turns per page since each turn can contain multiple messages
    persistKey: "aip.pageSize",
    currentFilterHash: `${filterHash}|conv=${Array.from(selectedConvKeys).sort().join(',')}`
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
    setMessagesLoading(true);
    setMessagesError(null);

    console.log("📊 Starting status bus task...");
    const task = statusBus.begin("index", "Indexing exports", activeSourcesArray.length);
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
        task.tick(0, source.root.split(/[\\/]/).slice(-2).join("/"));
        
        try {
          console.log("🔄 Calling parseMultipleSources...");
          const result = await parseMultipleSources(plugin.app, [source]);
          console.log(`✅ Parsed ${result.messages.length} messages from ${source.id}`);
          console.log(`✅ Parse errors: ${result.errors.length}`);
          
          // Process messages directly without individual progress tracking
          console.log("🔄 Processing individual messages...");
          for (const msg of result.messages) {
            if (task.isCancelled()) {
              console.log("🔄 Task cancelled during message processing");
              break;
            }
            
            // Message structure is already validated by the robust parser
            
            allMessages.push(msg);
          }
          
          console.log(`✅ Finished processing ${result.messages.length} messages from ${source.id}`);
          allErrors.push(...result.errors);
        } catch (sourceError: any) {
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
        task.tick(1); // Increment progress
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
      setMessagesLoading(false);
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
      setMessagesLoading(false);
      setMessagesError(String(e?.message ?? e));
      task.fail(e?.message ?? String(e));
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

  // Import to SQLite (restored functionality)
  const importToDb = useCallback(async () => {
    if (!messages.length) {
      setError("No messages to import. Please load messages first.");
      return;
    }

    setIsImporting(true);
    
    try {
      console.log("🗄️ Starting SQLite import...");
      
      // Import the old database functions temporarily
      const { openDb, upsertBatch, saveDbToVault } = await import("./db");
      
      await openDb();
      upsertBatch(messages);
      await saveDbToVault(plugin);
      
      // Update stats
      const { getStats } = await import("./db");
      const stats = getStats();
      setDbStats(stats);
      
      console.log("✅ SQLite import completed");
      setError("");
    } catch (error) {
      console.error("❌ Import failed:", error);
      setError(`Import failed: ${error}`);
    } finally {
      setIsImporting(false);
    }
  }, [messages, plugin]);

  // Load database stats (restored functionality)
  const loadDbStats = useCallback(async () => {
    try {
      const { loadDbFromVault, openDb, getStats } = await import("./db");
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
                checked={useNewView}
                onChange={(e) => setUseNewView(e.target.checked)}
              />
              <span>New View</span>
            </label>
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
      {useNewView ? (
        <TestView messages={messages} />
      ) : (
      <div className="aip-body">
        {/* Left Pane: Conversation List */}
        <section className="aip-pane aip-left">
          <MultiSelectToolbar
            selectedCount={isMultiSelectMode ? selectedConversations.size : selectedConvKeys.size}
            totalCount={groupedByConversation.length}
            isMultiSelectMode={isMultiSelectMode}
            onToggleMultiSelect={handleToggleMultiSelect}
            onSelectAll={handleSelectAll}
            onSelectNone={handleSelectNone}
            onExportSelected={handleExportSelected}
            isLoading={messagesLoading}
          />
          
          <LoadingOverlay isLoading={messagesLoading} text="Loading conversations...">
            <div className="aip-messages">
              {pagedConversations.map(g => (
                <ConversationCard
                  key={g.key}
                  conversation={{
                    convId: g.key,
                    title: g.title || "(untitled)",
                    vendor: g.vendor,
                    msgCount: g.count,
                    firstTs: g.firstMessage?.createdAt || 0,
                    lastTs: g.lastMessage?.createdAt || 0
                  }}
                  isSelected={isMultiSelectMode ? selectedConversations.has(g.key) : selectedConvKeys.has(g.key)}
                  isMultiSelectMode={isMultiSelectMode}
                  onSelect={handleSelectConversation}
                  onToggle={handleSelectConversation}
                  isLoading={conversationLoading.has(g.key)}
                />
              ))}
            </div>
          </LoadingOverlay>

          {/* Conversation List Pagination */}
          {pagedConversations.length > 0 && (
            <div className="aip-pagination">
              <Paginator
                page={convPage}
                pageCount={convPageCount}
                pageSize={convPageSize}
                setPageSize={setConvPageSize}
                total={convTotal}
                gotoFirst={convFirst}
                gotoLast={convLast}
                next={convNext}
                prev={convPrev}
              />
            </div>
          )}
        </section>

        {/* Center Pane: Selected Conversation Messages + Pagination */}
        <section className="aip-pane aip-center">
          <LoadingOverlay isLoading={isSearching} text="Searching messages...">
            {selectedConvMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="text-lg font-medium mb-2">No conversations selected</h3>
                <p className="text-sm text-center max-w-sm">
                  {isMultiSelectMode 
                    ? "Select one or more conversations from the left to view their messages"
                    : "Click on a conversation from the left to view its messages"
                  }
                </p>
              </div>
            )}

          {selectedConvMessages.length > 0 && (
            <div className="aihp-message-detail">
              <div className="aihp-detail-header">
                <h3>
                  {selectedConvKeys.size === 1 
                    ? (selectedConvMessages[0].title || "(untitled)")
                    : `${selectedConvKeys.size} conversations selected`
                  }
                </h3>
                <div className="aihp-detail-meta">
                  {selectedConvKeys.size === 1 
                    ? new Date(selectedConvMessages[0].createdAt).toLocaleString()
                    : `${selectedConvMessages.length} messages from ${selectedConvKeys.size} conversations`
                  }
                </div>
              </div>

              {pagedConvTurns.map(turn => (
                <div key={turn.id} className="aihp-turn">
                  <div className="aihp-turn-header">
                    <span className={`aihp-role aihp-role-${turn.role}`}>{turn.role.toUpperCase()}</span>
                    <span className="aihp-vendor aihp-vendor-chatgpt">{turn.vendor}</span>
                    <span className="aihp-turn-time">
                      {new Date(turn.tsStart).toLocaleString()} – {new Date(turn.tsEnd).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="aihp-turn-messages">
                    {turn.items.map(msg => (
                      <div key={msg.id} className="aihp-message" onClick={() => setSelectedMessage(msg as any)}>
                        <MessageContent
                          text={msg.text}
                          toolName={undefined}
                          toolPayload={null}
                          query={debouncedQuery}
                          useRegex={facets.regex}
                          highlightText={highlightText}
                        />
                        <div className="aihp-message-meta">{new Date(msg.ts).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
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
          </LoadingOverlay>
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
              <div>Showing: {pagedConvTurns.length.toLocaleString()} turns</div>
              <div>Page: {msgPage} / {msgPageCount}</div>
              <div>Active Sources: {activeSources.size}</div>
              {!statsLoading && (
                <>
                  <div>In Database: {dbStats.totalMessages.toLocaleString()}</div>
                  <div>Conversations: {dbStats.totalConversations.toLocaleString()}</div>
                </>
              )}
            </div>

            {/* Selected Conversations Stats */}
            {(isMultiSelectMode && selectedConversations.size > 0) || (!isMultiSelectMode && selectedConvKeys.size > 0) ? (
              <>
                <h4>Selected Conversations</h4>
                <div className="aip-stats" style={{ backgroundColor: 'var(--aihp-bg-modifier)', padding: '8px', borderRadius: '4px' }}>
                  <div style={{ color: 'var(--aihp-accent)', fontWeight: 'bold' }}>
                    {isMultiSelectMode ? selectedConversations.size : selectedConvKeys.size} selected
                  </div>
                  <div>Messages: {selectedConvMessages.length.toLocaleString()}</div>
                  <div>Turns: {selectedConvTurns.length.toLocaleString()}</div>
                  <div>Page: {msgPage} / {msgPageCount}</div>
                </div>
              </>
            ) : null}

            <h4>Vendor Breakdown</h4>
            <div className="aip-vendor-stats">
              {Object.entries(
                filteredMessages.reduce((acc: Record<string, number>, msg: any) => {
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


          </div>
        </aside>
      </div>
      )}
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