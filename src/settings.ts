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

export function generateSourceId(vendor: Vendor, folderName: string): string {
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cleanName = folderName.replace(/[^a-zA-Z0-9\-_]/g, '-').toLowerCase();
  return `${vendor}-${cleanName}-${timestamp}`;
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
  
  return settings;
}
