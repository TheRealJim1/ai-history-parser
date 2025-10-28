// Simplified database implementation without SQL.js for now
// This can be enhanced later with proper SQL.js integration
import type { FlatMessage, Source } from './types';

// In-memory storage for now
let messages: FlatMessage[] = [];
let sources: Source[] = [];

export async function openDb(bin?: Uint8Array): Promise<void> {
  // Initialize in-memory storage
  messages = [];
  sources = [];
  
  if (bin) {
    // TODO: Implement binary data loading
    console.log('Binary data loading not yet implemented');
  }
}

export function upsertBatch(rows: FlatMessage[]): void {
  // Simple upsert by UID
  for (const row of rows) {
    const existingIndex = messages.findIndex(m => m.uid === row.uid);
    if (existingIndex >= 0) {
      messages[existingIndex] = row;
    } else {
      messages.push(row);
    }
  }
}

export function upsertSources(sourceList: Source[]): void {
  sources = [...sourceList];
}

export function getMessages(): FlatMessage[] {
  return messages;
}

export function searchMessages(
  query: string,
  facets: {
    vendor?: string;
    role?: string;
    from?: number;
    to?: number;
    sourceIds?: string[];
  } = {}
): FlatMessage[] {
  let filtered = [...messages];

  // Filter by vendor
  if (facets.vendor && facets.vendor !== 'all') {
    filtered = filtered.filter(m => m.vendor === facets.vendor);
  }

  // Filter by role
  if (facets.role && facets.role !== 'any') {
    filtered = filtered.filter(m => m.role === facets.role);
  }

  // Filter by date range
  if (facets.from) {
    filtered = filtered.filter(m => m.createdAt >= facets.from!);
  }

  if (facets.to) {
    filtered = filtered.filter(m => m.createdAt <= facets.to!);
  }

  // Filter by source IDs
  if (facets.sourceIds && facets.sourceIds.length > 0) {
    filtered = filtered.filter(m => facets.sourceIds!.includes(m.sourceId));
  }

  // Text search
  if (query) {
    const searchTerm = query.toLowerCase();
    filtered = filtered.filter(m => 
      m.text.toLowerCase().includes(searchTerm) ||
      (m.title && m.title.toLowerCase().includes(searchTerm))
    );
  }

  return filtered;
}

export function getStats(): {
  totalMessages: number;
  totalConversations: number;
  totalSources: number;
  vendorBreakdown: Record<string, number>;
} {
  const totalMessages = messages.length;
  const totalConversations = new Set(messages.map(m => `${m.vendor}:${m.conversationId}`)).size;
  const totalSources = sources.length;
  
  const vendorBreakdown: Record<string, number> = {};
  messages.forEach(m => {
    vendorBreakdown[m.vendor] = (vendorBreakdown[m.vendor] || 0) + 1;
  });

  return {
    totalMessages,
    totalConversations,
    totalSources,
    vendorBreakdown
  };
}

export function exportDb(): Uint8Array {
  // Simple JSON export for now
  const data = {
    messages,
    sources,
    timestamp: Date.now()
  };
  
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
}

export function closeDb(): void {
  messages = [];
  sources = [];
}

// Utility function to save database to vault
export async function saveDbToVault(plugin: any, filename: string = 'aihp.json'): Promise<void> {
  const data = exportDb();
  const path = `.aihp/${filename}`;
  
  // Ensure directory exists
  const dirExists = await plugin.app.vault.adapter.exists('.aihp');
  if (!dirExists) {
    await plugin.app.vault.createFolder('.aihp');
  }
  
  await plugin.app.vault.adapter.writeBinary(path, data);
}

// Utility function to load database from vault
export async function loadDbFromVault(plugin: any, filename: string = 'aihp.json'): Promise<Uint8Array | null> {
  const path = `.aihp/${filename}`;
  
  try {
    const exists = await plugin.app.vault.adapter.exists(path);
    if (!exists) return null;
    
    return await plugin.app.vault.adapter.readBinary(path);
  } catch (error) {
    console.warn('Failed to load database from vault:', error);
    return null;
  }
}

// Load data from binary
export async function loadFromBinary(bin: Uint8Array): Promise<void> {
  try {
    const json = new TextDecoder().decode(bin);
    const data = JSON.parse(json);
    
    if (data.messages) messages = data.messages;
    if (data.sources) sources = data.sources;
  } catch (error) {
    console.warn('Failed to load data from binary:', error);
  }
}