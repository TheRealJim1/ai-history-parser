# OmniSearch Integration Plan for AI History Parser

## #PLAN001: Overview & Strategy
**Machine Hours**: ~8 hours | **Human Hours**: ~4 hours

### Current State Analysis
- ✅ Basic SQLite database with conversations/messages
- ✅ BM25-style keyword search (token matching)
- ✅ Multi-source parsing (ChatGPT, Claude, etc.)
- ❌ No semantic/vector search capabilities
- ❌ No cross-conversation relationship mapping
- ❌ No unified context consolidation

### Goals
1. Integrate vector embeddings via Ollama/LM Studio
2. Implement hybrid search (BM25 + semantic similarity)
3. Enhance SQLite schema for vector storage
4. Build master database with relationship mapping
5. Continuous ingestion pipeline

## #DESIGN001: Enhanced Database Schema
**Machine Hours**: ~2 hours | **Human Hours**: ~1 hour

### New Tables
```sql
-- Vector embeddings storage
CREATE TABLE message_embedding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  embedding BLOB NOT NULL,  -- Vector as JSON or binary
  model_name TEXT,           -- e.g., "nomic-embed-text"
  embedding_dim INTEGER,     -- Dimension size (e.g., 768)
  created_at INTEGER,
  FOREIGN KEY(message_id) REFERENCES message(id)
);

-- Cross-conversation relationships
CREATE TABLE conversation_relationship (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id_1 INTEGER NOT NULL,
  conv_id_2 INTEGER NOT NULL,
  relationship_type TEXT,    -- 'similar', 'related', 'followup', 'reference'
  similarity_score REAL,     -- 0.0 - 1.0
  metadata TEXT,             -- JSON with context
  created_at INTEGER,
  FOREIGN KEY(conv_id_1) REFERENCES conversation(id),
  FOREIGN KEY(conv_id_2) REFERENCES conversation(id)
);

-- Topic/cluster extraction
CREATE TABLE topic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER
);

CREATE TABLE message_topic (
  message_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  relevance_score REAL,
  PRIMARY KEY(message_id, topic_id),
  FOREIGN KEY(message_id) REFERENCES message(id),
  FOREIGN KEY(topic_id) REFERENCES topic(id)
);

-- Search index for full-text + vectors
CREATE VIRTUAL TABLE message_fts USING fts5(
  message_id UNINDEXED,
  text,
  title,
  vendor,
  role,
  content='message',
  content_rowid='id'
);
```

## #IMPLEMENT001: Embeddings Service
**Machine Hours**: ~3 hours | **Human Hours**: ~2 hours

### Architecture
- Support both Ollama and LM Studio APIs
- Configurable embedding models
- Batch processing for efficiency
- Caching to avoid re-embedding

### Features
- Auto-detect available local LLM services
- Fallback mechanisms
- Progress tracking
- Error handling & retry logic

## #IMPLEMENT002: Hybrid Search System
**Machine Hours**: ~2 hours | **Human Hours**: ~1 hour

### Search Strategy
1. **Keyword Search (BM25)**: Fast, exact matches
2. **Semantic Search (Vector)**: Contextual, similar meaning
3. **Hybrid Scoring**: Combine both with configurable weights
4. **Faceted Filtering**: Vendor, role, date, source

### Implementation
- SQLite FTS5 for keyword search
- Vector similarity (cosine distance) for semantic
- Weighted combination: `final_score = α * bm25_score + β * vector_score`

## #IMPLEMENT003: Master Database Consolidation
**Machine Hours**: ~3 hours | **Human Hours**: ~2 hours

### Features
- Merge duplicate conversations across sources
- Extract unified context chains
- Build conversation clusters
- Generate relationship graphs

## #IMPLEMENT004: Ingestion Pipeline
**Machine Hours**: ~2 hours | **Human Hours**: ~1 hour

### Continuous Processing
- Watch for new conversation files
- Auto-parse and embed
- Update relationships incrementally
- Background processing queue

## #INTEGRATION001: Obsidian OmniSearch Compatibility
**Machine Hours**: ~1 hour | **Human Hours**: ~0.5 hours

### Features
- Export search results to Obsidian notes
- Link conversations to vault notes
- Bidirectional references
- Graph view integration

---

## BOTPROCESSID: #INTEGRATION001-BREAKDOWN

### Phase 1: Database Schema Enhancement
1. Add vector embeddings table
2. Add relationship tables
3. Add FTS5 virtual table
4. Migration scripts

### Phase 2: Embeddings Integration
1. Ollama API client
2. LM Studio API client
3. Embedding service wrapper
4. Batch processing logic

### Phase 3: Search Enhancement
1. Hybrid search function
2. Vector similarity calculation
3. Result ranking & scoring
4. Performance optimization

### Phase 4: Master Database
1. Deduplication logic
2. Relationship extraction
3. Topic clustering
4. Graph generation

### Phase 5: Pipeline & UI
1. Continuous ingestion
2. Progress UI
3. Search interface updates
4. Graph visualization

---

## OUTLIERSID: Novel Approaches

### #OUTLIER001: Polymorphic Scoring System
**Novelty**: Dynamic, context-aware scoring weights
- Learn optimal α/β ratios per query type
- Adaptive weights based on result quality
- User feedback loop for improvement

### #OUTLIER002: Conversation DNA Fingerprinting
**Complexity**: High | **Potential**: Very High
- Extract "fingerprints" from conversation patterns
- Match similar conversation structures
- Detect conversation evolution chains
- Identify knowledge transfer patterns

### #OUTLIER003: Temporal Context Windows
**Exploration**: Advanced
- Build context windows across time
- Track idea evolution over conversations
- Predict future conversation needs
- Generate timeline visualizations

---

## Implementation Priority

1. **Phase 1** (Critical): Database schema + basic embeddings
2. **Phase 2** (High): Hybrid search implementation
3. **Phase 3** (Medium): Relationship mapping
4. **Phase 4** (Nice-to-have): Advanced clustering & UI

---

## Estimated Totals
- **Total Machine Hours**: ~16 hours
- **Total Human Hours**: ~10.5 hours
- **BOTPROCESSID**: #INTEGRATION001 (detailed breakdown above)


