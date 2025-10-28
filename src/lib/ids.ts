import { fnv1a64, normText, canon } from "./hash";

export type Vendor = "chatgpt" | "grok" | "claude" | "gemini" | "unknown";

export function stableConvId(opts: {
  vendor: Vendor;
  title?: string;
  createdAt?: string | number; // ISO or epoch
  participants?: string[];     // "user","assistant","tool", etc
  firstMsgText?: string;
  extra?: Record<string, any>;
}): string {
  const seed = [
    "v=" + opts.vendor,
    "t=" + normText(opts.title || ""),
    "p=" + (opts.participants || []).sort().join(","),
    "c=" + (opts.createdAt ? String(opts.createdAt) : ""),
    "m=" + normText(opts.firstMsgText || ""),
    "x=" + canon(opts.extra || {})
  ].join("|");

  return "conv_" + fnv1a64(seed);
}

export function stableMsgId(opts: {
  vendor: Vendor;
  conversationStableId: string;    // output of stableConvId
  role: string;                    // user/assistant/tool/system
  createdAt?: string | number;
  text?: string;
  toolName?: string;
  attachments?: any[];
}): string {
  const seed = [
    "v=" + opts.vendor,
    "c=" + opts.conversationStableId,
    "r=" + opts.role,
    "t=" + (opts.createdAt ? String(opts.createdAt) : ""),
    "x=" + normText(opts.text || ""),
    "tool=" + (opts.toolName || ""),
    "att=" + canon(opts.attachments || [])
  ].join("|");

  return "msg_" + fnv1a64(seed);
}

// Generate a stable source ID for a folder
export function stableSourceId(opts: {
  vendor: Vendor;
  folderPath: string;
  addedAt: number;
}): string {
  const seed = [
    "v=" + opts.vendor,
    "p=" + normText(opts.folderPath),
    "a=" + String(opts.addedAt)
  ].join("|");

  return "src_" + fnv1a64(seed);
}

// Extract vendor from stable ID
export function getVendorFromStableId(stableId: string): Vendor {
  // Extract from the seed data if possible, fallback to parsing
  if (stableId.includes("v=chatgpt")) return "chatgpt";
  if (stableId.includes("v=grok")) return "grok";
  if (stableId.includes("v=claude")) return "claude";
  if (stableId.includes("v=gemini")) return "gemini";
  return "unknown";
}

// Check if two stable IDs are from the same conversation
export function isSameConversation(id1: string, id2: string): boolean {
  if (!id1 || !id2) return false;
  
  // Extract conversation part from message IDs
  const conv1 = id1.startsWith("msg_") ? id1.split("c=")[1]?.split("|")[0] : id1;
  const conv2 = id2.startsWith("msg_") ? id2.split("c=")[1]?.split("|")[0] : id2;
  
  return conv1 === conv2;
}

// Generate a conversation fingerprint for threading
export function conversationFingerprint(opts: {
  vendor: Vendor;
  participants: string[];
  firstMessages: string[];
  maxMessages?: number;
}): string {
  const messages = opts.firstMessages
    .slice(0, opts.maxMessages || 5)
    .map(m => normText(m))
    .filter(text => text.length > 0);
  
  const seed = [
    "v=" + opts.vendor,
    "p=" + opts.participants.sort().join(","),
    "m=" + messages.join("|")
  ].join("|");

  return "fp_" + fnv1a64(seed);
}

// Validate stable ID format
export function isValidStableId(id: string): boolean {
  if (!id) return false;
  
  const prefixes = ["conv_", "msg_", "src_", "fp_"];
  return prefixes.some(prefix => id.startsWith(prefix)) && id.length > prefix.length + 8;
}

// Parse stable ID to extract components
export function parseStableId(id: string): {
  type: "conversation" | "message" | "source" | "fingerprint" | "unknown";
  vendor?: Vendor;
  conversationId?: string;
  role?: string;
  raw: string;
} {
  if (!id) return { type: "unknown", raw: id };
  
  if (id.startsWith("conv_")) {
    return {
      type: "conversation",
      vendor: getVendorFromStableId(id),
      raw: id
    };
  }
  
  if (id.startsWith("msg_")) {
    const parts = id.split("|");
    const vendor = getVendorFromStableId(id);
    const convPart = parts.find(p => p.startsWith("c="));
    const rolePart = parts.find(p => p.startsWith("r="));
    
    return {
      type: "message",
      vendor,
      conversationId: convPart?.substring(2),
      role: rolePart?.substring(2),
      raw: id
    };
  }
  
  if (id.startsWith("src_")) {
    return {
      type: "source",
      vendor: getVendorFromStableId(id),
      raw: id
    };
  }
  
  if (id.startsWith("fp_")) {
    return {
      type: "fingerprint",
      vendor: getVendorFromStableId(id),
      raw: id
    };
  }
  
  return { type: "unknown", raw: id };
}
