// External DB reader - reads from Python pipeline SQLite database
import type { App } from 'obsidian';
import { resolveVaultPath } from '../../settings';

export interface Conversation {
  id: string;
  provider: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  idx: number;
  role: string;
  author: string | null;
  model: string | null;
  created_at: string | null;
  content: string | null;
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

export interface Asset {
  id: number;
  sha256: string;
  ext: string;
  orig_name: string | null;
  url: string | null;
}

export interface MessageAsset {
  message_id: string;
  asset_id: number;
  ordinal: number;
  alt: string | null;
}

export class ExternalDBReader {
  private app: App;
  
  constructor(app: App) {
    this.app = app;
  }
  
  private resolvePath(path: string): string {
    // Resolve <vault> token
    const vaultBasePath = (this.app.vault.adapter as any).basePath || '';
    return resolveVaultPath(path, vaultBasePath);
  }
  
  async checkDatabaseExists(dbPath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(dbPath);
    
    // Try to read via Node.js fs (if available in Electron context)
    try {
      // @ts-ignore - Node.js fs available in Electron
      const fs = require('fs');
      return fs.existsSync(resolvedPath);
    } catch {
      // Fallback: try vault adapter if it's vault-relative
      if (resolvedPath.startsWith(vaultBasePath)) {
        const relativePath = resolvedPath.replace(vaultBasePath, '').replace(/^[\/\\]/, '');
        return await this.app.vault.adapter.exists(relativePath);
      }
      return false;
    }
  }
  
  async readDatabase(dbPath: string): Promise<any> {
    // This is a placeholder - actual implementation depends on how we access external DBs
    // Options:
    // 1. Use sql.js with file reading (if file is accessible)
    // 2. Use Node.js sqlite3 (if available)
    // 3. Use a bridge to Python script that reads DB
    
    // For now, we'll use a Python bridge script
    const resolvedPath = this.resolvePath(dbPath);
    return {
      path: resolvedPath,
      exists: await this.checkDatabaseExists(dbPath),
    };
  }
  
  async queryConversations(dbPath: string): Promise<Conversation[]> {
    // Placeholder - will implement with actual DB access
    // For now, return empty array
    return [];
  }
  
  async queryMessages(dbPath: string, conversationId: string): Promise<Message[]> {
    // Placeholder
    return [];
  }
  
  async queryAnnotation(dbPath: string, conversationId: string): Promise<ConversationAnnotation | null> {
    // Placeholder
    return null;
  }
  
  async queryAssets(dbPath: string, messageId: string): Promise<Asset[]> {
    // Placeholder
    return [];
  }
}



