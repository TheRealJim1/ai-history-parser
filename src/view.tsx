import { ItemView, Modal, TAbstractFile, WorkspaceLeaf, TFolder, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { parseMultipleSources, searchMessages, highlightText } from "./parser";
import { executePythonScript, buildSyncCommand, buildAnnotateCommand, buildExportCommand } from "./utils/scriptRunner";
import { resolveVaultPath } from "./settings";
import { safeJson, mapAnnotationRow, type ConversationAnnotation, hasAnyAnnotations } from "./utils/jsonUtils";
import { exportEdgesOnly } from "./utils/graphExport";
import { isTestModeEnabled, getOutputFolder, getIngestLimits, getAnnotationLimit, validateModelForBackend } from "./utils/testMode";
import { runSelfCheck, runSelfCheckAfterAction, type SelfCheckResult } from "./utils/selfCheck";
import { getSelfCheckContext, setSelfCheckContextProvider, type SelfCheckContext } from "./utils/selfCheckCtl";
import { SelfCheckPanel } from "./components/SelfCheckPanel";
import { TestWizard } from "./components/TestWizard";
import { discoverSubfolders, getSourceLabel, formatSourcePath, type DiscoveredSubfolder } from "./utils/folderDiscovery";
import { detectVendor, generateSourceId, pickColor, makeSourceLabel, parseExportInfo } from "./settings";
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
import { aggregateConvTags } from "./lib/tags";
import { groupTurns } from "./lib/grouping";
import { LoadingSpinner, LoadingOverlay, LoadingButton } from "./ui/LoadingSpinner";
import { ConversationCard } from "./ui/ConversationCard";
import { MultiSelectToolbar } from "./ui/MultiSelectToolbar";
import { ConversationsList } from "./ui/ConversationsList";
import type { FlatMessage, Source, Vendor, SearchFacets, SearchProgress, ParseError } from "./types";
import type AIHistoryParser from "./main";

// Import the CSS
import "../styles/tw.css";

export const VIEW_TYPE = "ai-history-parser-view";

export class ParserView extends ItemView {
  // Expose handlers for agent macros
  public handleTestSync?: (sourceId: string) => Promise<void>;
  public handleTestAnnotate?: () => Promise<void>;
  public handleTestExport?: () => Promise<void>;
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
    
    // Version banner for debugging
    console.info("AIHP View opened - DB-first mode active");
    
    this.root.render(<UI plugin={this.plugin} viewInstance={this} />);
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
function UI({ plugin, viewInstance }: { plugin: AIHistoryParser; viewInstance?: ParserView }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinHeader, setPinHeader] = useState<boolean>(() => {
    const v = localStorage.getItem("aip.pinHeader");
    return v ? v === "1" : true; // default: pinned
  });
  const [activeSources, setActiveSources] = useState<Set<string>>(() => {
    const saved = new Set(plugin.settings.lastActiveSourceIds || []);
    // If no sources are saved as active, auto-activate all sources on first load
    if (saved.size === 0 && plugin.settings.sources.length > 0) {
      console.log("🔄 No active sources saved - auto-activating all sources");
      const allSourceIds = new Set(plugin.settings.sources.map(s => s.id));
      // Save this immediately
      plugin.saveSetting('lastActiveSourceIds', Array.from(allSourceIds)).catch(console.error);
      return allSourceIds;
    }
    return saved;
  });
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
        // Only filter by activeSources if there are active sources selected
        // If no sources are active, show all messages (don't filter)
        if (activeSources.size > 0 && !activeSources.has(msg.sourceId)) return false;
        return true;
      });
    }
    
    // Safety check: If filtering by activeSources results in 0 messages, show all instead
    // This prevents "wiping out" conversations when sources don't match
    if (filtered.length === 0 && activeSources.size > 0 && messages.length > 0) {
      console.warn(`⚠️ Filtering by activeSources (${Array.from(activeSources).join(', ')}) resulted in 0 messages. Showing all messages instead.`);
      // Return all messages (only apply other filters like vendor, role, date)
      if (debouncedQuery.trim()) {
        // Re-run search without sourceIds filter
        filtered = rankedMessageSearch(messages, debouncedQuery, facets.regex || false, {
          vendor: facets.vendor,
          role: facets.role,
          from: facets.from ? new Date(facets.from).getTime() : undefined,
          to: facets.to ? new Date(facets.to).getTime() + 86400000 : undefined,
          // Don't filter by sourceIds
        });
      } else {
        // Just apply non-source filters
        filtered = messages.filter(msg => {
          if (facets.vendor && facets.vendor !== 'all' && msg.vendor !== facets.vendor) return false;
          if (facets.role && facets.role !== 'any' && msg.role !== facets.role) return false;
          if (facets.from && msg.createdAt < new Date(facets.from).getTime()) return false;
          if (facets.to && msg.createdAt > new Date(facets.to).getTime() + 86400000) return false;
          // Don't filter by activeSources in fallback mode
          return true;
        });
      }
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
    // Build a map of conversationId -> title for better title resolution
    const convTitleMap = new Map<string, string>();
    for (const msg of deduplicatedMessages) {
      if (msg.title && msg.title !== msg.vendor && !convTitleMap.has(msg.conversationId)) {
        // Use the title from messages (which comes from the DB)
        convTitleMap.set(msg.conversationId, msg.title);
      }
    }
    
    const parsedMessages = deduplicatedMessages.map(msg => ({
      id: msg.messageId,
      convId: msg.conversationId, // This is already in the format "vendor:convId"
      convTitle: convTitleMap.get(msg.conversationId) || msg.title || "(untitled)",
      role: msg.role as 'user'|'assistant'|'tool'|'system',
      ts: msg.createdAt,
      text: msg.text,
      vendor: msg.vendor as any || 'CHATGPT' // Use actual vendor from message, not hardcoded
    }));
    
    const index = buildConvIndex(parsedMessages);
    console.log("🔄 Built index with", index.length, "conversations");
    
    // Convert to the format expected by the UI and add tags per conversation
    const byConvId = new Map<string, { text: string }[]>();
    const firstMsgByConv = new Map<string, FlatMessage>();
    for (const m of deduplicatedMessages) {
      const arr = byConvId.get(m.conversationId) || [];
      arr.push({ text: m.text });
      byConvId.set(m.conversationId, arr);
      if (!firstMsgByConv.has(m.conversationId)) firstMsgByConv.set(m.conversationId, m);
    }

    const sourceIdToLabel = new Map<string, string>();
    for (const s of plugin.settings.sources) sourceIdToLabel.set(s.id, s.label || s.id);

    const result = index.map(conv => {
      // Temporarily disable auto-tagging (dom:/ent:/lang:) to reduce noise.
      // Keep only batch label so exports remain distinguishable.
      const tags: string[] = [];
      const fm = firstMsgByConv.get(conv.convId);
      const batch = fm ? sourceIdToLabel.get(fm.sourceId) : undefined;
      if (batch) tags.push(`batch:${batch}`);
      return {
        key: conv.convId, // For pagination hook
        convId: conv.convId, // already in format "vendor:convId"
        title: conv.title,
        vendor: conv.vendor,
        msgCount: conv.msgCount,
        firstTs: conv.firstTs,
        lastTs: conv.lastTs,
        tags
      };
    });
    
    console.log("🔄 Built conversations:", {
      total: result.length,
      sample: result.slice(0, 3).map(g => ({ 
        title: g.title || "(untitled)", 
        msgCount: g.msgCount, 
        vendor: g.vendor,
        convId: g.convId,
        key: g.key,
        firstTs: new Date(g.firstTs).toLocaleString(),
        lastTs: new Date(g.lastTs).toLocaleString()
      }))
    });
    
    if (result.length === 0 && filteredMessages.length > 0) {
      console.error("❌ No conversations built but messages exist! This shouldn't happen.");
      console.error("Sample messages:", filteredMessages.slice(0, 3).map(m => ({
        conversationId: m.conversationId,
        title: m.title,
        textLength: m.text?.length || 0,
        uid: m.uid
      })));
    }
    
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
  
  // Debug pagination
  useEffect(() => {
    console.log("🔄 Pagination Debug:", {
      groupedByConversationLength: groupedByConversation.length,
      convTotal,
      convPage,
      convPageSize,
      convPageCount,
      pagedConversationsLength: pagedConversations.length,
      firstThreePaged: pagedConversations.slice(0, 3),
      firstThreeGrouped: groupedByConversation.slice(0, 3)
    });
  }, [groupedByConversation.length, convTotal, convPage, convPageSize, convPageCount, pagedConversations.length]);

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (selectedConvKeys.size === 0 && pagedConversations.length > 0) {
      const firstConv = pagedConversations[0];
      const firstConvId = firstConv?.convId; // Use convId, not key
      if (firstConvId) {
        console.log("🔄 Auto-selecting first conversation:", firstConvId, firstConv?.title);
        setSelectedConvKeys(new Set([firstConvId]));
      }
    }
  }, [pagedConversations, selectedConvKeys]);
  
  // Debug logging for troubleshooting
  useEffect(() => {
    console.log("🔄 UI State Debug:", {
      messagesTotal: messages.length,
      filteredMessages: filteredMessages.length,
      conversationsTotal: groupedByConversation.length,
      conversationsPaged: pagedConversations.length,
      activeSourcesCount: activeSources.size,
      activeSources: Array.from(activeSources),
      availableSources: plugin.settings.sources.map(s => ({ id: s.id, label: s.label })),
      firstFewConversations: pagedConversations.slice(0, 3).map(c => ({ 
        key: c.key, 
        convId: c.convId, 
        title: c.title,
        msgCount: c.msgCount
      })),
      firstFewMessages: filteredMessages.slice(0, 3).map(m => ({
        sourceId: m.sourceId,
        vendor: m.vendor,
        title: m.title
      }))
    });
  }, [messages.length, filteredMessages.length, groupedByConversation.length, pagedConversations.length, activeSources.size]);

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

  // Messages for the selected conversations (supports single and multi-select)
  const selectedConvMessages = useMemo(() => {
    // Use the active selection set depending on mode
    const activeSelection = isMultiSelectMode ? selectedConversations : selectedConvKeys;

    console.log("🔄 Filtering messages for selected conversations");
    console.log("🔄 Multi-select mode:", isMultiSelectMode);
    console.log("🔄 Active selected keys:", Array.from(activeSelection));
    console.log("🔄 Total filtered messages:", filteredMessages.length);

    if (activeSelection.size === 0) {
      console.log("🔄 No conversations selected, returning empty messages");
      return [] as FlatMessage[];
    }

    const selected = filteredMessages
      .filter(m => activeSelection.has(m.conversationId))
      .sort((a,b) => a.createdAt - b.createdAt);

    console.log("🔄 Selected messages:", selected.length);
    console.log("🔄 Sample selected message:", selected[0]);

    return selected;
  }, [filteredMessages, isMultiSelectMode, selectedConvKeys, selectedConversations]);

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
    currentFilterHash: `${filterHash}|conv=${Array.from(isMultiSelectMode ? selectedConversations : selectedConvKeys).sort().join(',')}`
  });

  // NOTE: Folder parsing is now disabled - use refreshFromDB instead
  // All folder parsing code has been removed - plugin now reads from external DB only
  
  // Refresh from DB - reads from external database (defined first for loadMessages)
  const refreshFromDB = useCallback(async () => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline?.dbPath) {
      setError("Database path not configured");
      return;
    }

    setMessagesLoading(true);
    setStatus("loading");
    
    // Initialize progress tracking
    const progressHandle = statusBus.begin("refresh-db", "Loading from database...");
    
    try {
      // Use Python bridge script to query DB and return JSON
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      
      // Check if DB exists first
      const { spawn } = require("child_process");
      const fs = require("fs");
      if (!fs.existsSync(dbPath)) {
        progressHandle.fail("Database not found");
        throw new Error(`Database not found: ${dbPath}. Run "Sync from Backups" first.`);
      }
      
      // Create a temporary Python script file to avoid Windows shell issues with multiline strings
      const os = require("os");
      const path = require("path");
      const scriptPath = path.join(os.tmpdir(), `aihp_query_${Date.now()}.py`);
      
      const queryScript = `import sqlite3, json, sys
from datetime import datetime
db_path = r"${dbPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
con = sqlite3.connect(db_path)
cur = con.cursor()

# Helper function to convert datetime string to Unix timestamp
def to_timestamp(dt_str):
    if not dt_str:
        return 0
    try:
        # Try parsing as datetime string (format: "YYYY-MM-DD HH:MM:SS")
        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        return int(dt.timestamp())
    except (ValueError, TypeError):
        # If parsing fails, try as integer (already a timestamp)
        try:
            return int(float(dt_str))
        except (ValueError, TypeError):
            return 0

# Check if conversation_annotation table exists
has_annotations = False
try:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_annotation'")
    has_annotations = cur.fetchone() is not None
except:
    pass

# Query conversations (with or without annotations)
if has_annotations:
    convs = cur.execute("""
SELECT
  c.id, c.title, c.provider,
  COALESCE(c.updated_at, c.created_at) AS ts,
  COALESCE(a.summary, '')              AS summary,
  COALESCE(a.tags,    '[]')            AS tags_json,
  COALESCE(a.topics,  '[]')            AS topics_json,
  COALESCE(a.entities,'{}')            AS entities_json,
  COALESCE(a.risk_flags,'[]')          AS risk_json,
  COALESCE(a.sentiment,'neutral')      AS sentiment
FROM conversation c
LEFT JOIN conversation_annotation a
  ON a.conversation_id = c.id
ORDER BY ts DESC
""").fetchall()
else:
    # Fallback: no annotations table yet
    convs = cur.execute("""
SELECT
  c.id, c.title, c.provider,
  COALESCE(c.updated_at, c.created_at) AS ts,
  '' AS summary,
  '[]' AS tags_json,
  '[]' AS topics_json,
  '{}' AS entities_json,
  '[]' AS risk_json,
  'neutral' AS sentiment
FROM conversation c
ORDER BY ts DESC
""").fetchall()

# Query all messages at once (much faster than one query per conversation)
# Output progress to stderr (will be parsed by TypeScript)
total_convs = len(convs)
conv_ids = [c[0] for c in convs]
sys.stderr.write("PROGRESS:TOTAL:" + str(total_convs) + "\\n")
sys.stderr.flush()

# Create a map of conversation_id -> (title, provider) for quick lookup
# SELECT order: id[0], title[1], provider[2]
conv_map = {c[0]: (c[1] or "", c[2] or "unknown") for c in convs}  # title, provider

# Single query to get all messages for all conversations
# Use IN clause with placeholders (SQLite supports up to ~500, but we'll batch if needed)
messages = []
if len(conv_ids) <= 500:
    # Single query if under SQLite's practical limit
    placeholders = ','.join('?' * len(conv_ids))
    all_msgs = cur.execute(f"SELECT id, conversation_id, idx, role, author, model, created_at, content FROM message WHERE conversation_id IN ({placeholders}) ORDER BY conversation_id, idx", conv_ids).fetchall()
    
    processed = 0
    for msg in all_msgs:
        conv_id = msg[1]
        title, provider = conv_map.get(conv_id, ("", "unknown"))  # Fixed: title first, then provider
        messages.append({
            "uid": f"{conv_id}:{msg[0]}",
            "conversationId": str(conv_id),
            "messageId": str(msg[0]),
            "role": msg[3] or "unknown",
            "createdAt": to_timestamp(msg[6]),
            "text": msg[7] or "",
            "title": title or "",  # Now correctly using title
            "vendor": provider or "chatgpt",  # Now correctly using provider
            "sourceId": provider or "unknown"
        })
        
        processed += 1
        # Update progress every 1000 messages
        if processed % 1000 == 0:
            pct = int((processed / len(all_msgs)) * total_convs)
            sys.stderr.write("PROGRESS:TICK:" + str(pct) + ":" + str(total_convs) + "\\n")
            sys.stderr.flush()
    
    # Final progress update
    sys.stderr.write("PROGRESS:TICK:" + str(total_convs) + ":" + str(total_convs) + "\\n")
    sys.stderr.flush()
else:
    # Batch if too many conversations (rare case)
    batch_size = 500
    processed_convs = 0
    for i in range(0, len(conv_ids), batch_size):
        batch = conv_ids[i:i+batch_size]
        placeholders = ','.join('?' * len(batch))
        batch_msgs = cur.execute(f"SELECT id, conversation_id, idx, role, author, model, created_at, content FROM message WHERE conversation_id IN ({placeholders}) ORDER BY conversation_id, idx", batch).fetchall()
        
        for msg in batch_msgs:
            conv_id = msg[1]
            provider, title = conv_map.get(conv_id, ("unknown", ""))
            messages.append({
                "uid": f"{conv_id}:{msg[0]}",
                "conversationId": str(conv_id),
                "messageId": str(msg[0]),
                "role": msg[3] or "unknown",
                "createdAt": to_timestamp(msg[6]),
                "text": msg[7] or "",
                "title": title or "",
                "vendor": provider or "chatgpt",
                "sourceId": provider or "unknown"
            })
        
        processed_convs += len(batch)
        sys.stderr.write("PROGRESS:TICK:" + str(processed_convs) + ":" + str(total_convs) + "\\n")
        sys.stderr.flush()

# Build conversations list with annotation data
conv_list = []
for c in convs:
    conv_list.append({
        "id": c[0],
        "title": c[1] or "",  # Fixed: title is at index 1
        "provider": c[2] or "unknown",  # Fixed: provider is at index 2
        "ts": c[3],
        "summary": c[4],
        "tags_json": c[5],
        "topics_json": c[6],
        "entities_json": c[7],
        "risk_json": c[8],
        "sentiment": c[9]
    })

print(json.dumps({"conversations": conv_list, "messages": messages}))
con.close()
`;
      
      // Write script to temp file
      fs.writeFileSync(scriptPath, queryScript, 'utf8');
      
      // Execute query script from file (more reliable on Windows)
      // Use shell:false since we're passing args as an array
      const proc = spawn(pythonPipeline.pythonExecutable, [scriptPath], { shell: false });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        
        // Parse progress updates from stderr
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('PROGRESS:TOTAL:')) {
            const total = parseInt(line.split(':')[2], 10);
            if (!isNaN(total)) {
              progressHandle.setTotal(total);
              progressHandle.label("Loading conversations...", `0/${total} conversations`);
            }
          } else if (line.startsWith('PROGRESS:TICK:')) {
            const parts = line.split(':');
            if (parts.length >= 4) {
              const current = parseInt(parts[2], 10);
              const total = parseInt(parts[3], 10);
              if (!isNaN(current) && !isNaN(total)) {
                progressHandle.set(current, `${current}/${total} conversations`);
              }
            }
          }
        }
      });
      
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code: number) => {
          // Clean up temp file
          try {
            if (fs.existsSync(scriptPath)) {
              fs.unlinkSync(scriptPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            try {
              const data = JSON.parse(stdout);
              
              // Map provider to source.id for filtering
              // The Python DB stores provider (e.g., "openai") but plugin sources have unique IDs
              // Create a map of provider -> source.id(s) - handle multiple sources with same provider
              const providerToSourceIds = new Map<string, string[]>();
              for (const source of plugin.settings.sources) {
                // Detect provider from source (vendor or path)
                const provider = source.vendor === 'chatgpt' ? 'openai' : 
                                source.vendor === 'claude' ? 'anthropic' :
                                source.vendor || 'openai';
                if (!providerToSourceIds.has(provider)) {
                  providerToSourceIds.set(provider, []);
                }
                providerToSourceIds.get(provider)!.push(source.id);
              }
              
              // Parse messages and map provider to sourceId
              const flatMessages: FlatMessage[] = data.messages.map((m: any) => {
                // m.sourceId from DB is actually the provider (e.g., "openai")
                const provider = m.sourceId || m.vendor || 'openai';
                
                // Find matching source IDs for this provider
                // IMPORTANT: Match ALL sources with this provider, not just the first one
                // This ensures messages from any ChatGPT folder map to any ChatGPT source
                const matchingSourceIds = providerToSourceIds.get(provider) || [];
                
                // If we have matching sources, use the first one (they're all for the same provider)
                // If no matching sources, fallback to provider name (will show in UI but not filterable)
                let sourceId = provider; // Default fallback
                if (matchingSourceIds.length > 0) {
                  // IMPORTANT: Always use the FIRST matching source ID for consistency
                  // This ensures all messages from provider 'openai' get the same sourceId
                  // regardless of which active sources are selected. Filtering happens later.
                  sourceId = matchingSourceIds[0];
                }
                
                // Normalize vendor to ensure it's a vendor name, not a title
                // Vendor should be one of: 'CHATGPT', 'CLAUDE', 'GEMINI', 'GROK'
                let normalizedVendor: Vendor = 'CHATGPT'; // Default
                
                // Extract vendor from provider or existing vendor field
                const rawVendor = (m.vendor || provider || '').toLowerCase();
                
                if (rawVendor.includes('claude') || rawVendor === 'anthropic') {
                  normalizedVendor = 'CLAUDE';
                } else if (rawVendor.includes('gemini') || rawVendor === 'google') {
                  normalizedVendor = 'GEMINI';
                } else if (rawVendor.includes('grok')) {
                  normalizedVendor = 'GROK';
                } else if (rawVendor.includes('chatgpt') || rawVendor === 'openai') {
                  normalizedVendor = 'CHATGPT';
                }
                
                // Safety check: if vendor looks like a title (has spaces, too long), force to CHATGPT (most common)
                if (normalizedVendor.length > 20 || normalizedVendor.includes(' ') || normalizedVendor !== normalizedVendor.toUpperCase()) {
                  normalizedVendor = 'CHATGPT'; // Default for OpenAI exports
                }
                
                return {
                  uid: m.uid,
                  vendor: normalizedVendor,
                  sourceId: sourceId, // Use mapped source ID
                  conversationId: m.conversationId,
                  messageId: m.messageId,
                  role: m.role as 'user'|'assistant'|'tool'|'system',
                  createdAt: m.createdAt,
                  title: m.title,
                  text: m.text,
                };
              });
              
              // Parse conversations with annotations (safe JSON parsing)
              const conversations: ConversationAnnotation[] = (data.conversations || []).map((c: any) => 
                mapAnnotationRow(c)
              );
              
              // Store annotations in a map for quick lookup
              const annotationMap = new Map<string, ConversationAnnotation>();
              conversations.forEach(c => annotationMap.set(c.id, c));
              
              // Store in state (we'll use this for annotation display)
              (setMessages as any).__annotations = annotationMap;
              
              setMessages(flatMessages);
      setStatus("ready");
              setError("");
              progressHandle.end();
              console.log(`✅ Refreshed ${flatMessages.length} messages from DB, ${conversations.length} conversations with annotations`);
    } catch (e: any) {
              progressHandle.fail(`Failed to parse DB response: ${e.message}`);
              reject(new Error(`Failed to parse DB response: ${e.message}`));
            }
          } else {
            progressHandle.fail(`Query script exited with code ${code}`);
            reject(new Error(`Query script exited with code ${code}. ${stderr || stdout}`));
          }
          resolve();
        });
        proc.on('error', (error: any) => {
          progressHandle.fail(`Failed to execute: ${error.message}`);
          // Clean up temp file on error
          try {
            if (fs.existsSync(scriptPath)) {
              fs.unlinkSync(scriptPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          reject(new Error(`Failed to execute query script: ${error.message}`));
        });
      });
    } catch (error: any) {
      progressHandle.fail(error.message);
      setMessagesLoading(false);
      setStatus("error");
      setError(error.message);
      console.error("❌ Refresh failed:", error);
      setError(`Refresh failed: ${error.message}`);
      setStatus("error");
    } finally {
      setMessagesLoading(false);
    }
  }, [plugin]);

  // Load messages from database (replaces folder parsing)
  const loadMessages = useCallback(async () => {
    // Redirect to refreshFromDB - no more folder parsing
    console.log("🔄 loadMessages called - redirecting to refreshFromDB");
    await refreshFromDB();
  }, [refreshFromDB]);

  // Add new source (parent folder - handles subfolders automatically)
  const addSource = useCallback(async () => {
    console.log("➕ Adding new source (parent folder)...");
    
    try {
      const chosen = await new FolderSuggestModal(plugin).openAndPick();
      if (!chosen) {
        console.log("❌ No folder chosen");
        return;
      }

      console.log("📁 Chosen parent folder (raw):", chosen);
      
      // Ensure we have the full vault path (not relative)
      let vaultPath = chosen;
      if (vaultPath && !vaultPath.includes(':') && !vaultPath.startsWith('\\')) {
        // This is a vault path - ensure it's clean
        vaultPath = vaultPath.replace(/^\/+|\/+$/g, '');
        console.log("📁 Cleaned vault path:", vaultPath);
      }

      // Discover subfolders (for display purposes)
      let subfolders: DiscoveredSubfolder[] = [];
      try {
        console.log(`[addSource] Discovering subfolders for: "${vaultPath}"`);
        subfolders = await discoverSubfolders(plugin.app, vaultPath);
        console.log(`[addSource] Discovery complete: ${subfolders.length} subfolders found`);
      } catch (error) {
        console.error("[addSource] Failed to discover subfolders:", error);
        // If vault path fails, it might be an external folder - that's OK
        // Python scripts will discover subfolders during sync
      }
      
      if (subfolders.length > 0) {
        console.log(`📂 Discovered ${subfolders.length} subfolders:`);
        subfolders.slice(0, 5).forEach(s => console.log(`  - ${s.name} (${s.path})`));
        if (subfolders.length > 5) {
          console.log(`  ... and ${subfolders.length - 5} more`);
        }
      } else {
        console.warn(`📂 No subfolders discovered for: "${vaultPath}"`);
      }

      // Use parent folder as root (Python scripts will walk recursively)
      const vendor = detectVendor(chosen, '');
      const id = generateSourceId(vendor, chosen);
      const label = makeSourceLabel(vendor, chosen) + (subfolders.length > 0 ? ` (${subfolders.length} subfolders)` : '');
      const color = pickColor();

      console.log("🏷️ Generated source:", { id, vendor, color, subfolders: subfolders.length });

      const newSource: Source = {
        id,
        vendor,
        root: chosen, // Parent folder path - Python scripts handle subfolders
        addedAt: Date.now(),
        color,
        label
      };

      // Store discovered subfolders in source metadata (for display)
      (newSource as any).subfolders = subfolders.map(s => s.path);

      console.log("💾 Saving new source...");
      console.log(`💾 Source ID: "${id}"`);
      console.log(`💾 Current activeSources before: ${Array.from(activeSources)}`);
      
      const sources = [...plugin.settings.sources, newSource];
      await plugin.saveSetting('sources', sources);
      
      // Update plugin.settings immediately to reflect changes
      plugin.settings.sources = sources;
      
      // Update active sources - add the new source ID
      // BUT: Only add to activeSources if there are no messages loaded yet, or if this source matches existing messages
      // This prevents filtering out all messages when adding a new source
      const hasMessages = messages.length > 0;
      const messageSourceIds = new Set(messages.map(m => m.sourceId));
      
      let newActiveSources: Set<string>;
      if (hasMessages) {
        // If messages exist, check if the new source would match any
        // For now, map provider to source ID to see if it matches
        const provider = vendor === 'chatgpt' ? 'openai' : 
                        vendor === 'claude' ? 'anthropic' :
                        vendor || 'openai';
        // Check if any messages have sourceId matching this provider
        // If new source doesn't match, keep current activeSources (don't add new one)
        // User can manually activate it after syncing
        const providerMatches = Array.from(messageSourceIds).some(sid => {
          // Check if any existing source with same provider is in activeSources
          return Array.from(activeSources).some(aid => {
            const existingSource = plugin.settings.sources.find(s => s.id === aid);
            if (!existingSource) return false;
            const existingProvider = existingSource.vendor === 'chatgpt' ? 'openai' :
                                    existingSource.vendor === 'claude' ? 'anthropic' :
                                    existingSource.vendor || 'openai';
            return existingProvider === provider;
          });
        });
        
        if (providerMatches || activeSources.size === 0) {
          // Only add if it matches provider of existing active sources, or no sources are active
          newActiveSources = new Set([...activeSources, id]);
        } else {
          // Don't auto-add - keep current activeSources
          newActiveSources = new Set(activeSources);
          console.log(`⚠️ New source doesn't match existing messages - not auto-activating. Activate manually after syncing.`);
        }
      } else {
        // No messages yet - safe to add
        newActiveSources = new Set([...activeSources, id]);
      }
      
      await plugin.saveSetting('lastActiveSourceIds', Array.from(newActiveSources));
      console.log(`💾 Saved active source IDs: ${Array.from(newActiveSources)}`);
      
      console.log("✅ Source saved, updating UI...");
      setActiveSources(newActiveSources);
      console.log(`✅ Updated activeSources state: ${Array.from(newActiveSources)}`);
      
      const noticeMsg = hasMessages && newActiveSources.size === activeSources.size
        ? `Added source: ${getSourceLabel(chosen)} (${subfolders.length} subfolders). Sync to load data, then activate.`
        : `Added source: ${getSourceLabel(chosen)} (${subfolders.length} subfolders discovered)`;
      new Notice(noticeMsg);
      
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

  // Sync from Backups - runs Python import script
  const syncFromBackups = useCallback(async () => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline || !pythonPipeline.dbPath || !pythonPipeline.scriptsRoot) {
      new Notice("Please configure database and script paths in settings");
      return;
    }
    
    if (plugin.settings.sources.length === 0) {
      new Notice("Please add at least one backup source folder");
      return;
    }

    setIsImporting(true);
    setStatus("loading");
    
    // Initialize progress tracking
    const progressHandle = statusBus.begin("sync-backups", "Syncing from backups...");
    
    try {
      // Source folders might be absolute paths (for external backups) or vault-relative
      // IMPORTANT: Python script needs absolute paths, so we resolve all paths
      // Read active sources from settings (source of truth) instead of state (may be stale)
      const activeSourceIds = new Set(plugin.settings.lastActiveSourceIds || []);
      
      console.log(`[syncFromBackups] Total sources: ${plugin.settings.sources.length}`);
      console.log(`[syncFromBackups] Active sources from settings: ${Array.from(activeSourceIds)}`);
      console.log(`[syncFromBackups] Active sources from state: ${Array.from(activeSources)}`);
      console.log(`[syncFromBackups] All source IDs: ${plugin.settings.sources.map(s => s.id)}`);
      
      // IMPORTANT: Process ALL sources to load all backup folders
      // Active sources are only used for UI filtering, not for syncing
      // This ensures all backups are processed and deduplicated correctly
      const sourceFolders = plugin.settings.sources
        .map(s => {
          const isActive = activeSourceIds.has(s.id);
          console.log(`[syncFromBackups] Processing source "${s.id}" (${s.label}): active=${isActive} in UI`);
          return s;
        }) // Process all sources, not just active ones
        .map(s => {
          let resolvedPath: string;
          // If path is vault-relative, resolve it; otherwise use as-is (absolute path)
          if (s.root.includes('<vault>') || (!s.root.includes(':') && !s.root.startsWith('/') && !s.root.startsWith('\\'))) {
            // Vault-relative path - convert to absolute
            const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
            resolvedPath = resolveVaultPath(s.root, vaultBasePath);
            console.log(`📂 Source "${s.label}": vault path "${s.root}" → absolute "${resolvedPath}"`);
            console.log(`📂 Vault base path: "${vaultBasePath}"`);
          } else {
            // Already absolute path
            resolvedPath = s.root;
            console.log(`📂 Source "${s.label}": absolute path "${resolvedPath}"`);
          }
          return resolvedPath;
        });
      
      if (sourceFolders.length === 0) {
        console.warn(`[syncFromBackups] No sources configured!`);
        new Notice("No sources configured. Please add at least one backup folder.");
        setIsImporting(false);
        setStatus("idle");
        progressHandle.fail("No sources configured");
        return;
      }
      
      console.log(`[syncFromBackups] Processing ${sourceFolders.length} source folder(s):`);
      sourceFolders.forEach((folder, idx) => console.log(`  ${idx + 1}. ${folder}`));
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      const mediaDir = resolveVaultPath(pythonPipeline.mediaSourceFolder, vaultBasePath);
      
      // Apply test mode limits if enabled
      const testLimits = isTestModeEnabled(pythonPipeline) 
        ? getIngestLimits(pythonPipeline) 
        : undefined;
      
      const cmd = buildSyncCommand(
        pythonPipeline.pythonExecutable,
        pythonPipeline.scriptsRoot,
        sourceFolders,
        dbPath,
        mediaDir,
        testLimits
      );
      
      console.log("🚀 Starting sync with command:", cmd.join(' '));
      
      await executePythonScript(cmd, "Syncing from backups...", (progress) => {
        if (progress.status === 'running') {
          if (progress.total) {
            progressHandle.setTotal(progress.total);
            progressHandle.set(progress.progress || 0, `${progress.progress || 0}/${progress.total}`);
          } else {
            // Update label with current status
            progressHandle.label(progress.message || "Syncing from backups...");
          }
          setStatus(progress.message || "Syncing from backups...");
        } else if (progress.status === 'error') {
          progressHandle.fail(progress.message);
          setStatus("Error: " + progress.message);
          setError(progress.message);
        } else if (progress.status === 'completed') {
          progressHandle.end();
          setStatus("Sync complete");
        }
      });
      
      // Auto-refresh after sync (will show its own progress)
      await refreshFromDB();
      
      // Run self-check after sync
      const ctx = getSelfCheckContext(); // Now safe - hoisted from controller
      if (ctx && typeof runSelfCheckAfterAction === "function") {
        void runSelfCheckAfterAction(ctx, { reason: "post-sync" });
      }
      
      new Notice("Sync complete!");
    } catch (error: any) {
      progressHandle.fail(error.message);
      console.error("❌ Sync failed:", error);
      setError(`Sync failed: ${error.message}`);
      setStatus("error");
    } finally {
      setIsImporting(false);
    }
  }, [plugin, refreshFromDB]); // getSelfCheckContext is hoisted, no need in deps
  
  // Annotate with AI - runs Python annotation script
  const annotateWithAI = useCallback(async () => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline?.aiAnnotation?.enabled) {
      new Notice("AI annotation is disabled in settings");
      return;
    }
    
    setIsImporting(true);
    setStatus("loading");
    
    try {
      const { aiAnnotation } = pythonPipeline;
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      
      // Validate model for backend
      const modelCheck = validateModelForBackend(
        aiAnnotation.backend,
        aiAnnotation.model,
        aiAnnotation.url
      );
      
      if (!modelCheck.valid) {
        new Notice(`⚠️ ${modelCheck.warning}`, 8000);
        return;
      }
      
      // Apply test mode limit if enabled
      const testLimit = isTestModeEnabled(pythonPipeline)
        ? getAnnotationLimit(pythonPipeline)
        : undefined;
      
      const cmd = buildAnnotateCommand(
        pythonPipeline.pythonExecutable,
        pythonPipeline.scriptsRoot,
        dbPath,
        aiAnnotation.backend,
        aiAnnotation.url,
        aiAnnotation.model,
        aiAnnotation.batchSize,
        aiAnnotation.maxChars,
        testLimit
      );
      
      await executePythonScript(cmd, "Annotating with AI...", (progress) => {
        if (progress.total) {
          setStatus(`Annotating... ${progress.progress}/${progress.total}`);
        }
      });
      
      // Auto-refresh after annotation
      await refreshFromDB();
      
      // Run self-check after annotation
      const ctx = getSelfCheckContext(); // Now safe - hoisted from controller
      if (ctx && typeof runSelfCheckAfterAction === "function") {
        void runSelfCheckAfterAction(ctx, { reason: "post-annotate" });
      }
      
      new Notice("Annotation complete!");
    } catch (error: any) {
      console.error("❌ Annotation failed:", error);
      setError(`Annotation failed: ${error.message}`);
      setStatus("error");
    } finally {
      setIsImporting(false);
    }
  }, [plugin, refreshFromDB]); // getSelfCheckContext is hoisted, no need in deps
  
  // Export to Markdown - runs Python export script
  const exportToMarkdown = useCallback(async () => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline) {
      new Notice("Please configure Python pipeline settings");
      return;
    }
    
    setIsImporting(true);
    setStatus("loading");
    
    try {
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      
      // Use test mode folder if enabled
      const outputFolderPath = isTestModeEnabled(pythonPipeline)
        ? getOutputFolder(pythonPipeline)
        : pythonPipeline.outputFolder;
      
      const outputFolder = resolveVaultPath(
        outputFolderPath.startsWith('<vault>')
          ? outputFolderPath
          : `<vault>/${outputFolderPath}`,
        vaultBasePath
      );
      const mediaSourceFolder = resolveVaultPath(pythonPipeline.mediaSourceFolder, vaultBasePath);
      
      const cmd = buildExportCommand(
        pythonPipeline.pythonExecutable,
        pythonPipeline.scriptsRoot,
        dbPath,
        outputFolder,
        mediaSourceFolder,
        pythonPipeline.exportSettings.chunkSize,
        pythonPipeline.exportSettings.overlap,
        isTestModeEnabled(pythonPipeline)
      );
      
      await executePythonScript(cmd, "Exporting to Markdown...", (progress) => {
        if (progress.total) {
          setStatus(`Exporting... ${progress.progress}/${progress.total}`);
        }
      });
      
      new Notice(`Export complete! Files in ${pythonPipeline.outputFolder}`);
      setStatus("ready");
    } catch (error: any) {
      console.error("❌ Export failed:", error);
      setError(`Export failed: ${error.message}`);
      setStatus("error");
    } finally {
      setIsImporting(false);
    }
  }, [plugin]);
  
  // Export to Graph - creates lightweight graph edges (links only)
  const exportToGraph = useCallback(async () => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline) {
      new Notice("Please configure Python pipeline settings");
      return;
    }
    
    setIsImporting(true);
    setStatus("loading");
    
    try {
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      
      // Use test mode folder if enabled
      const outputFolderPath = isTestModeEnabled(pythonPipeline)
        ? getOutputFolder(pythonPipeline)
        : pythonPipeline.outputFolder;
      
      const historyFolder = resolveVaultPath(
        outputFolderPath.startsWith('<vault>')
          ? outputFolderPath
          : `<vault>/${outputFolderPath}`,
        vaultBasePath
      );
      
      // Index folder for graph entities/topics
      const indexFolderPath = pythonPipeline.outputFolder.replace(/[^/]*$/, '') + 'AI-Index';
      const indexFolder = resolveVaultPath(
        indexFolderPath.startsWith('<vault>')
          ? indexFolderPath
          : `<vault>/${indexFolderPath}`,
        vaultBasePath
      );
      
      // Get current conversations from filtered messages
      const conversations = groupedByConversation;
      
      // Extract annotation map
      const annotations = (setMessages as any).__annotations || new Map();
      
      // Convert to the format exportEdgesOnly expects (ConversationAnnotation[])
      const rows = conversations.map(conv => {
        // Get annotation if available
        const annotation = annotations.get(conv.convId);
        
        // Parse JSON fields if annotation exists
        const tags = annotation ? safeJson<string[]>(annotation.tags_json || annotation.tags, []) : [];
        const topics = annotation ? safeJson<string[]>(annotation.topics_json || annotation.topics, []) : [];
        const entities = annotation ? safeJson<Record<string, string[]>>(annotation.entities_json || annotation.entities, {}) : {};
        
        // Convert to ConversationAnnotation format
        const tsStr = conv.lastTs || conv.firstTs || Date.now();
        const dateStr = typeof tsStr === 'number' 
          ? new Date(tsStr).toISOString() 
          : (typeof tsStr === 'string' ? tsStr : new Date().toISOString());
        
        return {
          id: conv.convId,
          title: conv.title || 'Untitled',
          ts: dateStr,
          provider: conv.vendor || 'unknown',
          tags,
          topics,
          entities,
        } as any; // Type assertion - exportEdgesOnly will handle the structure
      });
      
      await exportEdgesOnly(plugin.app, rows, {
        indexFolder,
        historyFolder,
      });
      
      new Notice(`Graph export complete! Entities/topics in ${indexFolder}`);
      setStatus("ready");
    } catch (error: any) {
      console.error("❌ Graph export failed:", error);
      setError(`Graph export failed: ${error.message}`);
      setStatus("error");
    } finally {
      setIsImporting(false);
    }
  }, [plugin, groupedByConversation, setMessages]);
  
  // Self-check state
  const [selfCheckResult, setSelfCheckResult] = useState<SelfCheckResult | null>(null);
  const [isRunningSelfCheck, setIsRunningSelfCheck] = useState(false);
  
  // Test mode handlers
  const handleTestSync = useCallback(async (sourceId: string) => {
    const source = plugin.settings.sources.find(s => s.id === sourceId);
    if (!source) return;
    
    setIsImporting(true);
    setStatus("loading");
    
    try {
      const { pythonPipeline } = plugin.settings;
      if (!pythonPipeline) return;
      
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      const mediaDir = resolveVaultPath(pythonPipeline.mediaSourceFolder, vaultBasePath);
      
      const testLimits = getIngestLimits(pythonPipeline);
      
      const cmd = buildSyncCommand(
        pythonPipeline.pythonExecutable,
        pythonPipeline.scriptsRoot,
        [source.root],
        dbPath,
        mediaDir,
        testLimits
      );
      
      await executePythonScript(cmd, "Test Sync (slice)...", (progress) => {
        if (progress.total) {
          setStatus(`Test Sync... ${progress.progress}/${progress.total}`);
        }
      });
      
      await refreshFromDB();
      const ctx = getSelfCheckContext();
      if (ctx && typeof runSelfCheckAfterAction === "function") {
        void runSelfCheckAfterAction(ctx, { reason: "post-sync" });
      }
      
      new Notice("Test Sync complete!");
    } catch (error: any) {
      console.error("❌ Test Sync failed:", error);
      setError(`Test Sync failed: ${error.message}`);
      setStatus("error");
    } finally {
      setIsImporting(false);
    }
  }, [plugin, refreshFromDB]);
  
  // Register self-check context provider (prevents TDZ)
  useEffect(() => {
    setSelfCheckContextProvider((): SelfCheckContext | null => {
      const { pythonPipeline } = plugin.settings;
      if (!pythonPipeline?.dbPath) return null;
      
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      
      return {
        setIsRunningSelfCheck,
        setSelfCheckResult,
        app: plugin.app,
        pythonExecutable: pythonPipeline.pythonExecutable,
        dbPath,
      };
    });
  }, [plugin, setIsRunningSelfCheck, setSelfCheckResult]);
  
  const handleTestAnnotate = useCallback(async () => {
    await annotateWithAI();
    const ctx = getSelfCheckContext(); // Now safe - hoisted from controller
    if (ctx && typeof runSelfCheckAfterAction === "function") {
      void runSelfCheckAfterAction(ctx, { reason: "post-annotate" });
    }
  }, [annotateWithAI]);
  
  const handleTestExport = useCallback(async () => {
    await exportToMarkdown();
    const ctx = getSelfCheckContext(); // Now safe - hoisted from controller
    if (ctx && typeof runSelfCheckAfterAction === "function") {
      void runSelfCheckAfterAction(ctx, { reason: "post-export" });
    }
  }, [exportToMarkdown]);
  
  // Load database stats from external DB
  const loadDbStats = useCallback(async () => {
    try {
      const { pythonPipeline } = plugin.settings;
      if (!pythonPipeline?.dbPath) {
        setDbStats({ totalMessages: 0, totalConversations: 0, sources: 0, lastUpdated: 0 });
        return;
      }
      
      // Query stats from external DB using Python bridge
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      const fs = require("fs");
      if (!fs.existsSync(dbPath)) {
        setDbStats({ totalMessages: 0, totalConversations: 0, sources: 0, lastUpdated: 0 });
        return;
      }
      
      // Use temp file for stats query too (Windows compatibility)
      const os = require("os");
      const path = require("path");
      const statsScriptPath = path.join(os.tmpdir(), `aihp_stats_${Date.now()}.py`);
      
      const queryScript = `import sqlite3, json
con = sqlite3.connect(r"${dbPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
cur = con.cursor()
stats = {
    "totalConversations": cur.execute("SELECT COUNT(*) FROM conversation").fetchone()[0],
    "totalMessages": cur.execute("SELECT COUNT(*) FROM message").fetchone()[0],
    "sources": len(cur.execute("SELECT DISTINCT provider FROM conversation").fetchall()),
    "lastUpdated": 0
}
# Get max updated_at if available
try:
    max_updated = cur.execute("SELECT MAX(CAST(updated_at AS INTEGER)) FROM conversation WHERE updated_at IS NOT NULL").fetchone()[0]
    if max_updated:
        stats["lastUpdated"] = int(max_updated)
except:
    pass
print(json.dumps(stats))
con.close()
`;
      
      // Write script to temp file
      fs.writeFileSync(statsScriptPath, queryScript, 'utf8');
      
      const { spawn } = require("child_process");
      // Use shell:false since we're passing args as an array
      const proc = spawn(pythonPipeline.pythonExecutable, [statsScriptPath], { shell: false });
      
      let stdout = '';
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code: number) => {
          // Clean up temp file
          try {
            if (fs.existsSync(statsScriptPath)) {
              fs.unlinkSync(statsScriptPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            try {
              const stats = JSON.parse(stdout);
              setDbStats({
                totalMessages: stats.totalMessages || 0,
                totalConversations: stats.totalConversations || 0,
                sources: stats.sources || 0,
                lastUpdated: stats.lastUpdated || 0,
              });
            } catch (e) {
              console.warn("Failed to parse stats:", e);
            }
          }
          resolve();
        });
        proc.on('error', (error: any) => {
          // Clean up temp file on error
          try {
            if (fs.existsSync(statsScriptPath)) {
              fs.unlinkSync(statsScriptPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          reject(error);
        });
      });
    } catch (error) {
      console.warn("Failed to load database stats:", error);
      setDbStats({ totalMessages: 0, totalConversations: 0, sources: 0, lastUpdated: 0 });
    }
  }, [plugin]);

  // Refresh from DB on mount or when DB path changes (not when sources change)
  useEffect(() => {
    if (plugin.settings.pythonPipeline?.dbPath) {
      console.log("🔄 Auto-refreshing from DB on mount or DB path change");
      console.log("🔄 DB Path:", plugin.settings.pythonPipeline.dbPath);
      console.log("🔄 Messages state before refresh:", messages.length);
      refreshFromDB().catch(err => {
        console.error("❌ Auto-refresh failed:", err);
        setError(err.message || String(err));
      });
    } else {
      console.warn("⚠️ No DB path configured - skipping auto-refresh");
      setError("Database path not configured in settings");
    }
  }, [refreshFromDB, plugin.settings.pythonPipeline?.dbPath]); // Include refreshFromDB in deps

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

  // Expose handlers to view instance for agent macros
  useEffect(() => {
    if (viewInstance) {
      viewInstance.handleTestSync = handleTestSync;
      viewInstance.handleTestAnnotate = handleTestAnnotate;
      viewInstance.handleTestExport = handleTestExport;
    }
  }, [handleTestSync, handleTestAnnotate, handleTestExport, viewInstance]);
  
  // Check if DB exists  
  const [dbExists, setDbExists] = useState<boolean | null>(null);
  
  useEffect(() => {
    const checkDb = async () => {
      if (!plugin.settings.pythonPipeline?.dbPath) {
        setDbExists(false);
        return;
      }
      try {
        const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
        const dbPath = resolveVaultPath(plugin.settings.pythonPipeline.dbPath, vaultBasePath);
        const fs = require("fs");
        setDbExists(fs.existsSync(dbPath));
        
        // Run self-check if DB exists
        if (fs.existsSync(dbPath)) {
          const ctx = getSelfCheckContext(); // Now safe - hoisted from controller
          if (ctx && typeof runSelfCheckAfterAction === "function") {
            void runSelfCheckAfterAction(ctx, { reason: "mount" });
          }
        }
      } catch {
        setDbExists(false);
      }
    };
    checkDb();
  }, [plugin.settings.pythonPipeline?.dbPath]); // getSelfCheckContext is hoisted, no need in deps

  return (
    <div ref={rootRef} className="aip-root">
      {/* Database Warning Banner */}
      {dbExists === false && (
        <div className="aip-banner aip-banner-warning" style={{padding: '10px', background: 'var(--background-modifier-error)', color: 'var(--text-on-accent)', textAlign: 'center'}}>
          <strong>⚠️ Database not found</strong> — Run "Sync from Backups" to create it. Path: {plugin.settings.pythonPipeline?.dbPath || 'not configured'}
        </div>
      )}
      
      {/* Test Mode Wizard */}
      {isTestModeEnabled(plugin.settings.pythonPipeline!) && (
        <TestWizard
          settings={plugin.settings.pythonPipeline!}
          sources={plugin.settings.sources}
          onTestSync={handleTestSync}
          onTestAnnotate={handleTestAnnotate}
          onTestExport={handleTestExport}
        />
      )}
      
      {/* Self-Check Panel */}
      <SelfCheckPanel result={selfCheckResult} isLoading={isRunningSelfCheck} />
      
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
            <button className="aihp-btn" onClick={addSource}>Manage Sources…</button>
            <button 
              className="aihp-btn primary" 
              onClick={syncFromBackups}
              disabled={isImporting}
            >
              {isImporting ? 'Syncing...' : 'Sync from Backups'}
            </button>
            
            {plugin.settings.pythonPipeline?.aiAnnotation?.enabled && (
              <button 
                className="aihp-btn" 
                onClick={annotateWithAI}
                disabled={isImporting}
                title="Annotate conversations with AI"
              >
                Annotate with AI
              </button>
            )}
            
            <button 
              className="aihp-btn" 
              onClick={exportToMarkdown}
              disabled={isImporting}
              title="Export to Markdown files (full content + images)"
            >
              Export to Markdown
            </button>
            
            <button 
              className="aihp-btn" 
              onClick={exportToGraph}
              disabled={isImporting}
              title="Export graph edges only (lightweight links)"
            >
              Export to Graph
            </button>
            
            <button 
              className="aihp-btn" 
              onClick={refreshFromDB}
              disabled={isImporting}
              title="Refresh UI from database"
            >
              Refresh from DB
            </button>

            <input
              className="aihp-input search"
              placeholder="Search messages… (regex ok)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
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
            {plugin.settings.sources.map(source => {
              const fallbackLabel = (()=>{ 
                const label = source.label || getSourceLabel(source.root);
                return label;
              })();
              const subfolders = (source as any).subfolders || [];
              return (
              <span
                key={source.id}
                className={`aihp-chip ${activeSources.has(source.id) ? 'active' : 'inactive'}`}
                style={{ borderColor: source.color || '#666' }}
                onClick={() => toggleSource(source.id)}
                title={`${fallbackLabel} — ${source.root}${subfolders.length > 0 ? `\n${subfolders.length} subfolders discovered` : ''}`}
              >
                {fallbackLabel}
                {subfolders.length > 0 && (
                  <span style={{ fontSize: '0.85em', opacity: 0.7, marginLeft: '4px' }}>
                    ({subfolders.length})
                  </span>
                )}
              </span>
            );})}
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
        <section className="aip-pane aip-left" style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}>
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
            {(() => {
              const firstThree = pagedConversations.slice(0, 3);
              console.log("🔄 Rendering ConversationsList with:", {
                pagedConversationsLength: pagedConversations.length,
                firstThreeRaw: firstThree,
                firstThreeDetails: firstThree.map(c => ({
                  convId: c?.convId,
                  title: c?.title,
                  hasTitle: !!c?.title,
                  hasConvId: !!c?.convId,
                  vendor: c?.vendor,
                  msgCount: c?.msgCount,
                  allKeys: Object.keys(c || {})
                })),
                total: convTotal,
                page: convPage,
                pageCount: convPageCount,
                pageSize: convPageSize
              });
              return (
                <ConversationsList
                  conversations={pagedConversations}
                  selectedConversations={isMultiSelectMode ? selectedConversations : selectedConvKeys}
                  isMultiSelectMode={isMultiSelectMode}
                  onSelectConversation={handleSelectConversation}
                  onToggleConversation={handleSelectConversation}
                  isLoading={messagesLoading}
                />
              );
            })()}
          </LoadingOverlay>
          
          {/* Pagination for conversations list */}
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
                  {isMultiSelectMode 
                    ? `${selectedConversations.size} conversations selected`
                    : selectedConvKeys.size === 1 
                      ? (selectedConvMessages[0].title || "(untitled)")
                      : `${selectedConvKeys.size} conversations selected`
                  }
                </h3>
                <div className="aihp-detail-meta">
                  {isMultiSelectMode
                    ? `${selectedConvMessages.length} messages from ${selectedConversations.size} conversations`
                    : selectedConvKeys.size === 1 
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
            {((isMultiSelectMode && selectedConversations.size > 0) || (!isMultiSelectMode && selectedConvKeys.size > 0)) ? (
              <>
                <h4>Selected Conversations</h4>
                <div className="aip-stats" style={{ backgroundColor: 'var(--aihp-bg-modifier)', padding: '8px', borderRadius: '4px', border: '1px solid var(--aihp-accent)' }}>
                  <div style={{ color: 'var(--aihp-accent)', fontWeight: 'bold', fontSize: '14px' }}>
                    {isMultiSelectMode ? selectedConversations.size : selectedConvKeys.size} conversation{(isMultiSelectMode ? selectedConversations.size : selectedConvKeys.size) !== 1 ? 's' : ''} selected
                  </div>
                  <div>Messages: {selectedConvMessages.length.toLocaleString()}</div>
                  <div>Turns: {selectedConvTurns.length.toLocaleString()}</div>
                  <div>Page: {msgPage} / {msgPageCount}</div>
                  {isMultiSelectMode && (
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--aihp-bg-modifier)' }}>
                      <div style={{ fontSize: '12px', color: 'var(--aihp-text-muted)' }}>
                        Multi-select mode active
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}

            <h4>Vendor Breakdown</h4>
            <div className="aip-vendor-stats">
              {Object.entries(
                filteredMessages.reduce((acc: Record<string, number>, msg: any) => {
                  // Use the normalized vendor field (should always be CHATGPT, CLAUDE, etc.)
                  // Do NOT use msg.title, msg.sourceId, or any other field - only msg.vendor
                  const vendorKey = msg.vendor || 'CHATGPT';
                  
                  // Only count valid vendor names (uppercase, no spaces)
                  if (vendorKey && vendorKey.toUpperCase() === vendorKey && !vendorKey.includes(' ')) {
                    acc[vendorKey] = (acc[vendorKey] || 0) + 1;
                  }
                  
                  return acc;
                }, {} as Record<string, number>)
              )
              .filter(([vendor]) => {
                // Only show valid vendor names: CHATGPT, CLAUDE, GEMINI, GROK
                const validVendors = ['CHATGPT', 'CLAUDE', 'GEMINI', 'GROK'];
                return validVendors.includes(vendor.toUpperCase());
              })
              .sort(([, a], [, b]) => b - a) // Sort by count descending
              .slice(0, 20) // Limit to top 20
              .map(([vendor, count]) => {
                // Map vendor codes to user-friendly names
                const vendorUpper = vendor.toUpperCase();
                const vendorDisplay = vendorUpper === 'CHATGPT' ? 'ChatGPT' :
                                    vendorUpper === 'CLAUDE' ? 'Claude' :
                                    vendorUpper === 'GEMINI' ? 'Gemini' :
                                    vendorUpper === 'GROK' ? 'Grok' :
                                    vendorUpper;
                
                const vendorFilter = vendorUpper === 'CHATGPT' ? 'chatgpt' :
                                   vendorUpper === 'CLAUDE' ? 'claude' :
                                   vendorUpper === 'GEMINI' ? 'gemini' :
                                   vendorUpper === 'GROK' ? 'grok' :
                                   vendorUpper.toLowerCase();
                
                return (
                  <div 
                    key={vendor} 
                    className="aip-vendor-item" 
                    style={{ 
                      cursor: 'pointer', 
                      padding: '6px 10px', 
                      borderRadius: '4px', 
                      transition: 'background 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px',
                      border: facets.vendor === vendorFilter ? '1px solid var(--aihp-accent)' : '1px solid transparent'
                    }}
                    onClick={() => {
                      // Toggle filter by this vendor
                      setFacets(prev => ({ 
                        ...prev, 
                        vendor: (prev.vendor === vendorFilter) ? 'all' : vendorFilter as any 
                      }));
                    }}
                    onMouseEnter={(e) => {
                      if (facets.vendor !== vendorFilter) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (facets.vendor !== vendorFilter) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      }
                    }}
                    title={`Click to ${facets.vendor === vendorFilter ? 'clear filter' : 'filter by'} ${vendorDisplay}`}
                  >
                    <span className="aip-vendor-name">{vendorDisplay}</span>
                    <span className="aip-vendor-count">{count.toLocaleString()}</span>
                  </div>
                );
              })}
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
    this.titleEl.setText("Pick a parent folder (subfolders will be discovered automatically)");
    const body = this.contentEl.createDiv({ cls: "aihp-modal" });
    const input = body.createEl("input", { 
      type: "text", 
      value: "", 
      cls: "aihp-input",
      placeholder: "Enter parent folder path (e.g., AI Exports) or browse below..."
    });
    const list = body.createEl("div", { cls: "aihp-folder-list" });

    // Gather parent folders that contain backup files (ZIP/JSON/HTML)
    // Prefer parent-level folders that contain subfolders with exports
    type Row = { exportRoot:string; date?:string; hint:string; isParent:boolean; depth:number };
    const rows: Row[] = [];
    const seen = new Set<string>();
    
    const collect = (f: TAbstractFile, depth: number = 0) => {
      if (f instanceof TFolder) {
        const path = f.path;
        const base = path.split('/').pop() || path;
        const { date } = parseExportInfo(base);
        
        // Check for backup files in this folder
        let hasBackupFiles = false;
        let backupFileCount = 0;
        let hasSubfoldersWithBackups = false;
        
        for (const c of f.children) {
          if (c instanceof TFile) {
            const name = c.name.toLowerCase();
            if (/\.(zip|json|html)$/i.test(name)) {
              hasBackupFiles = true;
              backupFileCount++;
            }
          } else if (c instanceof TFolder && depth < 3) {
            // Check if subfolder has backup files
            for (const subChild of c.children) {
              if (subChild instanceof TFile) {
                const subName = subChild.name.toLowerCase();
                if (/\.(zip|json|html)$/i.test(subName)) {
                  hasSubfoldersWithBackups = true;
                  break;
                }
              }
            }
          }
        }
        
        // Prefer parent folders (those with subfolders containing backups)
        // Only add if:
        // 1. It's a parent folder with subfolders that have backups, OR
        // 2. It directly contains backup files and isn't a subfolder of an already-added parent
        const isParent = hasSubfoldersWithBackups && !hasBackupFiles;
        const isLeafWithBackups = hasBackupFiles && !hasSubfoldersWithBackups;
        
        // Check if this path is a subfolder of an already-added parent
        const isSubfolderOfParent = rows.some(r => 
          r.isParent && path.startsWith(r.exportRoot + '/')
        );
        
        // Only add parent folders OR leaf folders that aren't children of a parent
        // This ensures we only show parent-level folders, not individual child folders
        if (!seen.has(path) && (isParent || (isLeafWithBackups && !isSubfolderOfParent))) {
          seen.add(path);
          // Count ALL subfolders (not just those with backups) for hint
          let subfolderCount = 0;
          if (isParent) {
            // Count all immediate subfolders
            for (const child of f.children) {
              if (child instanceof TFolder) {
                subfolderCount++;
              }
            }
          }
          const hint = isParent 
            ? `${subfolderCount} subfolders`
            : (backupFileCount > 0 ? `${backupFileCount} backup files` : 'backup files');
          rows.push({ 
            exportRoot: path, 
            date, 
            hint,
            isParent,
            depth
          });
        }
        
        // Recurse (limit depth for performance)
        if (depth < 3) {
          for (const c of f.children) {
            if (c instanceof TFolder) {
              collect(c, depth + 1);
            }
          }
        }
      }
    };
    collect(this.app.vault.getRoot(), 0);

    // Filter out child folders if a parent exists (only show parents)
    const filteredRows = rows.filter(r => {
      // Keep parent folders
      if (r.isParent) return true;
      // Keep leaf folders only if no parent folder contains them
      const isChildOfParent = rows.some(p => 
        p.isParent && r.exportRoot.startsWith(p.exportRoot + '/')
      );
      return !isChildOfParent;
    });
    
    // Sort: parent folders first, then by date, then alphabetically
    filteredRows.sort((a,b)=>{
      // Parent folders first
      if (a.isParent && !b.isParent) return -1;
      if (!a.isParent && b.isParent) return 1;
      // Then by date
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1; if (b.date) return 1;
      // Then alphabetically
      return a.exportRoot.localeCompare(b.exportRoot);
    });

    const render = () => {
      list.empty();
      const q = (input.value || '').toLowerCase();
      for (const r of filteredRows) {
        if (q && !r.exportRoot.toLowerCase().includes(q) && !r.date?.includes(q)) continue;
        const item = list.createDiv({ cls: "aihp-folder-item compact" });
        const folderName = r.exportRoot.split('/').pop() || r.exportRoot;
        const label = r.isParent 
          ? `📁 ${folderName} (${r.hint})` 
          : (r.date || folderName);
        item.setText(label);
        item.setAttr('title', `${r.exportRoot}${r.isParent ? ' (parent folder - subfolders will be discovered automatically)' : ''}`);
        item.onClickEvent(() => { 
          input.value = r.exportRoot;
          console.log(`[FolderPicker] Selected folder: "${r.exportRoot}" (isParent: ${r.isParent})`);
        });
      }
    };

    input.addEventListener('input', render);
    render();

    const bar = body.createDiv({ cls: "aihp-modal-actions" });
    const ok = bar.createEl("button", { text: "Use folder" });
    const cancel = bar.createEl("button", { text: "Cancel" });
    ok.onClickEvent(() => { 
      const selectedPath = input.value.trim();
      // If user clicked a row, use that path; otherwise use typed value
      // Remove trailing slash (but keep leading slash if it's root)
      let finalPath = selectedPath.replace(/\/+$/, '');
      // If empty after trimming slashes, set to empty string (vault root)
      if (finalPath === '/' || finalPath === '') {
        finalPath = '';
      }
      this.picked = finalPath;
      console.log(`[FolderPicker] User confirmed path: "${this.picked}"`);
      this.close(); 
    });
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