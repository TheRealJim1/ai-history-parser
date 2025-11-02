/**
 * Embeddings Service - Integration with Ollama and LM Studio
 * 
 * Supports:
 * - Ollama embeddings API
 * - LM Studio embeddings API
 * - Batch processing
 * - Caching
 */

export interface EmbeddingConfig {
  provider: 'ollama' | 'lmstudio';
  baseUrl?: string;
  model: string;
  dimension?: number;
  batchSize?: number;
  timeout?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  dimension: number;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimension: 768,
  batchSize: 10,
  timeout: 30000,
};

export class EmbeddingsService {
  private config: EmbeddingConfig;
  private cache: Map<string, number[]> = new Map();

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate embeddings for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Check cache
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Generate embedding
    const embedding = await this.fetchEmbedding(text);

    // Cache result
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = this.config.batchSize || 10;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.embed(text))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Test connection to embedding service
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.embed('test');
      return true;
    } catch (error) {
      console.error('Embedding service connection test failed:', error);
      return false;
    }
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Fetch embedding from API
   */
  private async fetchEmbedding(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const model = this.config.model;

    if (this.config.provider === 'ollama') {
      return this.fetchOllamaEmbedding(baseUrl, model, text);
    } else {
      return this.fetchLMStudioEmbedding(baseUrl, model, text);
    }
  }

  /**
   * Fetch embedding from Ollama
   */
  private async fetchOllamaEmbedding(
    baseUrl: string,
    model: string,
    text: string
  ): Promise<number[]> {
    const url = `${baseUrl}/api/embeddings`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Invalid embedding response from Ollama');
    }

    return data.embedding;
  }

  /**
   * Fetch embedding from LM Studio
   */
  private async fetchLMStudioEmbedding(
    baseUrl: string,
    model: string,
    text: string
  ): Promise<number[]> {
    const url = `${baseUrl}/v1/embeddings`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid embedding response from LM Studio');
    }

    return data.data[0].embedding;
  }

  /**
   * Generate cache key for text
   */
  private getCacheKey(text: string): string {
    return `${this.config.provider}:${this.config.model}:${text.trim().toLowerCase()}`;
  }
}

/**
 * Default embeddings service instance
 */
let defaultEmbeddingsService: EmbeddingsService | null = null;

export function getEmbeddingsService(config?: Partial<EmbeddingConfig>): EmbeddingsService {
  if (!defaultEmbeddingsService) {
    defaultEmbeddingsService = new EmbeddingsService(config);
  }
  return defaultEmbeddingsService;
}


