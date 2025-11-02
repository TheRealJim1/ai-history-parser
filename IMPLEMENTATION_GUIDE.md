# Implementation Guide: OmniSearch Integration for AI History Parser

## #GUIDE001: Quick Start

### Setup Requirements

1. **Install Ollama or LM Studio**
   - **Ollama**: Download from https://ollama.ai
   - **LM Studio**: Download from https://lmstudio.ai
   - Start the local server

2. **Install Embedding Models**
   ```bash
   # Ollama
   ollama pull nomic-embed-text
   
   # Or use LM Studio to download embedding models
   ```

3. **Configure Plugin Settings**
   - Open Obsidian Settings → AI History Parser
   - Set embedding provider (Ollama or LM Studio)
   - Configure base URL (default: `http://localhost:11434` for Ollama)
   - Select embedding model (e.g., `nomic-embed-text`)

### Initial Database Setup

1. **Import Existing Conversations**
   - Click "Add Source" to add your AI conversation folders
   - Click "Load & Index" to parse conversations
   - Click "Import → SQLite" to store in database

2. **Generate Embeddings**
   - After importing, embeddings will be generated automatically
   - This may take time for large datasets
   - Progress shown in status bar

3. **Build Master Database**
   - Use "Build Master Database" command to consolidate
   - This will extract relationships and topics
   - Creates unified context across all sources

## #GUIDE002: Architecture Overview

### Component Structure

```
src/
├── lib/
│   ├── embeddings.ts          # Ollama/LM Studio integration
│   ├── vectorSearch.ts        # Semantic search functions
│   └── score.ts               # BM25 keyword scoring
├── db/
│   └── sqlite.ts              # Enhanced SQLite schema
├── services/
│   ├── database.ts            # Database service (enhanced)
│   └── masterDatabase.ts      # Master consolidation service
```

### Database Schema

**Core Tables:**
- `conversation` - Individual conversations
- `message` - Messages within conversations
- `message_embedding` - Vector embeddings for messages
- `conversation_relationship` - Cross-conversation relationships
- `topic` - Extracted topics
- `message_topic` - Message-topic associations

### Search Architecture

**Hybrid Search:**
- **BM25** (Keyword): Fast, exact matches
- **Vector** (Semantic): Contextual, similar meaning
- **Hybrid**: `final_score = α * bm25 + β * vector`

**Default Weights:**
- `α = 0.5` (BM25 weight)
- `β = 0.5` (Vector weight)

## #GUIDE003: Usage Examples

### Basic Search

```typescript
// Keyword search only
const results = await dbService.searchMessages('python', {
  vendor: 'chatgpt',
  useHybrid: false
});

// Hybrid search (keyword + semantic)
const hybridResults = await dbService.searchMessages('machine learning', {
  vendor: 'all',
  useHybrid: true,
  alpha: 0.4,  // More weight on semantic
  beta: 0.6
});
```

### Building Master Database

```typescript
import { MasterDatabaseService } from './services/masterDatabase';
import { AHPDB } from './db/sqlite';

const db = new AHPDB(app);
await db.open();

const masterService = new MasterDatabaseService(app, db);
await masterService.buildMasterDatabase();

// Get consolidated conversations
const consolidated = await masterService.consolidateConversations();
```

### Generating Embeddings

```typescript
import { getEmbeddingsService } from './lib/embeddings';

const embeddingsService = getEmbeddingsService({
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'nomic-embed-text'
});

// Single text
const embedding = await embeddingsService.embed('Hello world');

// Batch processing
const texts = ['Text 1', 'Text 2', 'Text 3'];
const embeddings = await embeddingsService.embedBatch(texts);

// Similarity calculation
const similarity = embeddingsService.cosineSimilarity(
  embedding1,
  embedding2
);
```

## #GUIDE004: Configuration

### Embedding Service Configuration

```typescript
interface EmbeddingConfig {
  provider: 'ollama' | 'lmstudio';
  baseUrl?: string;      // Default: 'http://localhost:11434'
  model: string;          // e.g., 'nomic-embed-text'
  dimension?: number;     // Auto-detected from model
  batchSize?: number;     // Default: 10
  timeout?: number;       // Default: 30000ms
}
```

### Search Configuration

```typescript
interface SearchOptions {
  useHybrid?: boolean;    // Enable hybrid search
  alpha?: number;         // BM25 weight (0.0 - 1.0)
  beta?: number;          // Vector weight (0.0 - 1.0)
  topK?: number;         // Max results (default: 10)
  threshold?: number;    // Minimum similarity (default: 0.7)
}
```

## #GUIDE005: Troubleshooting

### Embedding Service Not Connecting

1. **Check Service Status**
   ```typescript
   const service = getEmbeddingsService();
   const isConnected = await service.testConnection();
   ```

2. **Verify Base URL**
   - Ollama: `http://localhost:11434`
   - LM Studio: `http://localhost:1234` (check Settings)

3. **Check Model Availability**
   - Ollama: `ollama list`
   - LM Studio: Check downloaded models

### Slow Performance

1. **Reduce Batch Size**
   - Lower `batchSize` in config
   - Process in smaller chunks

2. **Use Caching**
   - Embeddings are cached automatically
   - Clear cache: `service.clearCache()`

3. **Database Indexing**
   - Ensure indexes are created
   - Check `PRAGMA index_list` in SQLite

### Memory Issues

1. **Limit Embedding Generation**
   - Generate embeddings incrementally
   - Process conversations in batches

2. **Clear Cache Regularly**
   - Use `service.clearCache()` when needed
   - Restart Obsidian if memory gets low

## #GUIDE006: Advanced Features

### Relationship Extraction

```typescript
const masterService = new MasterDatabaseService(app, db);

// Find related conversations
const relationships = await masterService.findRelatedConversations(
  conversationId,
  threshold: 0.7  // Minimum similarity
);

// Types: 'similar', 'related', 'followup', 'reference'
```

### Topic Clustering

```typescript
// Extract topics from messages
const topics = await masterService.extractTopics(messages);

// Topics are automatically extracted during consolidation
```

### Custom Search Strategies

```typescript
import { hybridSearch } from './lib/vectorSearch';

// Custom hybrid search
const results = await hybridSearch({
  query: 'your query',
  docs: searchDocuments,
  embeddings: documentEmbeddings,
  alpha: 0.3,  // 30% keyword
  beta: 0.7,   // 70% semantic
  topK: 20
});
```

## #GUIDE007: Performance Optimization

### Batch Processing

- Use `embedBatch()` for multiple texts
- Process conversations in batches of 10-20
- Save database after each batch

### Caching Strategy

- Embeddings are cached by default
- Cache key: `provider:model:text`
- Clear cache when model changes

### Database Optimization

- Use WAL mode (already enabled)
- Create indexes on frequently queried fields
- Vacuum database periodically

## #GUIDE008: Integration with Obsidian

### Command Palette

New commands available:
- `aihp-build-master-db` - Build master database
- `aihp-generate-embeddings` - Generate embeddings for all messages
- `aihp-hybrid-search` - Open hybrid search interface

### Settings

New settings in plugin configuration:
- Embedding Provider (Ollama/LM Studio)
- Base URL
- Model Name
- Batch Size
- Hybrid Search Weights (α, β)

## #GUIDE009: Future Enhancements

### Planned Features

1. **FTS5 Integration**
   - Full-text search index
   - Better keyword search performance

2. **Graph Visualization**
   - Visualize conversation relationships
   - Interactive graph view

3. **Advanced Clustering**
   - Topic modeling with LDA
   - Automatic conversation grouping

4. **Export Features**
   - Export consolidated conversations
   - Export relationship graphs
   - Export embeddings for external use

## BOTPROCESSID: #GUIDE009-BREAKDOWN

### Estimated Implementation Times

- **FTS5 Integration**: ~4 hours (Machine) / ~2 hours (Human)
- **Graph Visualization**: ~6 hours (Machine) / ~4 hours (Human)
- **Advanced Clustering**: ~8 hours (Machine) / ~5 hours (Human)
- **Export Features**: ~3 hours (Machine) / ~2 hours (Human)

**Total**: ~21 hours (Machine) / ~13 hours (Human)

---

## OUTLIERSID: Novel Approaches

### #OUTLIER001: Temporal Context Windows
**Exploration**: Track conversation evolution over time
- Build context windows across conversations
- Detect idea progression
- Generate timeline visualizations

### #OUTLIER002: Conversation DNA Fingerprinting
**Complexity**: High | **Potential**: Very High
- Extract structural patterns from conversations
- Match similar conversation structures
- Identify knowledge transfer patterns

### #OUTLIER003: Polymorphic Scoring System
**Novelty**: Dynamic, context-aware scoring
- Learn optimal weights per query type
- Adaptive scoring based on user feedback
- Self-improving search quality


