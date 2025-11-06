import type { ParserSettings, Vendor } from "./types";

export const DEFAULT_SETTINGS: ParserSettings = {
  sources: [],
  lastActiveSourceIds: [],
  mergeMode: 'separate',
  paneSizes: [32, 68],
  theme: 'auto',
  accent: '#8bd0ff',
  lastQuery: '',
  // Legacy support
  exportFolder: "",
  recentFolders: [],
  // Python Pipeline defaults
  pythonPipeline: {
    dbPath: "C:\\Dev\\ai-history-parser\\chatgpt_clean.db",
    pythonExecutable: "python",
    scriptsRoot: "C:\\Dev\\ai-history-parser",
    mediaSourceFolder: "C:\\Dev\\ai-history-parser\\media",
    outputFolder: "AI-History",
    stagingFolder: "AI-Staging",
    aiAnnotation: {
      enabled: false,
      backend: 'ollama',
      url: "http://127.0.0.1:11434",
      model: "llama3.2:3b-instruct",
      batchSize: 100,
      maxChars: 8000,
      autoAnnotate: false,
    },
    exportSettings: {
      chunkSize: 20000,
      overlap: 500,
      linkCloud: true,
      addHashtags: true,
    },
    testMode: {
      enabled: false,
      stagingFolder: "AI-Staging",
      ingestLimits: {
        maxSources: 1,
        maxFiles: 20,
        maxConversations: 25,
        sinceDays: 90,
      },
      annotationLimit: 20,
      autoRebuildOmnisearch: false,
    },
  },
};

export function validateFolderPath(path: string): { isValid: boolean; error?: string } {
  if (!path || path.trim() === "") {
    return { isValid: false, error: "Folder path cannot be empty" };
  }
  
  // Check for dangerous path patterns
  if (path.includes("..") || path.includes("~") || path.startsWith("/")) {
    return { isValid: false, error: "Invalid folder path - use vault-relative paths only" };
  }
  
  // Check for valid characters
  if (!/^[a-zA-Z0-9\-_/]+$/.test(path)) {
    return { isValid: false, error: "Folder path contains invalid characters" };
  }
  
  return { isValid: true };
}

export function sanitizeFolderPath(path: string): string {
  return path
    .trim()
    .replace(/[^a-zA-Z0-9\-_/]/g, '') // Remove invalid characters
    .replace(/\/+/g, '/') // Normalize slashes
    .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
}

export function detectVendor(folderName: string, id: string): Vendor {
  const lower = (folderName + id).toLowerCase();
  
  if (lower.includes('grok') || lower.includes('xai')) return 'grok';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
  if (lower.includes('gemini') || lower.includes('bard') || lower.includes('google')) return 'gemini';
  if (lower.includes('chatgpt') || lower.includes('openai') || lower.includes('gpt')) return 'chatgpt';
  
  // Default to ChatGPT for unknown formats
  return 'chatgpt';
}

// Extract export date/time from a ChatGPT-style folder path.
// Examples:
//  "1b25f0...-2025-02-08-10-50-49-029b0220..." => { date: "2025-02-08", time: "10-50-49" }
//  "chatgpt-2023-05-26-02-27-02" => { date: "2023-05-26", time: "02-27-02" }
export function parseExportInfo(folderName: string): { date?: string; time?: string } {
  const base = folderName.split('/').pop() || folderName;
  const m = base.match(/(20\d{2}-\d{2}-\d{2})(?:[-_](\d{2}-\d{2}-\d{2}))?/);
  if (m) return { date: m[1], time: m[2] };
  return {};
}

export function generateSourceId(vendor: Vendor, folderName: string): string {
  const { date } = parseExportInfo(folderName);
  const d = date || new Date().toISOString().slice(0, 10);
  return `${vendor}-${d}`;
}

// Human label like "ChatGPT 2025-02-08" used in chips and tags
export function makeSourceLabel(vendor: Vendor, folderName: string): string {
  const { date } = parseExportInfo(folderName);
  const vendorTitle = vendor.charAt(0).toUpperCase() + vendor.slice(1);
  return `${vendorTitle} ${date || new Date().toISOString().slice(0,10)}`;
}

export function pickColor(): string {
  const colors = [
    '#8bd0ff', '#ff8b8b', '#8bff8b', '#ff8bff', 
    '#8bffff', '#ffff8b', '#ff8b8b', '#8b8bff',
    '#ffa500', '#00ff7f', '#ff69b4', '#40e0d0'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function migrateLegacySettings(legacy: any): ParserSettings {
  const settings = { ...DEFAULT_SETTINGS };
  
  // Migrate legacy exportFolder to sources
  if (legacy.exportFolder && typeof legacy.exportFolder === 'string') {
    const vendor = detectVendor(legacy.exportFolder, '');
    const sourceId = generateSourceId(vendor, legacy.exportFolder);
    
    settings.sources = [{
      id: sourceId,
      vendor,
      root: legacy.exportFolder,
      addedAt: Date.now(),
      color: pickColor()
    }];
    settings.lastActiveSourceIds = [sourceId];
  }
  
  // Migrate recentFolders
  if (legacy.recentFolders && Array.isArray(legacy.recentFolders)) {
    settings.recentFolders = legacy.recentFolders;
  }
  
  // Ensure pythonPipeline exists (backward compatibility)
  if (!settings.pythonPipeline) {
    settings.pythonPipeline = DEFAULT_SETTINGS.pythonPipeline!;
  }
  
  // Migrate legacy dbPath if present
  if (legacy.dbPath && typeof legacy.dbPath === 'string' && !settings.pythonPipeline.dbPath) {
    settings.pythonPipeline.dbPath = legacy.dbPath;
  }
  
  return settings;
}

export function resolveVaultPath(path: string, vaultBasePath: string): string {
  // Resolve <vault> token to actual vault path
  let resolved = path.replace(/<vault>/g, vaultBasePath);
  
  // If path is vault-relative (no drive letter, no leading slash), prepend vault base
  // This handles paths like "AI Exports/ChatGPT" -> "C:/Vault/AI Exports/ChatGPT"
  if (resolved === path && !resolved.includes(':') && !resolved.startsWith('\\') && !resolved.startsWith('/')) {
    // It's a vault-relative path without <vault> token
    const pathModule = require("path");
    resolved = pathModule.join(vaultBasePath, resolved);
  }
  
  return resolved;
}
