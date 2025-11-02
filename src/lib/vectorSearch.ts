/**
 * Vector Search - Semantic similarity search using embeddings
 * 
 * Provides:
 * - Vector similarity search
 * - Hybrid search (BM25 + vector)
 * - Result ranking
 */

import { EmbeddingsService, getEmbeddingsService } from './embeddings';
import type { SearchDoc } from './score';

export interface VectorSearchResult {
  id: string;
  score: number;
  doc: SearchDoc;
}

export interface HybridSearchOptions {
  query: string;
  docs: SearchDoc[];
  embeddings: Map<string, number[]>;
  alpha?: number;  // BM25 weight (0.0 - 1.0)
  beta?: number;   // Vector weight (0.0 - 1.0)
  topK?: number;
}

/**
 * Calculate cosine similarity between query and document embeddings
 */
export function vectorSimilarity(
  queryEmbedding: number[],
  docEmbedding: number[],
  embeddingsService?: EmbeddingsService
): number {
  const service = embeddingsService || getEmbeddingsService();
  return service.cosineSimilarity(queryEmbedding, docEmbedding);
}

/**
 * Perform vector similarity search
 */
export async function vectorSearch(
  queryEmbedding: number[],
  docs: SearchDoc[],
  docEmbeddings: Map<string, number[]>,
  topK: number = 10
): Promise<VectorSearchResult[]> {
  const results: VectorSearchResult[] = [];

  for (const doc of docs) {
    const docEmbedding = docEmbeddings.get(doc.id);
    if (!docEmbedding) continue;

    const similarity = vectorSimilarity(queryEmbedding, docEmbedding);
    
    if (similarity > 0) {
      results.push({
        id: doc.id,
        score: similarity,
        doc,
      });
    }
  }

  // Sort by similarity score (descending)
  results.sort((a, b) => b.score - a.score);

  // Return top K results
  return results.slice(0, topK);
}

/**
 * Hybrid search combining BM25 (keyword) and vector (semantic) search
 * 
 * final_score = α * normalized_bm25 + β * normalized_vector
 * where α + β = 1.0 (default)
 */
export async function hybridSearch(
  options: HybridSearchOptions
): Promise<VectorSearchResult[]> {
  const {
    query,
    docs,
    embeddings,
    alpha = 0.5,
    beta = 0.5,
    topK = 10,
  } = options;

  // Get query embedding
  const embeddingsService = getEmbeddingsService();
  const queryEmbedding = await embeddingsService.embed(query);

  // Normalize weights
  const totalWeight = alpha + beta;
  const normAlpha = totalWeight > 0 ? alpha / totalWeight : 0.5;
  const normBeta = totalWeight > 0 ? beta / totalWeight : 0.5;

  const results: Array<{ id: string; score: number; doc: SearchDoc }> = [];

  // Calculate BM25 scores (from existing score.ts)
  const bm25Scores = new Map<string, number>();
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const now = Date.now();

  for (const doc of docs) {
    let bm25Score = 0;
    
    const H = (txt?: string, w = 1) => {
      if (!txt) return;
      const low = txt.toLowerCase();
      for (const t of queryTokens) {
        if (!t) continue;
        const hits = (low.match(new RegExp("\\b" + escapeRe(t) + "\\b", "g")) || []).length;
        if (hits) bm25Score += hits * w;
      }
    };

    H(doc.title, 3.0);
    H(doc.system, 2.0);
    H(doc.toolJson, 1.25);
    H(doc.body, 1.0);

    // Recency boost
    if (doc.date) {
      const days = (now - doc.date) / 86400000;
      const boost = Math.max(0, 1 - (days / 180));
      bm25Score *= (1 + 0.25 * boost);
    }

    bm25Scores.set(doc.id, bm25Score);
  }

  // Find max BM25 score for normalization
  const maxBM25 = Math.max(...Array.from(bm25Scores.values()), 1);

  // Calculate vector similarities
  for (const doc of docs) {
    const docEmbedding = embeddings.get(doc.id);
    if (!docEmbedding) continue;

    const vectorScore = vectorSimilarity(queryEmbedding, docEmbedding);
    const bm25Score = bm25Scores.get(doc.id) || 0;
    
    // Normalize scores to [0, 1]
    const normBM25 = maxBM25 > 0 ? bm25Score / maxBM25 : 0;
    const normVector = (vectorScore + 1) / 2; // Convert [-1, 1] to [0, 1]

    // Combine scores
    const hybridScore = normAlpha * normBM25 + normBeta * normVector;

    if (hybridScore > 0) {
      results.push({
        id: doc.id,
        score: hybridScore,
        doc,
      });
    }
  }

  // Sort by hybrid score (descending)
  results.sort((a, b) => b.score - a.score);

  // Return top K results
  return results.slice(0, topK);
}

/**
 * Utility to escape regex special characters
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Batch generate embeddings for documents
 */
export async function generateDocumentEmbeddings(
  docs: SearchDoc[],
  embeddingsService?: EmbeddingsService
): Promise<Map<string, number[]>> {
  const service = embeddingsService || getEmbeddingsService();
  const embeddings = new Map<string, number[]>();

  // Extract text for each document
  const texts = docs.map(doc => {
    const parts = [
      doc.title || '',
      doc.system || '',
      doc.body || '',
    ].filter(Boolean);
    return parts.join('\n');
  });

  // Batch generate embeddings
  try {
    const embeddingArrays = await service.embedBatch(texts);
    
    for (let i = 0; i < docs.length; i++) {
      if (embeddingArrays[i]) {
        embeddings.set(docs[i].id, embeddingArrays[i]);
      }
    }
  } catch (error) {
    console.error('Error generating document embeddings:', error);
  }

  return embeddings;
}


