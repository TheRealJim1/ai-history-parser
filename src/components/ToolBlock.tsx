import React from 'react';
import { canon } from '../lib/hash';

interface ToolBlockProps {
  toolName?: string;
  payload?: any;
  className?: string;
}

export function ToolBlock({ toolName, payload, className = "" }: ToolBlockProps) {
  if (!payload) return null;

  const pretty = (() => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return canon(payload);
    }
  })();

  return (
    <div className={`aihp-tool-block ${className}`}>
      <div className="aihp-tool-pill">
        TOOL{toolName ? ` · ${toolName}` : ""}
      </div>
      <pre className="aihp-tool-code">{pretty}</pre>
    </div>
  );
}

interface MessageContentProps {
  text: string;
  toolName?: string;
  toolPayload?: any;
  query?: string;
  useRegex?: boolean;
  highlightText?: (text: string, query: string, useRegex: boolean) => string;
}

export function MessageContent({ 
  text, 
  toolName, 
  toolPayload, 
  query = "", 
  useRegex = false,
  highlightText 
}: MessageContentProps) {
  const highlight = highlightText || ((t: string) => t);
  
  return (
    <div className="aihp-message-content">
      <div 
        className="aihp-message-text"
        dangerouslySetInnerHTML={{ 
          __html: highlight(text, query, useRegex) 
        }}
      />
      {toolPayload && (
        <ToolBlock 
          toolName={toolName} 
          payload={toolPayload}
        />
      )}
    </div>
  );
}
