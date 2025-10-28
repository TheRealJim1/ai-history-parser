
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

export interface ParserSettings {
  sources: Source[];             // multi-folder
  lastActiveSourceIds: string[]; // order matters
  mergeMode: MergeMode;
  paneSizes: [number, number];   // left/right percent
  theme: Theme;
  accent?: string;
  lastQuery?: string;
  // Legacy support
  exportFolder: string;
  recentFolders: string[];
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
