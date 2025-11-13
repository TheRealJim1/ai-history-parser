
export type Role = "system" | "user" | "assistant" | "tool" | string;
export type Vendor = 'chatgpt' | 'grok' | 'claude' | 'gemini';
export type MergeMode = 'separate' | 'chronological' | 'linkOnly';
export type Theme = 'auto' | 'dark' | 'light';

export interface Source {
  id: string;                 // 'chatgpt-2025' (user label)
  vendor: Vendor;             // 'chatgpt'
  root: string;               // vault-relative path
  addedAt: number;
  color?: string;
  label?: string;             // Human-friendly label, e.g., "ChatGPT 2025-02-08"
}

export interface FlatMessage {
  uid: string;                // stable (see makeStableId)
  vendor: Vendor;
  sourceId: string;           // which source/folder
  conversationId: string;
  messageId?: string;
  role: 'user'|'assistant'|'tool'|'system';
  createdAt: number;          // ms
  title?: string;             // conv title (repeated)
  text: string;
}

export interface TestModeSettings {
  enabled: boolean;             // Default: false
  stagingFolder: string;        // Default: "AI-Staging" (vault-relative)
  ingestLimits: {
    maxSources: number;        // Default: 1
    maxFiles: number;          // Default: 20
    maxConversations: number;  // Default: 25
    sinceDays?: number;        // Optional: 90 (fast slice)
  };
  annotationLimit: number;     // Default: 20 conversations
  autoRebuildOmnisearch: boolean; // Default: false (while testing)
}

export interface PythonPipelineSettings {
  // Database
  dbPath: string;              // Default: C:\Dev\ai-history-parser\ai_history.db (supports <vault> token)
  
  // Python & Scripts
  pythonExecutable: string;     // Default: "python"
  scriptsRoot: string;          // Default: C:\Dev\ai-history-parser
  
  // Media & Output
  mediaSourceFolder: string;    // Default: C:\Dev\ai-history-parser\media
  outputFolder: string;         // Default: "AI-History" (vault-relative)
  stagingFolder?: string;       // Optional: "AI-Staging" (excluded from Omnisearch)
  
  // AI Annotation
  aiAnnotation: {
    enabled: boolean;           // Default: false
    backend: 'ollama' | 'openai';
    url: string;                // Default: http://127.0.0.1:11434 (Ollama)
    model: string;              // Default: llama3.2:3b-instruct
    batchSize: number;          // Default: 100
    maxChars: number;           // Default: 8000
    autoAnnotate: boolean;      // Default: false
  };
  
  // Export Settings
  exportSettings: {
    chunkSize: number;         // Default: 20000
    overlap: number;           // Default: 500
    linkCloud: boolean;        // Default: true
    addHashtags: boolean;      // Default: true
  };
  
  // Test Mode
  testMode?: TestModeSettings;
  
  // LM Studio / Ollama Configuration
  lmStudio?: {
    url: string;                // LM Studio URL - Default: http://localhost:1234
    ollamaUrl?: string;          // Ollama URL - Default: http://localhost:11434
    visionModel: string;        // Model ID for vision tasks
    visionBackend?: 'lmstudio' | 'ollama'; // Backend for vision - Default: 'lmstudio'
    visionEnabled: boolean;     // Enable vision model
    embeddingsModel: string;    // Model ID for text embeddings
    embeddingsBackend?: 'lmstudio' | 'ollama'; // Backend for embeddings - Default: 'lmstudio'
    embeddingsEnabled: boolean; // Enable embeddings model
    chatModel: string;          // Model ID for chat tasks
    chatBackend?: 'lmstudio' | 'ollama'; // Backend for chat - Default: 'lmstudio'
    chatEnabled: boolean;       // Enable chat model
  };
}

export interface ConversationAnnotation {
  conversation_id: string;
  summary: string | null;
  tags: string[];
  topics: string[];
  entities: Record<string, string[]>;
  dates: string[];
  sentiment: string | null;
  risk_flags: string[];
  actions: string[];
  updated_at: string | null;
}

export interface ParserSettings {
  sources: Source[];             // Repurposed: just stores folder paths for Sync
  lastActiveSourceIds: string[]; // order matters
  mergeMode: MergeMode;
  paneSizes: [number, number];   // left/right percent
  theme: Theme;
  accent?: string;
  lastQuery?: string;
  // Legacy support
  exportFolder: string;
  recentFolders: string[];
  // NEW: Python Pipeline
  pythonPipeline?: PythonPipelineSettings;
}

export interface MessageLite {
  id?: string;
  role: Role;
  text: string;
  create_time?: number;
}

export interface ConversationLite {
  id: string;
  title: string;
  create_time?: number;
  update_time?: number;
  source: "conversations.json" | "shared_conversations.json";
  messages: MessageLite[];
}

export interface ExportIndex {
  conversations: ConversationLite[];
  stats: { convCount: number; msgCount: number };
}

export interface ParseError {
  type: 'file_not_found' | 'invalid_json' | 'missing_data' | 'permission_denied';
  message: string;
  path?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface SearchFacets {
  vendor: Vendor | 'all';
  role: Role | 'any';
  from?: string;  // YYYY-MM-DD
  to?: string;    // YYYY-MM-DD
  titleBody: boolean;
  regex: boolean;
}

export interface SearchProgress {
  isSearching: boolean;
  progress: number;
  total: number;
  current: number;
}

// Legacy types for backward compatibility
export type SettingsData = {
  exportFolder: string;
  dbPath: string;
};

export type Msg = { role: string; t: number; text: string };
export type Conv = { id: string; title: string; last: number; msgs: Msg[]; source?: string; blob?: string };
