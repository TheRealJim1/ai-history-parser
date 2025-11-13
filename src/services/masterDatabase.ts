/**
 * Master Database Service - Consolidates all AI history into unified context
 * 
 * Features:
 * - Deduplication across sources
 * - Relationship extraction
 * - Topic clustering
 * - Context consolidation
 */

import { AHPDB } from '../providers/db/sqlite';
import { getEmbeddingsService } from '../lib/embeddings';
import { generateDocumentEmbeddings } from '../lib/vectorSearch';
import type { App } from 'obsidian';
import type { FlatMessage } from '../types';
import { toSearchDoc } from '../lib/score';

export interface ConsolidatedConversation {
  id: string;
  title: string;
  sources: string[];
  messages: FlatMessage[];
  relatedConversations: string[];
  topics: string[];
  startedAt: number;
  updatedAt: number;
}

export interface RelationshipAnalysis {
  conv_id_1: number;
  conv_id_2: number;
  similarity: number;
  relationshipType: 'similar' | 'related' | 'followup' | 'reference';
  metadata?: Record<string, any>;
}

export class MasterDatabaseService {
  private db: AHPDB;
  private app: App;
  private embeddingsService = getEmbeddingsService();

  constructor(app: App, db: AHPDB) {
    this.app = app;
    this.db = db;
  }

  /**
   * Consolidate conversations by finding duplicates and merging contexts
   */
  async consolidateConversations(): Promise<ConsolidatedConversation[]> {
    await this.db.open();
    
    const conversations = this.db.selectConversations();
    const consolidated: ConsolidatedConversation[] = [];

    // Group conversations by similarity
    const processed = new Set<number>();
    
    for (const conv of conversations) {
      if (processed.has(conv.id)) continue;

      const related = await this.findRelatedConversations(conv.id);
      const allConvIds = [conv.id, ...related.map(r => r.conv_id_2)];
      
      // Mark as processed
      allConvIds.forEach(id => processed.add(id));

      // Merge messages from all related conversations
      const allMessages: FlatMessage[] = [];
      for (const convId of allConvIds) {
        const blob = this.db.getConversationBlob(convId);
        const convData = conversations.find(c => c.id === convId);
        
        if (convData) {
          for (const msg of blob) {
            allMessages.push({
              uid: `${convData.source}:${convData.ext_id}:${msg.ts}`,
              vendor: this.detectVendor(convData.source),
              sourceId: convData.source,
              conversationId: convData.ext_id,
              role: msg.role as any,
              createdAt: msg.ts,
              title: convData.title || '',
              text: msg.text,
            });
          }
        }
      }

      // Sort messages by timestamp
      allMessages.sort((a, b) => a.createdAt - b.createdAt);

      // Extract unique sources
      const sources = [...new Set(allMessages.map(m => m.sourceId))];
      
      // Get topics
      const topics = await this.extractTopics(allMessages);

      consolidated.push({
        id: `consolidated-${conv.id}`,
        title: conv.title || 'Untitled Conversation',
        sources,
        messages: allMessages,
        relatedConversations: related.map(r => `${r.conv_id_2}`),
        topics,
        startedAt: Math.min(...allMessages.map(m => m.createdAt)),
        updatedAt: Math.max(...allMessages.map(m => m.createdAt)),
      });
    }

    return consolidated;
  }

  /**
   * Find related conversations using embeddings
   */
  async findRelatedConversations(
    conv_id: number,
    threshold: number = 0.7
  ): Promise<RelationshipAnalysis[]> {
    await this.db.open();
    
    const existing = this.db.getConversationRelationships(conv_id);
    if (existing.length > 0) {
      return existing.map(r => ({
        conv_id_1: r.conv_id_1 as number,
        conv_id_2: r.conv_id_2 as number,
        similarity: r.similarity_score as number,
        relationshipType: (r.relationship_type as any) || 'related',
        metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
      }));
    }

    // Get conversation embedding
    const convEmbedding = await this.getConversationEmbedding(conv_id);
    if (!convEmbedding) return [];

    // Compare with all other conversations
    const allConversations = this.db.selectConversations();
    const relationships: RelationshipAnalysis[] = [];

    for (const otherConv of allConversations) {
      if (otherConv.id === conv_id) continue;

      const otherEmbedding = await this.getConversationEmbedding(otherConv.id);
      if (!otherEmbedding) continue;

      const similarity = this.embeddingsService.cosineSimilarity(
        convEmbedding,
        otherEmbedding
      );

      if (similarity >= threshold) {
        const relationshipType = this.determineRelationshipType(
          similarity,
          conv_id,
          otherConv.id
        );

        relationships.push({
          conv_id_1: conv_id,
          conv_id_2: otherConv.id,
          similarity,
          relationshipType,
          metadata: {
            sources: [otherConv.source],
            titles: [otherConv.title],
          },
        });

        // Save relationship to database
        this.db.insertConversationRelationship(
          conv_id,
          otherConv.id,
          relationshipType,
          similarity,
          {
            sources: [otherConv.source],
            titles: [otherConv.title],
          }
        );
      }
    }

    return relationships.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Get conversation-level embedding (average of message embeddings)
   */
  private async getConversationEmbedding(conv_id: number): Promise<number[] | null> {
    await this.db.open();
    
    const messages = this.db.getConversationBlob(conv_id);
    if (messages.length === 0) return null;

    const embeddings: number[][] = [];

    for (const msg of messages) {
      // Find message ID (simplified - in practice need to query)
      const msgRes = this.db.getConversationBlob(conv_id);
      // This is a simplified version - would need proper message ID mapping
      
      // For now, generate embedding on-the-fly
      const text = `${msg.role}: ${msg.text}`;
      try {
        const embedding = await this.embeddingsService.embed(text);
        embeddings.push(embedding);
      } catch (error) {
        console.error('Error generating embedding:', error);
      }
    }

    if (embeddings.length === 0) return null;

    // Average embeddings
    const dimension = embeddings[0].length;
    const avgEmbedding = new Array(dimension).fill(0);
    
    for (const emb of embeddings) {
      for (let i = 0; i < dimension; i++) {
        avgEmbedding[i] += emb[i];
      }
    }
    
    for (let i = 0; i < dimension; i++) {
      avgEmbedding[i] /= embeddings.length;
    }

    return avgEmbedding;
  }

  /**
   * Extract topics from messages using clustering
   */
  async extractTopics(messages: FlatMessage[]): Promise<string[]> {
    // Simple keyword extraction - could be enhanced with topic modeling
    const wordCounts: Record<string, number> = {};
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);

    for (const msg of messages) {
      const words = (msg.text || '').toLowerCase().match(/\b\w{4,}\b/g) || [];
      for (const word of words) {
        if (!commonWords.has(word)) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
    }

    // Get top 5 topics
    const topics = Object.entries(wordCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);

    return topics;
  }

  /**
   * Build master database - main entry point
   */
  async buildMasterDatabase(): Promise<void> {
    await this.db.open();
    
    console.log('🏗️ Building master database...');
    
    // Step 1: Generate embeddings for all messages
    await this.generateAllEmbeddings();
    
    // Step 2: Extract relationships
    await this.buildRelationshipGraph();
    
    // Step 3: Consolidate conversations
    const consolidated = await this.consolidateConversations();
    
    console.log(`✅ Master database built: ${consolidated.length} consolidated conversations`);
  }

  /**
   * Generate embeddings for all messages
   */
  private async generateAllEmbeddings(): Promise<void> {
    await this.db.open();
    
    const conversations = this.db.selectConversations();
    let processed = 0;
    const total = conversations.length;

    for (const conv of conversations) {
      const messages = this.db.getConversationBlob(conv.id);
      
      for (const msg of messages) {
        // Check if embedding exists (simplified - would need message ID)
        // For now, generate and store
        try {
          const embedding = await this.embeddingsService.embed(msg.text);
          // Would need proper message ID here
          // this.db.insertMessageEmbedding(messageId, embedding, 'nomic-embed-text', embedding.length);
        } catch (error) {
          console.error('Error generating embedding:', error);
        }
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(`📊 Processed ${processed}/${total} conversations`);
      }
    }
  }

  /**
   * Build relationship graph between conversations
   */
  private async buildRelationshipGraph(): Promise<void> {
    await this.db.open();
    
    const conversations = this.db.selectConversations();
    console.log(`🔗 Building relationship graph for ${conversations.length} conversations...`);

    for (let i = 0; i < conversations.length; i++) {
      await this.findRelatedConversations(conversations[i].id);
      
      if ((i + 1) % 5 === 0) {
        console.log(`🔗 Processed ${i + 1}/${conversations.length} conversations`);
      }
    }
  }

  /**
   * Determine relationship type based on similarity and context
   */
  private determineRelationshipType(
    similarity: number,
    conv1_id: number,
    conv2_id: number
  ): 'similar' | 'related' | 'followup' | 'reference' {
    if (similarity >= 0.9) return 'similar';
    if (similarity >= 0.8) return 'related';
    
    // Could add temporal analysis for followup/reference
    return 'related';
  }

  /**
   * Detect vendor from source ID
   */
  private detectVendor(sourceId: string): 'chatgpt' | 'claude' | 'grok' | 'gemini' {
    if (sourceId.includes('chatgpt')) return 'chatgpt';
    if (sourceId.includes('claude')) return 'claude';
    if (sourceId.includes('grok')) return 'grok';
    if (sourceId.includes('gemini')) return 'gemini';
    return 'chatgpt'; // default
  }
}


