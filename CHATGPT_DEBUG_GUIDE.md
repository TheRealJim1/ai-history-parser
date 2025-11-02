# AI History Parser - Debug Guide for ChatGPT

## 🎯 **Current Status & Issues**

### **What's Working:**
- ✅ **Conversation Parsing**: Successfully parsing 570+ messages from ChatGPT JSON exports
- ✅ **File Filtering**: Fixed HTML file filtering (was causing JSON parsing errors)
- ✅ **Message Processing**: Processing individual messages and filtering empty ones
- ✅ **Build Process**: ESBuild configuration working with SQL.js support

### **What's Broken:**
- ❌ **UI Display**: Messages parsed but not showing in conversation list
- ❌ **Import → SQLite**: Button not working properly
- ❌ **Database Stats**: Not updating after import
- ❌ **Search Functionality**: May not be working with parsed messages

## 🏗️ **Architecture Overview**

### **Current Tech Stack:**
- **Frontend**: React + TypeScript
- **Build**: ESBuild with SQL.js support
- **Database**: SQLite (sql.js) - partially implemented
- **State Management**: Mixed (local state + TanStack Query hooks)
- **Parsing**: Custom parser for ChatGPT JSON exports

### **File Structure:**
```
src/
├── main.ts                 # Plugin entry point
├── view.tsx               # Main UI component (React)
├── parser.ts              # Message parsing logic
├── db.ts                  # In-memory database (legacy)
├── db/sqlite.ts           # SQLite implementation
├── services/
│   └── database.ts        # Database service layer
├── hooks/
│   └── useDatabase.ts     # TanStack Query hooks
├── providers/
│   └── QueryProvider.tsx  # React Query provider
└── lib/
    ├── hash.ts            # Hashing utilities
    ├── topics.ts          # Topic extraction
    └── score.ts           # Search ranking
```

## 🐛 **Known Issues & Root Causes**

### **Issue 1: UI Not Displaying Messages**
**Problem**: Messages are parsed successfully but not showing in the left panel conversation list.

**Likely Causes**:
- State management conflict between TanStack Query and local state
- `filteredMessages` not properly connected to UI
- `groupedByConversation` not updating with parsed messages

**Files to Check**:
- `src/view.tsx` lines 254-282 (filteredMessages logic)
- `src/view.tsx` lines 295-302 (groupedByConversation logic)

### **Issue 2: Import → SQLite Not Working**
**Problem**: Button exists but doesn't actually import to SQLite database.

**Likely Causes**:
- `importToDb` function using wrong database functions
- Missing dependency on old `db.ts` file
- SQLite database not properly initialized

**Files to Check**:
- `src/view.tsx` lines 556-588 (importToDb function)
- `src/db.ts` (legacy database functions)
- `src/db/sqlite.ts` (SQLite implementation)

### **Issue 3: Mixed State Management**
**Problem**: Both TanStack Query hooks and local state are being used, causing conflicts.

**Current State**:
```typescript
// TanStack Query (not working)
const { data: messages = [] } = useMessages(plugin.app, activeSourcesArray);

// Local state (working)
const [messages, setMessages] = useState<FlatMessage[]>([]);
```

## 🎯 **Immediate Fixes Needed**

### **Priority 1: Fix UI Display**
1. **Remove TanStack Query hooks** temporarily
2. **Use only local state** for messages
3. **Ensure `setMessages()` updates UI**
4. **Test conversation list displays**

### **Priority 2: Fix SQLite Import**
1. **Restore working `importToDb` function**
2. **Use proper SQLite database functions**
3. **Test database stats update**
4. **Verify data persistence**

### **Priority 3: Clean Up State Management**
1. **Choose one approach**: Either TanStack Query OR local state
2. **Remove conflicting code**
3. **Ensure consistent data flow**

## 🔧 **Debug Steps for ChatGPT**

### **Step 1: Check Message Flow**
```typescript
// In view.tsx, add debugging:
console.log("🔍 Messages state:", messages.length);
console.log("🔍 Filtered messages:", filteredMessages.length);
console.log("🔍 Grouped conversations:", groupedByConversation.length);
```

### **Step 2: Test SQLite Import**
```typescript
// Test if database functions work:
const { openDb, upsertBatch, saveDbToVault } = await import("./db");
console.log("🔍 Database functions loaded:", !!openDb);
```

### **Step 3: Check UI Rendering**
```typescript
// In the conversation list render:
{groupedByConversation.map(g => (
  <div key={g.key}>
    {g.title} - {g.count} messages
  </div>
))}
```

## 🚀 **Future Roadmap**

### **Phase 1: Basic Functionality (Current)**
- ✅ Parse ChatGPT exports
- 🔄 Display conversations in UI
- 🔄 Import to SQLite
- 🔄 Basic search

### **Phase 2: SQLite + TanStack Query**
- Replace in-memory storage with SQLite
- Implement TanStack Query for caching
- Add background updates
- Optimize performance

### **Phase 3: Advanced Features**
- AI-powered contextual relationships
- Graph visualization
- Advanced search with semantic understanding
- Export to various formats

## 📝 **Key Code Locations**

### **Message Parsing**:
- `src/parser.ts` - `parseMultipleSources()` function
- `src/parser.ts` - `flattenConversation()` function

### **UI State Management**:
- `src/view.tsx` - `loadMessages()` function (lines 339-492)
- `src/view.tsx` - `filteredMessages` useMemo (lines 254-282)
- `src/view.tsx` - `groupedByConversation` useMemo (lines 295-302)

### **Database Operations**:
- `src/view.tsx` - `importToDb()` function (lines 556-588)
- `src/db.ts` - Legacy database functions
- `src/db/sqlite.ts` - SQLite implementation

### **UI Rendering**:
- `src/view.tsx` - Conversation list render (around line 666)
- `src/view.tsx` - Message display render (around line 707)

## 🎯 **Success Criteria**

### **Basic Functionality Working**:
1. ✅ Add source folder
2. ✅ Load & Index shows conversations
3. ✅ Click conversation shows messages
4. ✅ Import → SQLite saves to database
5. ✅ Search filters messages
6. ✅ Database stats show correct counts

### **Current Status**:
- ✅ Step 1: Add source folder
- ✅ Step 2: Load & Index parses messages
- ❌ Step 3: Conversations not showing in UI
- ❌ Step 4: Import → SQLite not working
- ❌ Step 5: Search not tested
- ❌ Step 6: Database stats not updating

## 💡 **Recommended Approach**

1. **Start with UI Display**: Fix the conversation list first
2. **Then SQLite Import**: Get database working
3. **Test Complete Workflow**: End-to-end functionality
4. **Add TanStack Query**: Once basic functionality works
5. **Advanced Features**: AI relationships, graph visualization

## 🔍 **Debug Commands**

The plugin has debug commands available:
- `aihp-debug-test` - Run health check
- `aihp-test-source` - Add test source
- `aihp-debug-files` - List source files

Use these to verify plugin state and functionality.

---

**Note**: This plugin is an Obsidian plugin for parsing AI conversation history. The main goal is to create a searchable, graphable database of AI conversations with advanced relationship mapping capabilities.







