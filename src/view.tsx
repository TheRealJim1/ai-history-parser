import { ItemView, Modal, TAbstractFile, WorkspaceLeaf, TFolder, TFile, Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { parseMultipleSources, searchMessages, highlightText } from "./parser";
import { SearchWithHistory } from "./components/SearchWithHistory";
import { executePythonScript, buildSyncCommand, buildAnnotateCommand, buildExportCommand } from "./utils/scriptRunner";
import { exportSearchResults } from "./utils/exportSearch";
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
import { CollectionGripper } from "./components/CollectionGripper";
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
import { ConversationsList } from "./ui/ConversationsList";
import { DatabaseManager } from "./components/DatabaseManager";
import { CollectionPanel, useCollectionPanel, CollectionProvider, type Collection } from "./ui/CollectionPanel";
import { LoadingScreen, type LoadingStep } from "./ui/LoadingScreen";
import { AttachmentGallery } from "./ui/AttachmentGallery";
import { AttachmentViewer, type Attachment } from "./ui/AttachmentViewer";
// import { LMStudioManager } from "./components/LMStudioManager"; // Reserved for future action
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
    
    // Render UI immediately - loading will be deferred inside the component
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
  // Vendor breakdown mode toggle
  const [vendorMode, setVendorMode] = useState<'folder'|'company'>('folder');
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

  // Tree navigation state
  const [treeNodes, setTreeNodes] = useState<any[]>([]);
  const [hasTree, setHasTree] = useState(false);
  const [selectedBranchPath, setSelectedBranchPath] = useState<string[]>([]); // Track which branch we're viewing
  
  // Database Manager modal state
  const [showDatabaseManager, setShowDatabaseManager] = useState(false);
  
  // Tag filtering state
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'conversation' | 'tagged' | 'attachments'>('conversation');
  
  // Attachment filtering state
  const [attachmentFilter, setAttachmentFilter] = useState<'all' | 'has' | 'missing' | 'remote'>('all');
  const [conversationAttachments, setConversationAttachments] = useState<any[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [showAttachmentGallery, setShowAttachmentGallery] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<any | null>(null);

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

  // Filter messages based on search and facets
  // Note: When search query is provided, FTS5 search is done at the database level
  // So messages from DB are already filtered by search. We only apply facet filters here.
  const filteredMessages = useMemo(() => {
    if (!messages.length) return [];
    
    let filtered: FlatMessage[];
    
    // Apply facet filters (vendor, role, date, sources)
      filtered = messages.filter(msg => {
        if (facets.vendor && facets.vendor !== 'all' && msg.vendor !== facets.vendor) return false;
        if (facets.role && facets.role !== 'any' && msg.role !== facets.role) return false;
      if (facets.from && msg.createdAt && msg.createdAt < new Date(facets.from).getTime()) return false;
      if (facets.to && msg.createdAt && msg.createdAt > new Date(facets.to).getTime() + 86400000) return false;
        // Only filter by activeSources if there are active sources selected
        if (activeSources.size > 0 && !activeSources.has(msg.sourceId)) return false;
        return true;
      });
    
    // If search query was provided, messages are already ranked by FTS5 from DB
    // Sort by FTS5 rank if available, otherwise by date
      if (debouncedQuery.trim()) {
      filtered.sort((a, b) => {
        const aRank = (a as any).fts_rank || 0;
        const bRank = (b as any).fts_rank || 0;
        if (aRank !== bRank) return bRank - aRank; // Higher rank first (FTS5 returns lower rank = better)
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
    }
    
    return filtered;
  }, [messages, debouncedQuery, facets, activeSources]);

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
    const folderPathByConv = new Map<string, string>();
    for (const m of deduplicatedMessages) {
      const arr = byConvId.get(m.conversationId) || [];
      arr.push({ text: m.text });
      byConvId.set(m.conversationId, arr);
      if (!firstMsgByConv.has(m.conversationId)) firstMsgByConv.set(m.conversationId, m);
      // Track folder_path per conversation (from messages)
      if (m.folder_path && !folderPathByConv.has(m.conversationId)) {
        folderPathByConv.set(m.conversationId, m.folder_path);
      }
    }

    const sourceIdToLabel = new Map<string, string>();
    for (const s of plugin.settings.sources) sourceIdToLabel.set(s.id, s.label || s.id);

    // Get annotation map for outlier/attachment counts
    const annotationMap = (setMessages as any).__annotations || new Map();

    const result = index.map(conv => {
      // Temporarily disable auto-tagging (dom:/ent:/lang:) to reduce noise.
      // Keep only batch label so exports remain distinguishable.
      const tags: string[] = [];
      const fm = firstMsgByConv.get(conv.convId);
      const batch = fm ? sourceIdToLabel.get(fm.sourceId) : undefined;
      if (batch) tags.push(`batch:${batch}`);
      
      // Extract first user/assistant line for title fallback
      const firstUserLine = (() => {
        if (fm && fm.text) {
          const text = fm.text.split('\n')[0].trim();
          return text.length > 80 ? text.substring(0, 80).trim() : text;
        }
        return null;
      })();
      
      // Get meta from first message of conversation if available
      const convMeta = (() => {
        const fm = firstMsgByConv.get(conv.convId);
        if (fm && (fm as any).meta) {
          try {
            return typeof (fm as any).meta === 'string' 
              ? JSON.parse((fm as any).meta || '{}') 
              : ((fm as any).meta || {});
          } catch {
            return {};
          }
        }
        return {};
      })();
      
      // Get outlier and attachment counts from annotation map
      const annotation = annotationMap.get(conv.convId);
      const outlierCount = (annotation as any)?.outlier_count || 0;
      const attachmentCount = (annotation as any)?.attachment_count || 0;
      const attachmentBlobCount = (annotation as any)?.attachment_blob_count || 0;
      const attachmentRemoteCount = (annotation as any)?.attachment_remote_count || 0;
      const attachmentMissingCount = (annotation as any)?.attachment_missing_count || 0;
      // Auto-tags (fast wins) — keep outlier, remove attach for now (too noisy)
      if (outlierCount > 0) tags.push(`outlier:${outlierCount}`);
      
      return {
        key: conv.convId, // For pagination hook
        convId: conv.convId, // already in format "vendor:convId"
        title: conv.title,
        vendor: conv.vendor,
        msgCount: conv.msgCount,
        firstTs: conv.firstTs,
        lastTs: conv.lastTs,
        tags,
        firstUserLine,
        folder_path: folderPathByConv.get(conv.convId) || "",  // Include folder_path from messages
        meta: convMeta,  // Include meta for pairing information
        outlierCount,  // Include outlier count from database
        attachmentCount,  // Include attachment count from database
        attachmentBlobCount,
        attachmentRemoteCount,
        attachmentMissingCount
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

  // Selected conversation (single-select only)
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Message selection state for collections
  const [isMessageSelectMode, setIsMessageSelectMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [selectedTextSelections, setSelectedTextSelections] = useState<Map<string, string>>(new Map());
  
  // Collections context (synced via provider)
  const { collections, addToCollection, setCollections, usingDatabase } = useCollectionPanel();
  
  // Collection gripper state
  const [gripperState, setGripperState] = useState<{
    show: boolean;
    text: string;
    position: { x: number; y: number };
  }>({ show: false, text: '', position: { x: 0, y: 0 } });
  
  // Loading screen state
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>([]);
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const [showDevInfo, setShowDevInfo] = useState(false);
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
    if (!selectedConvKey && pagedConversations.length > 0) {
      const firstConv = pagedConversations[0];
      const firstConvId = firstConv?.convId;
      if (firstConvId) {
        console.log("🔄 Auto-selecting first conversation:", firstConvId, firstConv?.title);
        setSelectedConvKey(firstConvId);
      }
    }
  }, [pagedConversations, selectedConvKey]);
  
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

  // Handle conversation selection (single-select or multi-select)
  const handleConvClick = (convKey: string, index?: number, shiftKey?: boolean) => {
    console.log("🔄 Conversation clicked:", convKey, "multi-select:", isMultiSelectMode, "shift:", shiftKey);
    
    if (isMultiSelectMode) {
      if (shiftKey && lastSelectedIndex !== null && index !== undefined) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const range = pagedConversations.slice(start, end + 1).map(c => c.convId).filter(Boolean);
        setSelectedConversations(prev => {
          const next = new Set(prev);
          range.forEach(id => next.add(id));
          return next;
        });
        setLastSelectedIndex(index);
        } else {
        // Toggle single conversation
        setSelectedConversations(prev => {
          const next = new Set(prev);
          if (next.has(convKey)) {
            next.delete(convKey);
          } else {
            next.add(convKey);
          }
          return next;
        });
        if (index !== undefined) {
          setLastSelectedIndex(index);
        }
      }
    } else {
      // Single-select mode
      setSelectedConvKey(convKey);
      setSelectedBranchPath([]); // Reset branch path when selecting new conversation
    }
  };

  // Filter conversations by tag
  const taggedConversations = useMemo(() => {
    if (!activeTagFilter) return [];
    return groupedByConversation.filter(conv => 
      conv.tags && conv.tags.some(tag => tag === activeTagFilter || tag.includes(activeTagFilter))
    );
  }, [groupedByConversation, activeTagFilter]);

  // Messages for tagged conversations
  const taggedMessages = useMemo(() => {
    if (!activeTagFilter || taggedConversations.length === 0) return [];
    const taggedConvIds = new Set(taggedConversations.map(c => c.convId));
    return filteredMessages.filter(msg => taggedConvIds.has(msg.conversationId));
  }, [filteredMessages, taggedConversations, activeTagFilter]);

  // Messages for the selected conversation (with tree branch filtering if applicable)
  const selectedConvMessages = useMemo(() => {
    console.log("🔄 Filtering messages for selected conversation:", selectedConvKey);
    console.log("🔄 Total filtered messages:", filteredMessages.length);
    console.log("🔄 Has tree:", hasTree);
    console.log("🔄 Selected branch path:", selectedBranchPath);

    if (!selectedConvKey) {
      console.log("🔄 No conversation selected, returning empty messages");
      return [] as FlatMessage[];
    }

    let selected = filteredMessages
      .filter(m => m.conversationId === selectedConvKey)
      .sort((a,b) => a.createdAt - b.createdAt);

    // If tree structure is available and we have a branch path, filter by branch
    if (hasTree && selectedBranchPath.length > 0 && treeNodes.length > 0) {
      // Build a set of message IDs that are in the selected branch path
      const branchMessageIds = new Set<string>();
      const nodeMap = new Map<string, any>();
      
      // Build node map for this conversation
      treeNodes
        .filter((n: any) => n.conversation_id === selectedConvKey)
        .forEach((n: any) => {
          nodeMap.set(n.id, n);
        });
      
      // Traverse the branch path to collect message IDs
      let currentNodeId = selectedBranchPath[0];
      for (const branchNodeId of selectedBranchPath) {
        const node = nodeMap.get(branchNodeId);
        if (node && node.message_id) {
          branchMessageIds.add(node.message_id);
        }
        // Follow children chain
        if (node && node.children_ids) {
          const children = typeof node.children_ids === 'string' 
            ? JSON.parse(node.children_ids) 
            : node.children_ids;
          if (Array.isArray(children) && children.length > 0) {
            currentNodeId = children[0]; // Follow first child
          }
        }
      }
      
      // Filter messages to only those in the branch
      if (branchMessageIds.size > 0) {
        selected = selected.filter(m => branchMessageIds.has(m.messageId));
        console.log(`🔄 Filtered to branch: ${selected.length} messages in branch path`);
      }
    }

    // Filter by attachment status if attachment filter is active
    if (attachmentFilter !== 'all' && conversationAttachments.length > 0) {
      const messageIdsWithAttachments = new Set(
        conversationAttachments
          .filter(att => {
            if (attachmentFilter === 'has') return att.storage_status === 'filesystem';
            if (attachmentFilter === 'missing') return att.storage_status === 'missing';
            if (attachmentFilter === 'remote') return att.storage_status === 'remote';
            return true;
          })
          .map(att => att.message_id)
          .filter(Boolean)
      );
      
      if (messageIdsWithAttachments.size > 0) {
        selected = selected.filter(m => messageIdsWithAttachments.has(m.messageId));
        console.log(`🔄 Filtered by attachments (${attachmentFilter}): ${selected.length} messages`);
      } else if (attachmentFilter === 'has') {
        // No messages with attachments match the filter
        selected = [];
      }
    }

    console.log("🔄 Selected messages:", selected.length);
    return selected;
  }, [filteredMessages, selectedConvKey, hasTree, selectedBranchPath, treeNodes, attachmentFilter, conversationAttachments]);

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

  // Tree navigation helpers
  const getTreeNodesForConversation = useCallback((convId: string) => {
    if (!hasTree || !treeNodes.length) return [];
    return treeNodes.filter((n: any) => n.conversation_id === convId);
  }, [hasTree, treeNodes]);

  const getBranchPointsForConversation = useCallback((convId: string) => {
    const nodes = getTreeNodesForConversation(convId);
    return nodes.filter((n: any) => n.is_branch_point === 1);
  }, [getTreeNodesForConversation]);

  const navigateToBranch = useCallback((branchNodeId: string) => {
    if (!hasTree || !selectedConvKey) return;
    
    const nodeMap = new Map<string, any>();
    treeNodes
      .filter((n: any) => {
        const nodeConvId = n.conversation_id || n.conversationId;
        return nodeConvId === selectedConvKey || nodeConvId === selectedConvKey.split(':').slice(1).join(':');
      })
      .forEach((n: any) => {
        nodeMap.set(n.id, n);
        // Also index by messageId if available
        if (n.messageId) {
          nodeMap.set(n.messageId, n);
        }
      });
    
    // Try to find the node by ID or messageId
    let targetNode = nodeMap.get(branchNodeId);
    if (!targetNode) {
      // Try to find by messageId
      for (const [id, node] of nodeMap.entries()) {
        if (node.messageId === branchNodeId || node.id === branchNodeId) {
          targetNode = node;
          break;
        }
      }
    }
    
    if (!targetNode) {
      console.warn("⚠️ Could not find branch node:", branchNodeId);
      return;
    }
    
    // Build path from root to this branch node
    const path: string[] = [];
    let currentNodeId: string | null = targetNode.id;
    
    while (currentNodeId) {
      const node = nodeMap.get(currentNodeId);
      if (!node) break;
      
      path.unshift(currentNodeId);
      currentNodeId = node.parentId || node.parent_id || null;
    }
    
    setSelectedBranchPath(path);
    console.log("🔄 Navigated to branch:", path, "for node:", branchNodeId);
  }, [hasTree, selectedConvKey, treeNodes]);

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
    currentFilterHash: `${filterHash}|conv=${selectedConvKey || 'none'}|branch=${selectedBranchPath.join(',')}`
  });

  // NOTE: Folder parsing is now disabled - use refreshFromDB instead
  // All folder parsing code has been removed - plugin now reads from external DB only
  
  // Refresh from DB - reads from external database (defined first for loadMessages)
  // Supports FTS5 search when searchQuery is provided
  const refreshFromDB = useCallback(async (searchQueryOverride?: string, showLoading: boolean = true) => {
    const { pythonPipeline } = plugin.settings;
    
    if (!pythonPipeline?.dbPath) {
      setError("Database path not configured");
      return;
    }

    setMessagesLoading(true);
    setStatus("loading");
    // Only show loading screen for non-search operations (initial load, manual refresh, etc.)
    if (showLoading) {
      setShowLoadingScreen(true);
    }
    
    // Initialize loading steps
    const initialSteps: LoadingStep[] = [
      { name: "Checking database file", status: 'pending' },
      { name: "Connecting to database", status: 'pending' },
      { name: "Querying conversations", status: 'pending' },
      { name: "Loading messages", status: 'pending' },
      { name: "Processing tree structure", status: 'pending' },
      { name: "Finalizing data", status: 'pending' }
    ];
    setLoadingSteps(initialSteps);
    
    // Helper to update loading steps
    const updateStep = (stepName: string, updates: Partial<LoadingStep>) => {
      setLoadingSteps(prev => prev.map(s => 
        s.name === stepName ? { ...s, ...updates } : s
      ));
    };
    
    // Use searchQueryOverride if provided, otherwise use current debouncedQuery
    const queryToUse = searchQueryOverride !== undefined ? searchQueryOverride : debouncedQuery;
    
    // Initialize progress tracking
    const progressHandle = statusBus.begin("refresh-db", queryToUse.trim() ? "Searching database..." : "Loading from database...");
    
    try {
      // Use Python bridge script to query DB and return JSON
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pythonPipeline.dbPath, vaultBasePath);
      
      // Step 1: Check database file
      updateStep("Checking database file", { status: 'loading', message: `Checking: ${dbPath}` });
      console.log("🔄 [Step 1/6] Checking database file:", dbPath);
      
      // Check if DB exists first
      const { spawn } = require("child_process");
      const fs = require("fs");
      if (!fs.existsSync(dbPath)) {
        updateStep("Checking database file", { status: 'error', message: 'Database not found' });
        progressHandle.fail("Database not found");
        throw new Error(`Database not found: ${dbPath}. Please configure the database path in settings.`);
      }
      
      updateStep("Checking database file", { status: 'complete', message: 'Database file found' });
      console.log("✅ [Step 1/6] Database file found");
      
      // Step 2: Connecting to database
      updateStep("Connecting to database", { status: 'loading', message: 'Initializing connection...' });
      console.log("🔄 [Step 2/6] Connecting to database");
      
      // Use external query script that auto-detects schema (old vs new)
      const path = require("path");
      const queryScriptPath = path.join(
        pythonPipeline.scriptsRoot || vaultBasePath,
        'tools',
        'obsidian_query_script_v2.py'
      );
      
      // Check if query script exists, fallback to inline script if not
      if (!fs.existsSync(queryScriptPath)) {
        updateStep("Connecting to database", { status: 'error', message: 'Query script not found' });
        progressHandle.fail("Query script not found");
        throw new Error(`Query script not found: ${queryScriptPath}. Please ensure tools/obsidian_query_script_v2.py exists.`);
      }
      
      updateStep("Connecting to database", { status: 'complete', message: 'Connection established' });
      console.log("✅ [Step 2/6] Database connection established");
      
      // Step 3: Querying conversations
      updateStep("Querying conversations", { status: 'loading', message: 'Executing query script...' });
      console.log("🔄 [Step 3/6] Executing query script");
      
      // Execute query script with database path and optional search query
      // Use shell:false since we're passing args as an array
      const args = [queryScriptPath, dbPath];
      // Add search query if provided (for FTS5 search)
      // Prefix with / to indicate regex mode (won't use FTS5)
      if (queryToUse && queryToUse.trim()) {
        if (facets.regex) {
          args.push(`/${queryToUse.trim()}`);
        } else {
          args.push(queryToUse.trim());
        }
      }
      
      const proc = spawn(
        pythonPipeline.pythonExecutable || 'python',
        args,
        { shell: false, cwd: pythonPipeline.scriptsRoot || vaultBasePath }
      );
      
      let stdout = '';
      let stderr = '';
      let conversationCount = 0;
      let totalConversations = 0;
      
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
            totalConversations = parseInt(line.split(':')[2], 10);
            if (!isNaN(totalConversations)) {
              progressHandle.setTotal(totalConversations);
              progressHandle.label("Loading conversations...", `0/${totalConversations} conversations`);
              updateStep("Querying conversations", { 
                status: 'loading', 
                message: `Found ${totalConversations} conversations`,
                progress: 0,
                total: totalConversations
              });
            }
          } else if (line.startsWith('PROGRESS:TICK:')) {
            const parts = line.split(':');
            if (parts.length >= 4) {
              conversationCount = parseInt(parts[2], 10);
              const total = parseInt(parts[3], 10);
              if (!isNaN(conversationCount) && !isNaN(total)) {
                progressHandle.set(conversationCount, `${conversationCount}/${total} conversations`);
                updateStep("Querying conversations", { 
                  status: 'loading', 
                  message: `Processing ${conversationCount}/${total} conversations`,
                  progress: conversationCount,
                  total: total
                });
              }
            }
          }
        }
      });
      
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code: number) => {
          if (code === 0) {
            try {
              updateStep("Querying conversations", { status: 'complete', message: `Loaded ${conversationCount || 'all'} conversations` });
              console.log("✅ [Step 3/6] Conversations queried");
              
              // Step 4: Loading messages
              updateStep("Loading messages", { status: 'loading', message: 'Parsing message data...' });
              console.log("🔄 [Step 4/6] Parsing message data");
              
              const data = JSON.parse(stdout);
              
              // Step 5: Processing tree structure
              updateStep("Processing tree structure", { status: 'loading', message: 'Analyzing tree data...' });
              console.log("🔄 [Step 5/6] Processing tree structure");
              
              // Store tree structure if available (for tree visualization)
              const hasTree = data.hasTree || false;
              const schema = data.schema || 'v1';
              const treeNodes = data.nodes || [];
              
              // Store tree data globally for tree view components and in state
              if (hasTree && treeNodes.length > 0) {
                (window as any).__aihp_tree_nodes = treeNodes;
                (window as any).__aihp_has_tree = true;
                setTreeNodes(treeNodes);
                setHasTree(true);
                updateStep("Processing tree structure", { status: 'complete', message: `${treeNodes.length} nodes loaded` });
                console.log(`✅ [Step 5/6] Tree structure loaded: ${treeNodes.length} nodes, schema: ${schema}`);
              } else {
                (window as any).__aihp_tree_nodes = [];
                (window as any).__aihp_has_tree = false;
                setTreeNodes([]);
                setHasTree(false);
                updateStep("Processing tree structure", { status: 'complete', message: 'No tree structure available' });
                console.log(`✅ [Step 5/6] No tree structure available (schema: ${schema})`);
              }
              
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
              // Preserve meta field for pairing information and include outlier/attachment counts
              const conversations: ConversationAnnotation[] = (data.conversations || []).map((c: any) => {
                const row = mapAnnotationRow(c);
                // Preserve meta field for pairing information
                if (c.meta) {
                  try {
                    (row as any).meta = typeof c.meta === 'string' ? JSON.parse(c.meta) : c.meta;
                  } catch {
                    (row as any).meta = {};
                  }
                }
                // Include outlier_count and attachment counts
                if (c.outlier_count !== undefined) (row as any).outlier_count = c.outlier_count || 0;
                if (c.attachment_count !== undefined) (row as any).attachment_count = c.attachment_count || 0;
                if (c.attachment_blob_count !== undefined) (row as any).attachment_blob_count = c.attachment_blob_count || 0;
                if (c.attachment_remote_count !== undefined) (row as any).attachment_remote_count = c.attachment_remote_count || 0;
                if (c.attachment_missing_count !== undefined) (row as any).attachment_missing_count = c.attachment_missing_count || 0;
                return row;
              });
              
              // Store annotations in a map for quick lookup
              const annotationMap = new Map<string, ConversationAnnotation>();
              conversations.forEach(c => annotationMap.set(c.id, c));
              
              // Store in state (we'll use this for annotation display)
              (setMessages as any).__annotations = annotationMap;
              
              updateStep("Loading messages", { status: 'complete', message: `Parsed ${flatMessages.length} messages` });
              console.log("✅ [Step 4/6] Messages loaded");
              
              // Step 6: Finalizing data
              updateStep("Finalizing data", { status: 'loading', message: 'Updating UI state...' });
              console.log("🔄 [Step 6/6] Finalizing data");
              
              setMessages(flatMessages);
              setStatus("ready");
              setError("");
              progressHandle.end();
              
              updateStep("Finalizing data", { status: 'complete', message: `${flatMessages.length} messages, ${conversations.length} conversations` });
              console.log(`✅ [Step 6/6] Refreshed ${flatMessages.length} messages from DB, ${conversations.length} conversations with annotations`);
              
              // Hide loading screen after a brief delay (only if it was shown)
              if (showLoading) {
                setTimeout(() => {
                  setShowLoadingScreen(false);
                }, 500);
              }
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
      
      // Hide loading screen if it was shown
      if (showLoading) {
        setShowLoadingScreen(false);
      }
      
      // Mark current step as error
      const currentStep = loadingSteps.find(s => s.status === 'loading');
      if (currentStep) {
        setLoadingSteps(prev => prev.map(s => 
          s.name === currentStep.name ? { ...s, status: 'error' as const, message: error.message } : s
        ));
      }
      
      // Don't hide loading screen on error so user can see what failed
    } finally {
      setMessagesLoading(false);
    }
  }, [plugin]);

  // Handle search state separately - refresh from DB when search query changes (after debounce)
  // Note: This must be after refreshFromDB is defined
  useEffect(() => {
    if (debouncedQuery.trim()) {
      setIsSearching(true);
      // Refresh from DB with search query to use FTS5 - don't show loading screen for search
      refreshFromDB(debouncedQuery, false).finally(() => {
        setIsSearching(false);
      });
    } else if (debouncedQuery === '') {
      // Empty query - refresh without search - don't show loading screen for clearing search
      refreshFromDB('', false);
    }
  }, [debouncedQuery, facets.regex, refreshFromDB]);

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

  // Defer initial load - only load when view is actually opened, not on vault load
  // This prevents blocking Obsidian startup
  const [hasInitialized, setHasInitialized] = useState(false);
  
  useEffect(() => {
    // Only load once when view is first opened, not on every mount
    if (hasInitialized || !plugin.settings.pythonPipeline?.dbPath) {
      return;
    }
    
    // Small delay to let Obsidian finish loading
    const timer = setTimeout(() => {
      console.log("🔄 Loading from DB (deferred)");
      setHasInitialized(true);
      refreshFromDB().catch(err => {
        console.error("❌ Auto-refresh failed:", err);
        setError(err.message || String(err));
      });
    }, 500); // 500ms delay to not block startup
    
    return () => clearTimeout(timer);
  }, [hasInitialized, plugin.settings.pythonPipeline?.dbPath, refreshFromDB]);
  
  // Reload when DB path changes (but only if already initialized)
  useEffect(() => {
    if (hasInitialized && plugin.settings.pythonPipeline?.dbPath) {
      console.log("🔄 DB path changed, reloading...");
      refreshFromDB().catch(err => {
        console.error("❌ Reload failed:", err);
        setError(err.message || String(err));
      });
    } else if (!plugin.settings.pythonPipeline?.dbPath) {
      setError("Database path not configured in settings");
    }
  }, [hasInitialized, plugin.settings.pythonPipeline?.dbPath, refreshFromDB]);

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

  const [showCollectionPopout, setShowCollectionPopout] = useState(true);
  const [collectionPopoutWidth, setCollectionPopoutWidth] = useState(() => {
    const saved = localStorage.getItem('aihp-collection-width');
    const parsed = saved ? parseInt(saved, 10) : 400;
    if (Number.isNaN(parsed)) return 400;
    return Math.min(Math.max(parsed, 320), 640);
  });
  const collectionWidthRef = useRef(collectionPopoutWidth);
  useEffect(() => {
    collectionWidthRef.current = collectionPopoutWidth;
    localStorage.setItem('aihp-collection-width', String(collectionPopoutWidth));
  }, [collectionPopoutWidth]);
  const [isResizingCollectionPopout, setIsResizingCollectionPopout] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(collectionPopoutWidth);
  const collectionThemes = useMemo(() => ([
    { base: '#f97316', hover: '#fb923c', border: '#f97316', glow: 'rgba(249,115,22,0.45)', emoji: '📦' },
    { base: '#6366f1', hover: '#8b5cf6', border: '#6366f1', glow: 'rgba(99,102,241,0.45)', emoji: '🗂️' },
    { base: '#10b981', hover: '#34d399', border: '#059669', glow: 'rgba(16,185,129,0.4)', emoji: '🧰' },
    { base: '#5b8fb8', hover: '#7ba5c4', border: '#4a7fa0', glow: 'rgba(91,143,184,0.35)', emoji: '🧾' }
  ]), []);
  const [collectionThemeIndex] = useState(() => Math.floor(Math.random() * collectionThemes.length));
  const [collectionButtonHover, setCollectionButtonHover] = useState(false);
  const [collectionToolbarHover, setCollectionToolbarHover] = useState(false);

  const buildCollectionButtonStyle = (active: boolean, hovered: boolean, variant: 'primary' | 'toolbar') => {
    const padding = variant === 'primary' ? '6px 16px' : '6px 14px';
    const fontSize = variant === 'primary' ? '13px' : '12px';
    const radius = variant === 'primary' ? '10px' : '8px';
    const shadow = variant === 'primary'
      ? `inset 0 3px 6px rgba(0,0,0,0.45), 0 12px 24px ${collectionTheme.glow}`
      : `inset 0 2px 4px rgba(0,0,0,0.35), 0 8px 18px ${collectionTheme.glow}`;
    return {
      padding,
      fontSize,
      fontWeight: 600,
      borderRadius: radius,
      border: `1px solid ${collectionTheme.border}`,
      background: (hovered || active)
        ? `linear-gradient(135deg, ${collectionTheme.hover}, ${collectionTheme.base})`
        : `linear-gradient(135deg, ${collectionTheme.base}, ${collectionTheme.hover})`,
      boxShadow: shadow,
      color: '#ffffff',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      transition: 'all 0.2s ease',
      transform: hovered || active ? 'translateY(-1px)' : 'translateY(0)',
      textShadow: '0 1px 2px rgba(0,0,0,0.25)',
    } as React.CSSProperties;
  };

  useEffect(() => {
    if (!isResizingCollectionPopout) return;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = resizeStartXRef.current - event.clientX;
      const nextWidth = Math.min(Math.max(resizeStartWidthRef.current + delta, 320), 640);
      setCollectionPopoutWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingCollectionPopout(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingCollectionPopout]);

  const collectionTheme = collectionThemes[collectionThemeIndex % collectionThemes.length];
  const collectionButtonStyle: React.CSSProperties = buildCollectionButtonStyle(showCollectionPopout, collectionButtonHover, 'primary');
  const collectionToolbarStyle: React.CSSProperties = buildCollectionButtonStyle(showCollectionPopout, collectionToolbarHover, 'toolbar');

  useEffect(() => {
    if (!showCollectionPopout) {
      setIsResizingCollectionPopout(false);
    }
  }, [showCollectionPopout]);

  // Handle text selection for collection gripper
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 10) {
        const text = selection.toString().trim();
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setGripperState({
          show: true,
          text,
          position: { x: rect.right + 10, y: rect.top }
        });
      } else if (gripperState.show) {
        // Close gripper if selection cleared
        setTimeout(() => {
          if (!window.getSelection()?.toString().trim()) {
            setGripperState(prev => ({ ...prev, show: false }));
          }
        }, 100);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [gripperState.show]);

  return (
    <CollectionProvider plugin={plugin}>
    {showLoadingScreen && (
      <LoadingScreen
        steps={loadingSteps}
        currentStep={loadingSteps.find(s => s.status === 'loading')?.name}
        overallProgress={loadingSteps.length > 0 
          ? (loadingSteps.filter(s => s.status === 'complete').length / loadingSteps.length) * 100 
          : undefined}
        error={error || undefined}
        showDevInfo={showDevInfo}
      />
    )}
    <div ref={rootRef} className="aip-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0, padding: 0 }}>
      {/* Database Warning Banner */}
      {dbExists === false && (
        <div className="aip-banner aip-banner-warning" style={{padding: '10px', background: 'var(--background-modifier-error)', color: 'var(--text-on-accent)', textAlign: 'center'}}>
          <strong>⚠️ Database not found</strong> — Click "Select Database…" to configure the database path. Current: {plugin.settings.pythonPipeline?.dbPath || 'not configured'}
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
      <header className={`aip-header ${pinHeader ? "is-sticky" : ""}`} style={{ padding: '6px 8px', marginBottom: '4px' }}>
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
            {/* Dev Tools Toggle */}
            <button
              className="aihp-btn"
              onClick={() => setShowDevInfo(!showDevInfo)}
              title="Toggle developer info in loading screen (F12 for full DevTools)"
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                opacity: showDevInfo ? 1 : 0.6
              }}
            >
              {showDevInfo ? '🔧 Dev' : '⚙️'}
            </button>
            
            <button
              className="aihp-btn"
              onClick={async () => {
                const leaf = plugin.app.workspace.openPopoutLeaf();
                await leaf.setViewState({ type: VIEW_TYPE, active: true });
                new Notice('Opened in popout window');
              }}
              title="Open in popout window (full screen)"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              🔲 Popout
            </button>
            
            <button 
              className="aihp-btn" 
              onClick={() => {
                // Open Database Manager modal
                setShowDatabaseManager(true);
              }}
              title={`Current database: ${plugin.settings.pythonPipeline?.dbPath || 'not configured'}\nClick to manage databases and imports`}
            >
              {plugin.settings.pythonPipeline?.dbPath 
                ? `📁 ${plugin.settings.pythonPipeline.dbPath.split(/[\\/]/).pop() || 'Database'}`
                : 'Database Manager…'}
            </button>
            
            <button 
              className="aihp-btn" 
              onClick={refreshFromDB}
              disabled={isImporting || messagesLoading}
              title="Refresh UI from current database"
            >
              {messagesLoading ? 'Loading...' : 'Refresh from DB'}
            </button>
            
            <button 
              className="aihp-btn" 
              onClick={syncFromBackups}
              disabled={isImporting}
              title="Sync conversations from backup folders (runs Python import script)"
            >
              {isImporting && status === "loading" ? 'Syncing...' : 'Sync from Backups'}
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
              title="Export database to Markdown files in vault (runs Python export script)\n\nExport Formats Available:\n• Markdown (.md) - Full conversation export\n• JSON (.json) - Structured data export (via Export Search Results)\n• Graph - Lightweight edge links"
            >
              {isImporting && status === "loading" ? 'Exporting...' : 'Export to Markdown'}
            </button>

            {/* Search Bar - In header center with history */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <SearchWithHistory
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={(query) => {
                  setSearchQuery(query);
                  refreshFromDB(query);
                }}
                placeholder={selfCheckResult?.fullTextSearch?.enabled 
                  ? "🔍 Search messages (FTS5 indexed)… (prefix with / for regex)" 
                  : "🔍 Search messages… (prefix with / for regex)"}
                maxHistory={75}
                showSuggestions={true}
                accentTheme={collectionTheme}
                trendingLimit={5}
                onSaveSearch={(query) => {
                  // Save search to a new collection
                  const newCollection = {
                    id: `search_${Date.now()}`,
                    label: `Search: ${query.substring(0, 30)}${query.length > 30 ? '...' : ''}`,
                    content: `# Saved Search\n\n**Query:** ${query}\n\n**Saved:** ${new Date().toLocaleString()}\n\n---\n\n*Use this collection to track results for this search query.*`,
                    createdAt: Date.now(),
                    itemCount: 0,
                    color: undefined,
                    tags: [],
                    summary: '',
                    tableOfContents: '',
                    enrichedAt: undefined,
                    enrichModel: undefined,
                    enrichDuration: undefined,
                    generatedTitle: undefined,
                    savedVersions: []
                  };
                  setCollections(prev => [...prev, newCollection]);
                  setActiveCollectionId(newCollection.id);
                  new Notice(`Search saved to collection: ${newCollection.label}`);
                }}
                collections={collections.map(c => ({ id: c.id, label: c.label }))}
              />
              {searchQuery && searchQuery.trim() && (
            <button 
                  onClick={async () => {
                    try {
                      setStatus("Exporting search results...");
                      const dbPath = plugin.settings.databasePath || plugin.settings.sources[0]?.databasePath;
                      if (!dbPath) {
                        throw new Error("No database path configured");
                      }
                      const outputPath = await exportSearchResults(
                        plugin.app,
                        dbPath,
                        searchQuery,
                        { format: "markdown", includeContext: true }
                      );
                      setStatus("ready");
                      new Notice(`✓ Exported to: ${outputPath}`);
                      // Open the exported file
                      const file = plugin.app.vault.getAbstractFileByPath(outputPath);
                      if (file && file instanceof TFile) {
                        await plugin.app.workspace.openLinkText(outputPath, '', true);
                      }
                    } catch (error: any) {
                      console.error("Export failed:", error);
                      setError(`Export failed: ${error.message}`);
                      setStatus("ready");
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    background: 'var(--interactive-normal)',
                    border: '1px solid var(--background-modifier-border)',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                  title="Export search results to markdown file for AI analysis"
                >
                  📥 Export
            </button>
              )}
              {selfCheckResult?.fullTextSearch?.enabled && (
                <span style={{ 
                  fontSize: '11px', 
                  opacity: 0.7, 
                  whiteSpace: 'nowrap',
                  padding: '4px 8px',
                  background: 'var(--background-modifier-hover)',
                  borderRadius: '4px'
                }}>
                  FTS5: {selfCheckResult.fullTextSearch.count.toLocaleString()} indexed
                </span>
              )}
            </div>

          </div>

          {/* RIGHT: Header actions */}
          <div className="aip-header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setShowCollectionPopout(prev => !prev)}
              onMouseEnter={() => setCollectionButtonHover(true)}
              onMouseLeave={() => setCollectionButtonHover(false)}
              style={buildCollectionButtonStyle(showCollectionPopout, collectionButtonHover, 'primary')}
              title={showCollectionPopout ? "Hide collections panel" : "Show collections panel"}
            >
              <span>{collectionTheme.emoji}</span>
              <span>Collections LOCAL</span>
              <span style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '999px',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                lineHeight: 1.2
              }}>
                {usingDatabase ? 'DB' : 'LOCAL'}
              </span>
            </button>
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
              <span>New view</span>
            </label>
            <label className="aip-toggle">
              <input
                type="checkbox"
                checked={pinHeader}
                onChange={(e) => setPinHeader(e.target.checked)}
              />
              <span>Pin header</span>
            </label>
            <label className="aip-toggle">
              <input
                type="checkbox"
                checked={isMultiSelectMode}
                onChange={(e) => {
                  setIsMultiSelectMode(e.target.checked);
                  if (!e.target.checked) {
                    // Clear multi-select when disabling
                    setSelectedConversations(new Set());
                    setLastSelectedIndex(null);
                  }
                }}
              />
              <span>Multi-select</span>
            </label>
          </div>
          
          {/* Bulk Actions Toolbar - shown when multi-select is active */}
          {isMultiSelectMode && selectedConversations.size > 0 && (
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              padding: '6px 12px',
              backgroundColor: 'var(--aihp-bg-modifier)',
              borderRadius: '6px',
              marginTop: '8px',
              border: '1px solid var(--aihp-accent)'
            }}>
              <span style={{ fontSize: '12px', fontWeight: '600', marginRight: '8px' }}>
                {selectedConversations.size} selected
              </span>
              <button
                className="aip-btn"
                onClick={() => {
                  // TODO: Implement Add to Project
                  console.log("Add to Project:", Array.from(selectedConversations));
                  new Notice(`Add ${selectedConversations.size} conversations to project (coming soon)`);
                }}
                title="Add selected conversations to a project"
              >
                Add to Project
              </button>
              <button
                className="aip-btn"
                onClick={() => {
                  // TODO: Implement New Project from Selection
                  console.log("New Project from Selection:", Array.from(selectedConversations));
                  new Notice(`Create project from ${selectedConversations.size} conversations (coming soon)`);
                }}
                title="Create a new project from selected conversations"
              >
                New Project
              </button>
              <button
                className="aip-btn"
                onClick={() => {
                  // TODO: Implement Export Selection
                  console.log("Export Selection:", Array.from(selectedConversations));
                  new Notice(`Export ${selectedConversations.size} conversations (coming soon)`);
                }}
                title="Export selected conversations"
              >
                Export
              </button>
            </div>
          )}
        </div>

        {/* Source Manager Row */}
        {/* Sources row minimized to gain vertical space */}
        <div className="aip-sources-row" style={{ display: 'none' }}>
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
      <div className="aip-body" style={{ display: 'grid', gridTemplateRows: '1fr', gridTemplateColumns: showCollectionPopout ? `var(--aip-col-left, 320px) 1fr ${collectionPopoutWidth}px` : `var(--aip-col-left, 320px) 1fr 0px`, gap: '0px', overflow: 'hidden', height: '100%', minHeight: 0, flex: 1, padding: 0, marginTop: 0, marginRight: showCollectionPopout ? `${collectionPopoutWidth}px` : '0px' }}>
        {/* Left Pane: Conversation List */}
        <section className="aip-pane aip-conversations-middle" style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          minHeight: 0
        }}>
          <div className="aip-pane-header">
            <div className="aip-pane-header-top">
              <span>Conversations ({groupedByConversation.length.toLocaleString()})</span>
              {hasTree && (
                <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '8px' }}>
                  • Tree structure available
                </span>
              )}
            </div>
          </div>
          
          <LoadingOverlay isLoading={messagesLoading} text="Loading conversations...">
            <ConversationsList
                  conversations={pagedConversations}
              selectedConversations={isMultiSelectMode ? selectedConversations : (selectedConvKey ? new Set([selectedConvKey]) : new Set())}
              isMultiSelectMode={isMultiSelectMode}
              onSelectConversation={(convId, index, shiftKey) => handleConvClick(convId, index, shiftKey)}
              onToggleConversation={(convId, index, shiftKey) => handleConvClick(convId, index, shiftKey)}
              isLoading={messagesLoading}
              treeNodes={hasTree ? treeNodes : []}
              onNavigateToBranch={(convId: string, branchNodeId: string) => {
                // First select the conversation if not already selected
                if (convId !== selectedConvKey) {
                  handleConvClick(convId);
                }
                
                // Then navigate to the branch
                if (branchNodeId && branchNodeId !== '') {
                  navigateToBranch(branchNodeId);
                } else {
                  // Clear branch view
                  setSelectedBranchPath([]);
                }
              }}
              selectedBranchPath={selectedBranchPath}
              onTagClick={(tag: string) => {
                setActiveTagFilter(tag);
                setActiveViewTab('tagged');
              }}
              onAttachmentClick={async (convId: string) => {
                // Select conversation if not already selected
                if (convId !== selectedConvKey) {
                  handleConvClick(convId);
                }
                
                // Load attachments for this conversation
                setAttachmentsLoading(true);
                try {
                  const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
                  const dbPath = resolveVaultPath(plugin.settings.pythonPipeline?.dbPath || '', vaultBasePath);
                  const path = require("path");
                  const queryScriptPath = path.join(
                    plugin.settings.pythonPipeline?.scriptsRoot || vaultBasePath,
                    'tools',
                    'query_attachments.py'
                  );
                  
                  const { spawn } = require("child_process");
                  const proc = spawn(
                    plugin.settings.pythonPipeline?.pythonExecutable || 'python',
                    [queryScriptPath, dbPath, convId],
                    { shell: false, cwd: plugin.settings.pythonPipeline?.scriptsRoot || vaultBasePath }
                  );
                  
                  let stdout = '';
                  proc.stdout.on('data', (data: Buffer) => {
                    stdout += data.toString();
                  });
                  
                  await new Promise<void>((resolve, reject) => {
                    proc.on('close', (code: number) => {
                      if (code === 0) {
                        try {
                          const attachments = JSON.parse(stdout);
                          setConversationAttachments(attachments);
                          setAttachmentFilter('has'); // Filter to messages with attachments
                          setActiveViewTab('conversation');
                          new Notice(`Found ${attachments.length} attachment(s). Filtering messages...`);
                        } catch (e: any) {
                          console.error("Failed to parse attachments:", e);
                          new Notice("Failed to load attachments");
                        }
                        resolve();
                      } else {
                        reject(new Error(`Query script exited with code ${code}`));
                      }
                    });
                    proc.on('error', (error: any) => {
                      reject(error);
                    });
                  });
                } catch (error: any) {
                  console.error("Failed to query attachments:", error);
                  new Notice(`Failed to load attachments: ${error.message}`);
                } finally {
                  setAttachmentsLoading(false);
                }
              }}
            />
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
            {/* Consolidated Message Toolbar - Single unified bar */}
            {(activeTagFilter || selectedConvKey) && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderBottom: '1px solid var(--background-modifier-border)',
                backgroundColor: 'var(--background-secondary)',
                flexWrap: 'wrap'
              }}>
                {/* Submenu Area - Conversation Info */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginRight: 'auto' }}>
                  {selectedConvKey && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      marginRight: '12px',
                      paddingRight: '12px',
                      borderRight: '1px solid var(--background-modifier-border)'
                    }}>
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>
                        {selectedConvMessages[0]?.title || "(untitled)"}
                      </span>
                      <span style={{ fontSize: '11px', opacity: 0.7 }}>
                        {selectedConvMessages.length} messages
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setActiveViewTab('conversation');
                      if (!selectedConvKey) {
                        setActiveTagFilter(null);
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      fontWeight: activeViewTab === 'conversation' ? '600' : '400',
                      border: 'none',
                      borderRadius: '4px',
                      background: activeViewTab === 'conversation' 
                        ? 'var(--background-modifier-hover)' 
                        : 'transparent',
                      color: activeViewTab === 'conversation' 
                        ? 'var(--text-normal)' 
                        : 'var(--text-muted)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Messages
                  </button>
                  
                  {/* Attachments Tab */}
                  {selectedConvKey && conversationAttachments.length > 0 && (
                    <button
                      onClick={() => {
                        setActiveViewTab('attachments');
                        setShowAttachmentGallery(true);
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        fontWeight: activeViewTab === 'attachments' ? '600' : '400',
                        border: 'none',
                        borderRadius: '4px',
                        background: activeViewTab === 'attachments' 
                          ? 'var(--background-modifier-hover)' 
                          : 'transparent',
                        color: activeViewTab === 'attachments' 
                          ? 'var(--text-normal)' 
                          : 'var(--text-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      📎 Attachments ({conversationAttachments.length})
                    </button>
                  )}
                  
                  {/* Attachment Filter Badge */}
                  {attachmentFilter !== 'all' && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 8px',
                      backgroundColor: 'var(--aihp-accent)',
                      color: 'var(--text-on-accent)',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}>
                      <span>
                        {attachmentFilter === 'has' && '📎 Has attachments'}
                        {attachmentFilter === 'missing' && '⚠️ Missing attachments'}
                        {attachmentFilter === 'remote' && '🌐 Remote attachments'}
                      </span>
                      <button
                        onClick={() => {
                          setAttachmentFilter('all');
                          setConversationAttachments([]);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '12px'
                        }}
                        title="Clear attachment filter"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  
                  {/* Message Selection Mode Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isMessageSelectMode}
                      onChange={(e) => {
                        setIsMessageSelectMode(e.target.checked);
                        if (!e.target.checked) {
                          setSelectedMessages(new Set());
                          setSelectedTextSelections(new Map());
                        }
                      }}
                    />
                    <span style={{ fontSize: '12px' }}>Select Messages</span>
                  </label>
                  
                  {/* Add Selected Messages to Collection */}
                  {isMessageSelectMode && selectedMessages.size > 0 && collections.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
                      <select
                        onChange={(e) => {
                          const collectionId = e.target.value;
                          if (collectionId) {
                            // Get selected messages text
                            const selectedTexts = Array.from(selectedMessages).map(msgId => {
                              const msg = selectedConvMessages.find(m => m.id === msgId);
                              if (msg) {
                                return `[${msg.role.toUpperCase()}] ${msg.text}`;
                              }
                              return null;
                            }).filter(Boolean).join('\n\n---\n\n');
                            
                            if (selectedTexts) {
                              addToCollection(collectionId, selectedTexts, true);
                              new Notice(`Added ${selectedMessages.size} message(s) to collection`);
                              setSelectedMessages(new Set());
                            }
                            e.target.value = '';
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          border: '1px solid var(--background-modifier-border)',
                          borderRadius: '4px',
                          background: 'var(--background-secondary)'
                        }}
                        defaultValue=""
                      >
                        <option value="">Add to Collection...</option>
                        {collections.map(coll => (
                          <option key={coll.id} value={coll.id}>{coll.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                {activeTagFilter && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setActiveViewTab('tagged')}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        fontWeight: activeViewTab === 'tagged' ? '600' : '400',
                        border: 'none',
                        borderRadius: '4px',
                        background: activeViewTab === 'tagged' 
                          ? 'var(--background-modifier-hover)' 
                          : 'transparent',
                        color: activeViewTab === 'tagged' 
                          ? 'var(--text-normal)' 
                          : 'var(--text-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>Tagged: {activeTagFilter.replace(/^batch:/, '')}</span>
                      <span style={{ opacity: 0.7 }}>
                        ({taggedMessages.length} messages, {taggedConversations.length} conversations)
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTagFilter(null);
                        setActiveViewTab('conversation');
                      }}
                      style={{
                        padding: '2px 6px',
                        fontSize: '11px',
                        border: 'none',
                        borderRadius: '3px',
                        background: 'var(--background-modifier-border)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        opacity: 0.7
                      }}
                      title="Clear tag filter"
                    >
                      ×
                    </button>
                  </div>
                )}
                </div>
              </div>
            )}

            {/* Tagged Messages View */}
            {activeViewTab === 'tagged' && activeTagFilter && (
              <div className="aihp-message-detail" style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
                    Conversations with tag: <span style={{ color: 'var(--text-accent)' }}>{activeTagFilter.replace(/^batch:/, '')}</span>
                  </h3>
                  <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '12px' }}>
                    Found {taggedConversations.length} conversation{taggedConversations.length !== 1 ? 's' : ''} with {taggedMessages.length} total message{taggedMessages.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {taggedConversations.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', opacity: 0.6 }}>
                    <p>No conversations found with this tag.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {taggedConversations.map(conv => {
                      const convMessages = taggedMessages.filter(m => m.conversationId === conv.convId);
                      return (
                        <div
                          key={conv.convId}
                          onClick={() => {
                            setActiveViewTab('conversation');
                            handleConvClick(conv.convId);
                          }}
                          style={{
                            padding: '12px',
                            border: '1px solid var(--background-modifier-border)',
                            borderRadius: '6px',
                            backgroundColor: 'var(--background-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
                            e.currentTarget.style.borderColor = 'var(--text-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                            e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
                          }}
                        >
                          <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>
                            {conv.title || '(untitled)'}
                          </div>
                          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                            {convMessages.length} message{convMessages.length !== 1 ? 's' : ''} • {conv.vendor}
                          </div>
                          {convMessages.slice(0, 2).map((msg, idx) => (
                            <div
                              key={msg.messageId}
                              style={{
                                fontSize: '12px',
                                padding: '6px',
                                marginTop: '4px',
                                backgroundColor: 'var(--background-primary)',
                                borderRadius: '4px',
                                opacity: 0.8,
                                maxHeight: '60px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              <span style={{ fontWeight: '600', opacity: 0.7 }}>{msg.role}:</span> {msg.text.substring(0, 100)}{msg.text.length > 100 ? '...' : ''}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tagged Messages View */}
            {activeViewTab === 'tagged' && activeTagFilter && (
              <div className="aihp-message-detail" style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
                    Conversations with tag: <span style={{ color: 'var(--text-accent)' }}>{activeTagFilter.replace(/^batch:/, '')}</span>
                  </h3>
                  <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '12px' }}>
                    Found {taggedConversations.length} conversation{taggedConversations.length !== 1 ? 's' : ''} with {taggedMessages.length} total message{taggedMessages.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {taggedConversations.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', opacity: 0.6 }}>
                    <p>No conversations found with this tag.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {taggedConversations.map(conv => {
                      const convMessages = taggedMessages.filter(m => m.conversationId === conv.convId);
                      return (
                        <div
                          key={conv.convId}
                          onClick={() => {
                            setActiveViewTab('conversation');
                            handleConvClick(conv.convId);
                          }}
                          style={{
                            padding: '12px',
                            border: '1px solid var(--background-modifier-border)',
                            borderRadius: '6px',
                            backgroundColor: 'var(--background-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
                            e.currentTarget.style.borderColor = 'var(--text-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                            e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
                          }}
                        >
                          <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>
                            {conv.title || '(untitled)'}
                          </div>
                          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                            {convMessages.length} message{convMessages.length !== 1 ? 's' : ''} • {conv.vendor}
                          </div>
                          {convMessages.slice(0, 2).map((msg, idx) => (
                            <div
                              key={msg.messageId}
                              style={{
                                fontSize: '12px',
                                padding: '6px',
                                marginTop: '4px',
                                backgroundColor: 'var(--background-primary)',
                                borderRadius: '4px',
                                opacity: 0.8,
                                maxHeight: '60px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              <span style={{ fontWeight: '600', opacity: 0.7 }}>{msg.role}:</span> {msg.text.substring(0, 100)}{msg.text.length > 100 ? '...' : ''}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Conversation View */}
            {activeViewTab === 'conversation' && selectedConvMessages.length === 0 && !selectedConvKey && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="text-lg font-medium mb-2">No conversation selected</h3>
                <p className="text-sm text-center max-w-sm">
                  Click on a conversation from the left to view its messages
                </p>
              </div>
            )}

            {activeViewTab === 'conversation' && selectedConvKey && (
            <div className="aihp-message-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
              {/* Branch navigation controls - only show if tree structure exists */}
                {hasTree && selectedConvKey && (() => {
                  const branchPoints = getBranchPointsForConversation(selectedConvKey);
                  if (branchPoints.length === 0) return null;
                  
                  return (
                    <div style={{ 
                      marginTop: '8px', 
                      padding: '8px', 
                      background: 'var(--aihp-bg-modifier)', 
                      borderRadius: '4px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      fontSize: '11px'
                    }}>
                      <span style={{ fontWeight: 'bold', marginRight: '4px' }}>Branches:</span>
                      {branchPoints.slice(0, 10).map((bp: any) => (
                        <button
                          key={bp.id}
                          onClick={() => navigateToBranch(bp.id)}
                          style={{
                            padding: '4px 8px',
                            border: selectedBranchPath.includes(bp.id) 
                              ? '1px solid var(--aihp-accent)' 
                              : '1px solid var(--aihp-bg-modifier)',
                            borderRadius: '4px',
                            background: selectedBranchPath.includes(bp.id)
                              ? 'rgba(139, 208, 255, 0.15)'
                              : 'var(--aihp-bg-secondary)',
                            cursor: 'pointer',
                            fontSize: '10px'
                          }}
                        >
                          Branch at depth {bp.depth}
                        </button>
                      ))}
                      {branchPoints.length > 10 && (
                        <span style={{ opacity: 0.7 }}>+{branchPoints.length - 10} more</span>
                      )}
                    </div>
                  );
                })()}
              
              {pagedConvTurns.map(turn => (
                <div key={turn.id} className="aihp-turn">
                  <div className="aihp-turn-header">
                    <span className={`aihp-role aihp-role-${turn.role}`}>{turn.role.toUpperCase()}</span>
                    <span className="aihp-vendor aihp-vendor-chatgpt">{turn.vendor}</span>
                    <span className="aihp-turn-time">
                      {turn.tsStart && turn.tsStart > 946684800
                        ? `${new Date(turn.tsStart * 1000).toLocaleString()} – ${turn.tsEnd && turn.tsEnd > 946684800 ? new Date(turn.tsEnd * 1000).toLocaleTimeString() : 'Invalid date'}`
                        : 'Date unavailable'}
                    </span>
                  </div>
                  <div className="aihp-turn-messages">
                    {turn.items.map(msg => {
                      const isSelected = selectedMessages.has(msg.id);
                      return (
                        <div 
                          key={msg.id} 
                          className="aihp-message" 
                          data-role={msg.role}
                          onMouseDown={(e) => {
                            // If clicking on checkbox area, don't handle
                            if ((e.target as HTMLElement).tagName === 'INPUT' || 
                                (e.target as HTMLElement).closest('input[type="checkbox"]')) {
                              return;
                            }
                            // If user is selecting text, don't interfere
                            const selection = window.getSelection();
                            if (selection && selection.toString().length > 0) {
                              // User is selecting text, don't interfere
                              return;
                            }
                            // Only handle click if not in text selection mode
                            // Check if the click is on text content (not on interactive elements)
                            const target = e.target as HTMLElement;
                            if (target.tagName === 'CODE' || target.tagName === 'PRE' || 
                                target.closest('code') || target.closest('pre') ||
                                target.closest('.aihp-message-text') || target.closest('.aihp-message-content')) {
                              // User clicked on text content, allow text selection
                              return;
                            }
                            if (!isMessageSelectMode && e.detail === 1) {
                              // Single click - select message (only if not clicking on text)
                              setSelectedMessage(msg as any);
                            }
                          }}
                          onMouseUp={(e) => {
                            // Handle text selection - only if not in select mode
                            if (!isMessageSelectMode) {
                              setTimeout(() => {
                                const selection = window.getSelection();
                                if (selection && selection.toString().trim().length > 0) {
                                  const selectedText = selection.toString();
                                  setSelectedTextSelections(prev => {
                                    const next = new Map(prev);
                                    next.set(msg.id, selectedText);
                                    return next;
                                  });
                                  // Copy to clipboard automatically
                                  navigator.clipboard.writeText(selectedText).catch(console.error);
                                }
                              }, 10);
                            }
                          }}
                          style={{
                            padding: '12px 16px',
                            marginBottom: '12px',
                            borderRadius: '8px',
                            lineHeight: '1.6',
                            position: 'relative',
                            border: isSelected ? '2px solid var(--aihp-accent)' : undefined,
                            backgroundColor: isSelected ? 'rgba(139, 208, 255, 0.1)' : undefined,
                            cursor: 'text',
                            userSelect: 'text',
                            WebkitUserSelect: 'text',
                            MozUserSelect: 'text',
                            msUserSelect: 'text'
                          }}
                        >
                          {isMessageSelectMode && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                setSelectedMessages(prev => {
                                  const next = new Set(prev);
                                  if (next.has(msg.id)) {
                                    next.delete(msg.id);
                                  } else {
                                    next.add(msg.id);
                                  }
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                top: '8px',
                                left: '8px',
                                zIndex: 10,
                                cursor: 'pointer',
                                width: '18px',
                                height: '18px'
                              }}
                            />
                          )}
                          <div style={{
                            marginLeft: isMessageSelectMode ? '28px' : '0',
                            userSelect: 'text',
                            WebkitUserSelect: 'text',
                            MozUserSelect: 'text',
                            msUserSelect: 'text'
                          }}>
                        <MessageContent
                          text={msg.text}
                          toolName={undefined}
                          toolPayload={null}
                          query={debouncedQuery}
                          useRegex={facets.regex}
                          highlightText={highlightText}
                              app={plugin.app}
                        />
                          </div>
                        <div className="aihp-message-meta">
                          {msg.ts && msg.ts > 946684800 
                            ? new Date(msg.ts * 1000).toLocaleString()
                            : 'Date unavailable'}
                        </div>
                      </div>
                      );
                    })}
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

            {/* Attachments Gallery View */}
            {activeViewTab === 'attachments' && selectedConvKey && conversationAttachments.length > 0 && (
              <div className="aihp-message-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <AttachmentGallery
                  attachments={conversationAttachments}
                  vaultBasePath={(plugin.app.vault.adapter as any).basePath || ''}
                  onClose={() => {
                    setActiveViewTab('conversation');
                    setShowAttachmentGallery(false);
                  }}
                />
              </div>
            )}

            {/* Attachment Viewer Modal */}
            {selectedAttachment && (
              <AttachmentViewer
                attachment={selectedAttachment}
                onClose={() => setSelectedAttachment(null)}
                vaultBasePath={(plugin.app.vault.adapter as any).basePath || ''}
              />
            )}
          </LoadingOverlay>
        </section>

        {/* Collections Panel - RIGHT SIDE (toggleable, full height, extends to top) */}
        {showCollectionPopout && (
        <aside 
          className="aip-pane aip-collections-right" 
          style={{ 
            width: `${collectionPopoutWidth}px`, 
            borderLeft: '1px solid var(--background-modifier-border)',
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            minHeight: '100vh',
            maxHeight: '100vh',
            overflow: 'hidden',
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: 'var(--background-primary)',
            zIndex: 100,
            marginTop: 0,
            paddingTop: 0
          }}
        >
          <CollectionPanel onCollectionUpdate={setCollections} plugin={plugin} />
          <div 
            className="aip-resize-handle" 
            onMouseDown={(e) => {
              setIsResizingCollectionPopout(true);
              resizeStartXRef.current = e.clientX;
              resizeStartWidthRef.current = collectionPopoutWidth;
              e.preventDefault();
            }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '4px',
              cursor: 'col-resize',
              backgroundColor: 'transparent',
              zIndex: 10,
              pointerEvents: 'auto'
            }}
          />
        </aside>
        )}

        {/* Right Pane: Filters & Stats (temporarily removed for more space) */}
        {false && (
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

            {/* Selected Conversation Stats */}
            {selectedConvKey ? (
              <>
                <h4>Selected Conversation</h4>
                <div className="aip-stats" style={{ backgroundColor: 'var(--aihp-bg-modifier)', padding: '8px', borderRadius: '4px', border: '1px solid var(--aihp-accent)' }}>
                  <div style={{ color: 'var(--aihp-accent)', fontWeight: 'bold', fontSize: '14px' }}>
                    {selectedConvMessages[0]?.title || "(untitled)"}
                  </div>
                  <div>Messages: {selectedConvMessages.length.toLocaleString()}</div>
                  <div>Turns: {selectedConvTurns.length.toLocaleString()}</div>
                  <div>Page: {msgPage} / {msgPageCount}</div>
                  {hasTree && selectedConvKey && (() => {
                    const convNodes = getTreeNodesForConversation(selectedConvKey);
                    const branchPoints = getBranchPointsForConversation(selectedConvKey);
                    const rootNodes = convNodes.filter((n: any) => n.is_root === 1);
                    const maxDepth = convNodes.length > 0 
                      ? Math.max(...convNodes.map((n: any) => n.depth || 0))
                      : 0;
                    const avgDepth = convNodes.length > 0
                      ? (convNodes.reduce((sum: number, n: any) => sum + (n.depth || 0), 0) / convNodes.length).toFixed(1)
                      : 0;
                    
                    return (
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--aihp-bg-modifier)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>Tree Structure:</div>
                        <div style={{ fontSize: '11px' }}>Nodes: {convNodes.length.toLocaleString()}</div>
                        <div style={{ fontSize: '11px' }}>Roots: {rootNodes.length.toLocaleString()}</div>
                        <div style={{ fontSize: '11px' }}>Branches: {branchPoints.length.toLocaleString()}</div>
                        <div style={{ fontSize: '11px' }}>Max depth: {maxDepth}</div>
                        <div style={{ fontSize: '11px' }}>Avg depth: {avgDepth}</div>
                        {selectedBranchPath.length > 0 && (
                          <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
                            Branch view: {selectedBranchPath.length} nodes
                    </div>
                  )}
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0 }}>Vendor Breakdown</h4>
              <button 
                onClick={() => setVendorMode(vendorMode === 'folder' ? 'company' : 'folder')}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  border: '1px solid var(--aihp-bg-modifier)',
                  borderRadius: '4px',
                  background: 'var(--aihp-bg-secondary)',
                  color: 'var(--aihp-text)',
                  cursor: 'pointer'
                }}
              >
                {vendorMode === 'folder' ? 'Show Companies' : 'Show Source Folders'}
              </button>
            </div>
            <div className="aip-vendor-stats">
              {Object.entries(
                filteredMessages.reduce((acc: Record<string, number>, msg: any) => {
                  if (vendorMode === 'company') {
                    // Company vendor mode
                    const valid = new Set(['CHATGPT','CLAUDE','GEMINI','GROK']);
                    const v = (msg.vendor||'').toUpperCase();
                    const key = valid.has(v) ? v : 'CHATGPT';
                    acc[key] = (acc[key]||0)+1;
                  } else {
                    // Folder mode: lookup folder_path from groupedByConversation
                    const conv = groupedByConversation.find(g => g.convId === msg.conversationId);
                    const fp = (conv?.folder_path || msg.folder_path || msg.source_file || '').toString();
                    const parts = fp.split(/[\\/]/).filter(Boolean);
                    const tail = parts.slice(-1)[0] || 'unknown';
                    acc[tail] = (acc[tail]||0)+1;
                  }
                  return acc;
                }, {} as Record<string, number>)
              )
              .sort(([, a], [, b]) => b - a) // Sort by count descending
              .slice(0, 20) // Limit to top 20
              .map(([key, count]) => {
                if (vendorMode === 'company') {
                  // Map vendor codes to user-friendly names
                  const vendorUpper = key.toUpperCase();
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
                      key={key} 
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
                } else {
                  // Folder mode: show folder name, clickable to filter
                  return (
                    <div 
                      key={key} 
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
                        border: '1px solid transparent'
                      }}
                      onClick={() => {
                        // TODO: Add folder-based filtering if needed
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      }}
                      title={`Folder: ${key}`}
                    >
                      <span className="aip-vendor-name">{key}</span>
                      <span className="aip-vendor-count">{count.toLocaleString()}</span>
                    </div>
                  );
                }
              })}
            </div>


          </div>
        </aside>
        )}
      </div>
      )}
      
      {/* Database Manager Modal */}
      {showDatabaseManager && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }} onClick={() => setShowDatabaseManager(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            backgroundColor: 'var(--background-primary)',
            borderRadius: '8px',
            maxWidth: '900px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            width: '100%'
          }}>
            <DatabaseManager
              plugin={plugin}
              app={plugin.app}
              onClose={() => {
                setShowDatabaseManager(false);
                // Refresh after import
                refreshFromDB();
              }}
            />
          </div>
      </div>
      )}
    </div>
      
      {/* Collection Gripper - Floating button for text selection */}
      {gripperState.show && (
        <CollectionGripper
          text={gripperState.text}
          collections={collections.map(c => ({ id: c.id, label: c.label, color: c.color }))}
          onAddToCollection={(collectionId, text) => {
            addToCollection(collectionId, text, true);
            setGripperState({ show: false, text: '', position: { x: 0, y: 0 } });
          }}
          position={gripperState.position}
          onClose={() => setGripperState({ show: false, text: '', position: { x: 0, y: 0 } })}
        />
      )}
    </CollectionProvider>
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