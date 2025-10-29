import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { ConversationLite, ExportIndex, MessageLite, ParseError, FlatMessage, Source, Vendor } from "./types";
import { stableConvId, stableMsgId } from "./lib/ids";
import { extractText, toEpoch, canon, normText } from "./lib/hash";
import { toSearchDoc, rankedMessageSearch } from "./lib/score";

// Parse multiple sources and return flattened messages
export async function parseMultipleSources(
  app: App,
  sources: Source[]
): Promise<{ messages: FlatMessage[]; errors: ParseError[] }> {
  console.log("🔍 ===== PARSEMULTIPLESOURCES START =====");
  console.log("🔍 parseMultipleSources called with", sources.length, "sources");
  console.log("🔍 Sources:", sources.map(s => ({ id: s.id, root: s.root, vendor: s.vendor })));
  
  // Validate inputs
  if (!app) {
    throw new Error("App is required");
  }
  if (!Array.isArray(sources)) {
    throw new Error("Sources must be an array");
  }
  if (sources.length === 0) {
    console.log("⚠️ No sources provided");
    return { messages: [], errors: [] };
  }

  const allMessages: FlatMessage[] = [];
  const allErrors: ParseError[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    console.log(`📁 ===== PROCESSING SOURCE ${i + 1}/${sources.length} =====`);
    console.log(`📁 Processing source: ${source.id} (${source.root})`);
    
    // Validate source structure
    if (!source.id || !source.vendor || !source.root) {
      console.error("❌ Invalid source structure:", source);
      allErrors.push({
        source: source.root || 'unknown',
        error: "Invalid source structure - missing required fields",
        timestamp: Date.now()
      });
      continue;
    }

    try {
      console.log(`🔄 Calling parseSource for ${source.id}...`);
      const result = await parseSource(app, source);
      console.log(`✅ Parsed ${result.messages.length} messages from ${source.id}`);
      console.log(`✅ Parse errors from ${source.id}: ${result.errors.length}`);
      allMessages.push(...result.messages);
      allErrors.push(...result.errors);
      console.log(`📁 Completed source ${i + 1}/${sources.length}`);
    } catch (error) {
      console.error(`❌ Error parsing source ${source.id}:`, error);
      console.error(`❌ Source error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      allErrors.push({
        source: source.root,
        error: String(error),
        timestamp: Date.now()
      });
    }
  }

  console.log(`📊 ===== PARSEMULTIPLESOURCES COMPLETION =====`);
  console.log(`📊 Total: ${allMessages.length} messages, ${allErrors.length} errors`);
  console.log(`📊 ===== PARSEMULTIPLESOURCES END =====`);
  return { messages: allMessages, errors: allErrors };
}

// Parse a single source
export async function parseSource(
  app: App,
  source: Source
): Promise<{ messages: FlatMessage[]; errors: ParseError[] }> {
  console.log(`🔍 ===== PARSESOURCE START =====`);
  console.log(`🔍 Parsing source: ${source.id} at ${source.root}`);
  const messages: FlatMessage[] = [];
  const errors: ParseError[] = [];

  try {
    console.log(`🔍 Looking for source folder at: ${source.root}`);
    
    // Get all files in the source directory
    const folder = app.vault.getAbstractFileByPath(source.root);
    console.log(`🔍 Folder object:`, folder);
    console.log(`🔍 Folder type:`, folder ? typeof folder : 'null');
    console.log(`🔍 Has children:`, folder && "children" in folder);
    
    if (!folder || !("children" in folder)) {
      console.error(`❌ Source folder not found: ${source.root}`);
      console.error(`❌ Available files in vault:`, app.vault.getRoot().children?.map(c => c.path));
      throw new Error(`Source folder not found: ${source.root}`);
    }

    console.log(`📁 Found folder with ${folder.children.length} files:`);
    folder.children.forEach((child, index) => {
      console.log(`  ${index + 1}. ${child.name} (${child instanceof TFile ? 'file' : 'folder'})`);
      if (child instanceof TFile) {
        console.log(`     Size: ${child.stat.size} bytes`);
        console.log(`     Path: ${child.path}`);
      }
    });

    // Look for conversation files - only JSON files, exclude HTML
    const conversationFiles = folder.children.filter(
      file => file instanceof TFile && 
        file.name.endsWith(".json") && 
        !file.name.endsWith(".html") &&
        (
          file.name === "conversations.json" || 
          file.name === "shared_conversations.json" ||
          file.name.includes("conversation") ||
          file.name.includes("chat")
        )
    );
    
    console.log(`📄 Found ${conversationFiles.length} potential conversation files:`, conversationFiles.map(f => f.name));
    
    // If no conversation files found, try all JSON files (excluding HTML)
    if (conversationFiles.length === 0) {
      console.log("⚠️ No conversation files found, trying all JSON files...");
      const allJsonFiles = folder.children.filter(
        file => file instanceof TFile && 
          file.name.endsWith(".json") && 
          !file.name.endsWith(".html")
      );
      console.log(`📄 Found ${allJsonFiles.length} JSON files:`, allJsonFiles.map(f => f.name));
      conversationFiles.push(...allJsonFiles);
    }

    for (let i = 0; i < conversationFiles.length; i++) {
      const file = conversationFiles[i];
      try {
        console.log(`📖 ===== READING FILE ${i + 1}/${conversationFiles.length} =====`);
        console.log(`📖 Reading file: ${file.path}`);
        const content = await app.vault.read(file);
        console.log(`📄 File size: ${content.length} characters`);
        
        const data = JSON.parse(content);
        console.log(`📊 Parsed JSON, type: ${Array.isArray(data) ? 'array' : typeof data}, length: ${Array.isArray(data) ? data.length : 'N/A'}`);
        
        // Debug: Show structure of the data
        if (Array.isArray(data) && data.length > 0) {
          console.log(`🔍 First item structure:`, Object.keys(data[0]));
          console.log(`🔍 First item sample:`, JSON.stringify(data[0], null, 2).substring(0, 500) + '...');
        } else if (typeof data === 'object' && data !== null) {
          console.log(`🔍 Object structure:`, Object.keys(data));
          console.log(`🔍 Object sample:`, JSON.stringify(data, null, 2).substring(0, 500) + '...');
        }
        
        if (Array.isArray(data)) {
          console.log(`🔄 Processing ${data.length} conversations...`);
          for (let j = 0; j < data.length; j++) {
            const conv = data[j];
            console.log(`🔄 Processing conversation ${j + 1}/${data.length}: "${conv.title || 'untitled'}"`);
            const convMessages = flattenConversation(conv, source, file.name as any);
            console.log(`  - Conversation "${conv.title || 'untitled'}" -> ${convMessages.length} messages`);
            messages.push(...convMessages);
          }
        } else if (typeof data === 'object' && data !== null) {
          // Handle single conversation object
          console.log(`🔄 Processing single conversation object: "${data.title || 'untitled'}"`);
          const convMessages = flattenConversation(data, source, file.name as any);
          console.log(`  - Conversation "${data.title || 'untitled'}" -> ${convMessages.length} messages`);
          messages.push(...convMessages);
        } else {
          console.warn(`⚠️ Expected array or object but got ${typeof data}`);
        }
        console.log(`📖 Completed file ${i + 1}/${conversationFiles.length}`);
      } catch (error: any) {
        console.error(`❌ Error reading file ${file.path}:`, error);
        console.error(`❌ Error details:`, {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
        console.error(`❌ Full error object:`, error);
        errors.push({
          source: file.path,
          error: String(error),
          timestamp: Date.now()
        });
      }
    }
  } catch (error) {
    console.error(`❌ ===== PARSESOURCE FATAL ERROR =====`);
    console.error(`❌ Fatal error in parseSource:`, error);
    console.error(`❌ Fatal error details:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    errors.push({
      source: source.root,
      error: String(error),
      timestamp: Date.now()
    });
  }

  console.log(`📊 ===== PARSESOURCE COMPLETION =====`);
  console.log(`📊 Parsed ${messages.length} messages, ${errors.length} errors`);
  console.log(`📊 ===== PARSESOURCE END =====`);
  return { messages, errors };
}

// Flatten a conversation into individual messages
function flattenConversation(
  conv: any,
  source: Source,
  sourceType: "conversations.json" | "shared_conversations.json"
): FlatMessage[] {
  console.log(`🔄 ===== FLATTENCONVERSATION START =====`);
  console.log(`🔄 Flattening conversation: "${conv.title || '(untitled)'}"`);
  console.log(`  - Has messages array: ${Array.isArray(conv.messages)}`);
  console.log(`  - Has mapping: ${!!conv.mapping}`);
  console.log(`  - Messages count: ${conv.messages?.length || 0}`);
  console.log(`  - Mapping keys: ${conv.mapping ? Object.keys(conv.mapping).length : 0}`);
  
  const messages: FlatMessage[] = [];
  const title = conv.title || "(untitled)";
  const createTime = conv.create_time ?? conv.create_time_ms ?? conv.create_time_s;
  const createTimeMs = toEpoch(createTime) || Date.now();

  let messageList: any[] = [];

  if (Array.isArray(conv.messages)) {
    messageList = conv.messages;
    console.log(`  - Using messages array: ${messageList.length} messages`);
  } else if (conv.mapping && typeof conv.mapping === "object" && Object.keys(conv.mapping).length > 0) {
    // Handle mapping-based format (older ChatGPT exports)
    console.log(`  - Using mapping format with ${Object.keys(conv.mapping).length} nodes`);
    for (const node of Object.values<any>(conv.mapping)) {
      const m = node?.message;
      if (m) messageList.push(m);
    }
    messageList.sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));
    console.log(`  - Extracted ${messageList.length} messages from mapping`);
  } else {
    console.warn(`  - No messages or mapping found in conversation`);
    console.warn(`  - Conversation object keys:`, Object.keys(conv));
    console.warn(`  - Has mapping:`, !!conv.mapping, typeof conv.mapping);
    console.warn(`  - Mapping keys:`, conv.mapping ? Object.keys(conv.mapping) : 'none');
    console.warn(`  - Conversation object sample:`, JSON.stringify(conv, null, 2).substring(0, 500) + '...');
  }

  // Extract participants for stable conversation ID
  const participants = Array.from(new Set(messageList.map((m: any) => m.author?.role ?? m.role ?? "user")));
  const firstMsg = messageList.find((m: any) => m.role === "user" || m.role === "system") || messageList[0];
  const firstMsgText = firstMsg ? extractText(firstMsg) : "";

  // Generate stable conversation ID
  const conversationStableId = stableConvId({
    vendor: source.vendor,
    title,
    createdAt: createTime,
    participants,
    firstMsgText,
    extra: {
      nativeId: conv.id ?? conv.conversation_id ?? "",
      sourceType
    }
  });

  console.log(`🔄 Processing ${messageList.length} messages...`);
  for (let i = 0; i < messageList.length; i++) {
    const msg = messageList[i];
    try {
      console.log(`🔄 Processing message ${i + 1}/${messageList.length}`);
      const role = msg.author?.role ?? msg.role ?? "user";
      const text = extractText(msg);
      const createdAt = toEpoch(msg.create_time ?? msg.created_at ?? msg.timestamp) || createTimeMs;

      if (!text || text.trim() === '') {
        console.log(`  - Skipping empty message ${i + 1}`);
        continue;
      }

      // Extract tool information
      const toolName = msg.tool_name || msg.name || msg.function_name;
      const attachments = msg.attachments || msg.files || msg.tool_payload || null;

      // Generate stable message ID
      const messageStableId = stableMsgId({
        vendor: source.vendor,
        conversationStableId: conversationStableId,
        role,
        createdAt: msg.create_time ?? msg.created_at ?? msg.timestamp,
        text,
        toolName,
        attachments
      });

      // Canonicalize tool payload for search indexing
      const toolJson = canon(msg.tool_payload ?? msg.arguments ?? msg.call ?? null);

      messages.push({
        uid: messageStableId,
        vendor: source.vendor,
        sourceId: source.id,
        conversationId: conversationStableId,
        messageId: msg.id,
        role: role as any,
        createdAt,
        title,
        text: text.trim(),
        toolJson
      });
      
      if ((i + 1) % 10 === 0) {
        console.log(`  - Processed ${i + 1}/${messageList.length} messages`);
      }
    } catch (error) {
      console.warn(`⚠️ Error processing message ${i + 1}:`, error);
      console.warn("Message that caused error:", msg);
      console.warn("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
  }

  console.log(`📊 ===== FLATTENCONVERSATION COMPLETION =====`);
  console.log(`📊 Flattened ${messages.length} messages from conversation`);
  console.log(`📊 ===== FLATTENCONVERSATION END =====`);
  return messages;
}

// Enhanced search with facets and ranking
export function searchMessages(
  messages: FlatMessage[],
  query: string,
  facets: {
    vendor?: Vendor | 'all';
    role?: string | 'any';
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
    sourceIds?: string[];
    titleBody?: boolean;
    regex?: boolean;
  } = {}
): FlatMessage[] {
  if (!query || !query.trim()) {
    // No query, just apply filters
    let filtered = messages;

    if (facets.vendor && facets.vendor !== 'all') {
      filtered = filtered.filter(m => m.vendor === facets.vendor);
    }

    if (facets.role && facets.role !== 'any') {
      filtered = filtered.filter(m => m.role === facets.role);
    }

    if (facets.from) {
      const fromTime = new Date(facets.from).getTime();
      filtered = filtered.filter(m => m.createdAt >= fromTime);
    }

    if (facets.to) {
      const toTime = new Date(facets.to).getTime() + 86400000;
      filtered = filtered.filter(m => m.createdAt <= toTime);
    }

    if (facets.sourceIds && facets.sourceIds.length > 0) {
      filtered = filtered.filter(m => facets.sourceIds!.includes(m.sourceId));
    }

    return filtered;
  }

  // Use ranked search for better results
  return rankedMessageSearch(messages, query, facets.regex || false, {
    vendor: facets.vendor,
    role: facets.role,
    from: facets.from ? new Date(facets.from).getTime() : undefined,
    to: facets.to ? new Date(facets.to).getTime() + 86400000 : undefined,
    sourceIds: facets.sourceIds
  });
}

// Highlight text with search terms
export function highlightText(text: string, query: string, useRegex: boolean = false): string {
  if (!query || !query.trim()) return text;

  try {
    let pattern: RegExp;
    
    if (useRegex) {
      pattern = new RegExp(`(${query})`, 'gi');
    } else {
      // Escape special regex characters for literal search
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pattern = new RegExp(`(${escaped})`, 'gi');
    }

    return text.replace(pattern, '<mark>$1</mark>');
  } catch (error) {
    // If regex fails, fall back to simple string replacement
    return text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<mark>$&</mark>');
  }
}
