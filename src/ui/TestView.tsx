import React, { useState, useMemo } from "react";
import ConversationsGrid from "./ConversationsGrid";
import MessageTurns from "./MessageTurns";
import { buildConversationIndex } from "../data/conversations";
import type { Msg } from "../data/conversations";

// Import the CSS
import "../styles/tw.css";

type Props = {
  messages: any[]; // FlatMessage[]
};

export default function TestView({ messages }: Props) {
  const [convPageSize, setConvPageSize] = useState(50);
  const [msgPageSize, setMsgPageSize] = useState(100);
  const [msgPage, setMsgPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapseTools, setCollapseTools] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  // Convert FlatMessage to Msg format
  const convertedMessages: Msg[] = useMemo(() => {
    return messages.map(msg => ({
      id: msg.uid,
      convId: msg.conversationId,
      convTitle: msg.title || "(untitled)",
      role: msg.role,
      ts: msg.createdAt,
      text: msg.text,
      vendor: msg.vendor as any
    }));
  }, [messages]);

  // Build conversation index
  const convRows = useMemo(() => buildConversationIndex(convertedMessages), [convertedMessages]);

  // Get messages for selected conversation
  const currentMessages = useMemo(() => {
    if (!selectedConvId) return [];
    return convertedMessages.filter(m => m.convId === selectedConvId);
  }, [convertedMessages, selectedConvId]);

  const toggleSelect = (id: string) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleOpenConv = (convId: string) => {
    setSelectedConvId(convId);
    setSelected(new Set([convId]));
  };

  return (
    <div className="flex h-screen">
      {/* Left: Conversations Grid */}
      <div className="w-1/3 border-r border-border">
        <ConversationsGrid
          rows={convRows}
          pageSize={convPageSize}
          onPageSizeChange={setConvPageSize}
          onOpen={handleOpenConv}
          selected={selected}
          toggleSelect={toggleSelect}
        />
      </div>

      {/* Right: Message Turns */}
      <div className="flex-1 flex flex-col">
        {/* Controls */}
        <div className="flex items-center gap-4 p-2 border-b border-border">
          <label className="flex items-center gap-2">
            <input 
              type="checkbox" 
              checked={collapseTools} 
              onChange={e => setCollapseTools(e.target.checked)} 
            />
            Collapse tools
          </label>
          <label className="flex items-center gap-2">
            <input 
              type="checkbox" 
              checked={showSystem} 
              onChange={e => setShowSystem(e.target.checked)} 
            />
            Show system
          </label>
        </div>

        {/* Messages */}
        <div className="flex-1">
          <MessageTurns
            messages={currentMessages}
            pageSize={msgPageSize}
            page={msgPage}
            onPageChange={setMsgPage}
            onPageSizeChange={setMsgPageSize}
            collapseTools={collapseTools}
            showSystem={showSystem}
          />
        </div>
      </div>
    </div>
  );
}
