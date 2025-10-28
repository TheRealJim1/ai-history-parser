import { QueryClient } from '@tanstack/react-query';
import { AHPDB } from '../db/sqlite';
import type { App } from 'obsidian';
import type { FlatMessage, Source } from '../types';

export class DatabaseService {
  private db: AHPDB;
  private queryClient: QueryClient;
  private app: App;

  constructor(app: App, queryClient: QueryClient) {
    this.app = app;
    this.queryClient = queryClient;
    this.db = new AHPDB(app);
  }

  async initialize() {
    await this.db.open();
    console.log('🗄️ Database initialized');
  }

  async save() {
    await this.db.save();
    console.log('💾 Database saved');
  }

  // Query Keys for TanStack Query
  static queryKeys = {
    all: ['database'] as const,
    messages: () => [...DatabaseService.queryKeys.all, 'messages'] as const,
    messagesBySource: (sourceIds: string[]) => [...DatabaseService.queryKeys.messages(), 'bySource', sourceIds] as const,
    conversations: () => [...DatabaseService.queryKeys.all, 'conversations'] as const,
    stats: () => [...DatabaseService.queryKeys.all, 'stats'] as const,
  };

  // Messages CRUD Operations
  async insertMessages(messages: FlatMessage[]): Promise<void> {
    const db = await this.db.open();
    
    for (const msg of messages) {
      // Insert conversation if not exists
      const convId = this.db.insertConversation({
        ext_id: msg.conversationId,
        source: msg.sourceId,
        title: msg.title,
        started_at: msg.createdAt,
        updated_at: Date.now(),
        backup_id: 1, // TODO: implement backup sets
        raw_path: '', // TODO: track source file path
        sha256: msg.uid, // Use stable ID as hash
      });

      // Insert message
      this.db.insertMessage(
        convId,
        msg.role,
        msg.createdAt,
        msg.text
      );
    }

    // Invalidate related queries
    this.queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.messages() });
    this.queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.stats() });
  }

  async getMessages(sourceIds?: string[]): Promise<FlatMessage[]> {
    const db = await this.db.open();
    const conversations = this.db.selectConversations({ 
      source: sourceIds?.[0] // TODO: support multiple sources
    });

    const messages: FlatMessage[] = [];
    
    for (const conv of conversations) {
      const convMessages = this.db.getConversationBlob(conv.id);
      
      for (const msg of convMessages) {
        messages.push({
          uid: `${conv.source}:${conv.ext_id}:${msg.ts}`, // Generate stable ID
          vendor: this.detectVendor(conv.source),
          sourceId: conv.source,
          conversationId: conv.ext_id,
          messageId: `${msg.ts}`,
          role: msg.role as any,
          createdAt: msg.ts,
          title: conv.title || '',
          text: msg.text,
          toolJson: null, // TODO: implement tool data storage
        });
      }
    }

    return messages;
  }

  async getStats() {
    const db = await this.db.open();
    const conversations = this.db.selectConversations();
    
    const totalMessages = conversations.reduce((sum, conv) => {
      const messages = this.db.getConversationBlob(conv.id);
      return sum + messages.length;
    }, 0);

    return {
      totalMessages,
      totalConversations: conversations.length,
      sources: [...new Set(conversations.map(c => c.source))].length,
      lastUpdated: Math.max(...conversations.map(c => c.updated_at)),
    };
  }

  async searchMessages(query: string, filters: {
    sourceIds?: string[];
    vendor?: string;
    role?: string;
    dateFrom?: number;
    dateTo?: number;
  }): Promise<FlatMessage[]> {
    // TODO: Implement SQL-based search for better performance
    const allMessages = await this.getMessages(filters.sourceIds);
    
    return allMessages.filter(msg => {
      if (filters.vendor && msg.vendor !== filters.vendor) return false;
      if (filters.role && msg.role !== filters.role) return false;
      if (filters.dateFrom && msg.createdAt < filters.dateFrom) return false;
      if (filters.dateTo && msg.createdAt > filters.dateTo) return false;
      if (query && !msg.text.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }

  async clearDatabase(): Promise<void> {
    const db = await this.db.open();
    db.exec('DELETE FROM message');
    db.exec('DELETE FROM conversation');
    db.exec('DELETE FROM backup_set');
    
    this.queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.all });
  }

  private detectVendor(sourceId: string): 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'unknown' {
    if (sourceId.includes('chatgpt')) return 'chatgpt';
    if (sourceId.includes('claude')) return 'claude';
    if (sourceId.includes('grok')) return 'grok';
    if (sourceId.includes('gemini')) return 'gemini';
    return 'unknown';
  }
}

// Singleton instance
let databaseService: DatabaseService | null = null;

export function getDatabaseService(app: App, queryClient: QueryClient): DatabaseService {
  if (!databaseService) {
    databaseService = new DatabaseService(app, queryClient);
  }
  return databaseService;
}

// Static method for DatabaseService class
DatabaseService.getDatabaseService = getDatabaseService;
