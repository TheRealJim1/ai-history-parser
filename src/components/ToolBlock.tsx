import React, { useEffect, useRef } from 'react';
import { MarkdownRenderer, Component } from 'obsidian';
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
  app?: any; // Obsidian App instance for markdown rendering
}

export function MessageContent({ 
  text, 
  toolName, 
  toolPayload, 
  query = "", 
  useRegex = false,
  highlightText,
  app
}: MessageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);

  useEffect(() => {
    if (!containerRef.current || !text) return;
    
    // Use Obsidian's markdown renderer if available
    if (app && MarkdownRenderer) {
      // Clear previous content
      containerRef.current.empty();
      
      // Create a new component for this render cycle
      if (componentRef.current) {
        componentRef.current.unload();
      }
      componentRef.current = new Component();
      
      // Apply highlighting if needed
      const contentToRender = highlightText ? highlightText(text, query, useRegex) : text;
      
      // Render markdown
      MarkdownRenderer.renderMarkdown(
        contentToRender,
        containerRef.current,
        '',
        componentRef.current
      ).catch(err => {
        console.error('Markdown rendering error:', err);
        // Fallback to plain text
        containerRef.current!.textContent = text;
      });
    } else {
      // Fallback: escape HTML and preserve line breaks
      const contentToRender = highlightText ? highlightText(text, query, useRegex) : text;
      if (containerRef.current) {
        containerRef.current.innerHTML = contentToRender
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
      }
    }

    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }
    };
  }, [text, query, useRegex, app]);

  return (
    <div className="aihp-message-content">
      <div 
        ref={containerRef}
        className="aihp-message-text"
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







