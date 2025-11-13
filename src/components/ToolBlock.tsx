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
    <div className={`aihp-tool-block ${className}`} style={{
      userSelect: 'text',
      WebkitUserSelect: 'text',
      MozUserSelect: 'text',
      msUserSelect: 'text',
      cursor: 'text'
    }}>
      <div className="aihp-tool-pill">
        TOOL{toolName ? ` · ${toolName}` : ""}
      </div>
      <pre className="aihp-tool-code" style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        msUserSelect: 'text',
        cursor: 'text',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}>{pretty}</pre>
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

interface ThoughtEntry {
  summary: string;
  content: string;
  finished?: boolean;
}

interface ThoughtsMeta {
  title?: string;
}

interface ReasoningRecap {
  content: string;
  duration?: string;
}

// Helper function to detect if content is code (Python, JavaScript, etc.)
function isCodeContent(content: string): { isCode: boolean; language?: string } {
  if (!content || typeof content !== 'string') {
    return { isCode: false };
  }
  
  const trimmed = content.trim();
  
  // Check for code indicators
  const codePatterns = [
    { pattern: /^(def |class |import |from |#|function |const |let |var |public |private |protected |interface |type |enum )/m, lang: 'python' },
    { pattern: /^(def |class |import |from |#)/m, lang: 'python' },
    { pattern: /^(function |const |let |var |export |import )/m, lang: 'javascript' },
    { pattern: /^(public |private |protected |class |interface |namespace )/m, lang: 'typescript' },
    { pattern: /^(SELECT |INSERT |UPDATE |DELETE |CREATE |ALTER )/im, lang: 'sql' },
    { pattern: /^(<html|<div|<script|<!DOCTYPE)/im, lang: 'html' },
    { pattern: /^(\.|#|\w+\s*\{)/m, lang: 'css' },
  ];
  
  for (const { pattern, lang } of codePatterns) {
    if (pattern.test(trimmed)) {
      return { isCode: true, language: lang };
    }
  }
  
  // Check for code-like structure (multiple lines with indentation)
  const lines = trimmed.split('\n');
  if (lines.length > 5 && lines.filter(l => l.trim().length > 0 && /^\s{2,}/.test(l)).length > lines.length * 0.5) {
    return { isCode: true, language: 'python' }; // Default to Python for indented code
  }
  
  return { isCode: false };
}

// Helper function to recursively extract text from nested JSON structures
function extractTextFromContent(content: any): { text: string | null; isCode: boolean; language?: string } {
  if (typeof content === 'string') {
    // Check if it's code
    const codeCheck = isCodeContent(content);
    if (codeCheck.isCode) {
      return { text: content, isCode: true, language: codeCheck.language };
    }
    
    // Try to parse as JSON string
    try {
      const parsed = JSON.parse(content);
      return extractTextFromContent(parsed);
    } catch {
      return { text: content, isCode: false };
    }
  }
  
  if (typeof content === 'object' && content !== null) {
    // If it has a 'text' field, use that
    if ('text' in content && typeof content.text === 'string') {
      const codeCheck = isCodeContent(content.text);
      return { text: content.text, isCode: codeCheck.isCode, language: codeCheck.language };
    }
    
    // If it has a 'content' field with code, check that
    if ('content' in content && typeof content.content === 'string') {
      const codeCheck = isCodeContent(content.content);
      if (codeCheck.isCode) {
        return { text: content.content, isCode: true, language: codeCheck.language };
      }
    }
    
    // If it's an array, extract text from all items
    if (Array.isArray(content)) {
      const results = content
        .map(item => extractTextFromContent(item))
        .filter(r => r.text !== null);
      if (results.length > 0) {
        const texts = results.map(r => r.text).filter((t): t is string => t !== null);
        // Check if any are code
        const hasCode = results.some(r => r.isCode);
        const lang = results.find(r => r.isCode)?.language;
        return { text: texts.join('\n\n'), isCode: hasCode, language: lang };
      }
    }
    
    // If it has a 'content' field, try that
    if ('content' in content) {
      const extracted = extractTextFromContent(content.content);
      if (extracted.text) return extracted;
    }
  }
  
  return { text: null, isCode: false };
}

// Helper function to parse JSON content and extract text
function parseMessageText(rawText: string): { text: string; isJson: boolean; isCode: boolean; language?: string; jsonData?: any; thoughts?: ThoughtEntry[]; thoughtsMeta?: ThoughtsMeta; reasoningRecap?: ReasoningRecap } {
  if (!rawText || typeof rawText !== 'string') {
    return { text: rawText || '', isJson: false, isCode: false };
  }

  // Try to parse as JSON string
  try {
    // Check if it looks like a JSON string (starts with { or [)
    const trimmed = rawText.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const parsed = JSON.parse(rawText);

      // Handle explicit thoughts payloads
      const handleThoughtObject = (obj: any): { entries: ThoughtEntry[]; meta?: ThoughtsMeta } | null => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.content_type === 'thoughts' && Array.isArray(obj.thoughts)) {
          const entries: ThoughtEntry[] = obj.thoughts
            .map((item: any, index: number) => {
              const summary = (item?.summary || item?.title || item?.heading || `Thought ${index + 1}`).toString();
              const content = typeof item?.content === 'string'
                ? item.content
                : typeof item?.text === 'string'
                  ? item.text
                  : '';
              return {
                summary,
                content,
                finished: item?.finished === true,
              } as ThoughtEntry;
            })
            .filter((entry: ThoughtEntry) => !!entry.summary || !!entry.content);

          if (entries.length > 0) {
            return {
              entries,
              meta: {
                title: obj?.title || obj?.heading || obj?.label || undefined,
              }
            };
          }
        }
        return null;
      };

      // Handle reasoning_recap
      const handleReasoningRecap = (obj: any): ReasoningRecap | null => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.content_type === 'reasoning_recap') {
          const content = typeof obj.content === 'string' ? obj.content : '';
          // Extract duration from content like "Thought for 12s"
          const durationMatch = content.match(/(\d+)\s*(s|sec|second|seconds|ms|millisecond|milliseconds)/i);
          const duration = durationMatch ? durationMatch[0] : undefined;
          return { content, duration };
        }
        return null;
      };

      if (!Array.isArray(parsed)) {
        const thoughtInfo = handleThoughtObject(parsed);
        const recapInfo = handleReasoningRecap(parsed);
        if (thoughtInfo) {
          return {
            text: '',
            isJson: false,
            isCode: false,
            jsonData: parsed,
            thoughts: thoughtInfo.entries,
            thoughtsMeta: thoughtInfo.meta,
            reasoningRecap: recapInfo || undefined,
          };
        }
        if (recapInfo) {
          return {
            text: recapInfo.content,
            isJson: false,
            isCode: false,
            jsonData: parsed,
            reasoningRecap: recapInfo,
          };
        }
      }

      if (Array.isArray(parsed)) {
        let collectedThoughts: ThoughtEntry[] | undefined;
        let collectedMeta: ThoughtsMeta | undefined;

        const nonThoughtItems = parsed.filter((item: any) => {
          const info = handleThoughtObject(item);
          if (info) {
            collectedThoughts = info.entries;
            collectedMeta = info.meta;
            return false;
          }
          return true;
        });

        if (collectedThoughts && collectedThoughts.length > 0) {
          const extractedText = extractTextFromContent(nonThoughtItems);
          return {
            text: extractedText.text || '',
            isJson: false,
            isCode: extractedText.isCode,
            language: extractedText.language,
            jsonData: parsed,
            thoughts: collectedThoughts,
            thoughtsMeta: collectedMeta,
          };
        }
      }
      
      // Try to extract text from nested structures
      const extracted = extractTextFromContent(parsed);
      if (extracted.text) {
        return { text: extracted.text, isJson: false, isCode: extracted.isCode, language: extracted.language };
      }
      
      // If it's an array of objects, try to extract meaningful content
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Check if items have content fields with nested JSON
        const texts: string[] = [];
        let hasCode = false;
        let codeLang: string | undefined;
        for (const item of parsed) {
          if (typeof item === 'object' && item !== null) {
            // Check content field
            if ('content' in item && typeof item.content === 'string') {
              const contentResult = extractTextFromContent(item.content);
              if (contentResult.text) {
                texts.push(contentResult.text);
                if (contentResult.isCode) {
                  hasCode = true;
                  codeLang = contentResult.language;
                }
                continue;
              }
            }
            // Check text field
            if ('text' in item && typeof item.text === 'string') {
              const codeCheck = isCodeContent(item.text);
              texts.push(item.text);
              if (codeCheck.isCode) {
                hasCode = true;
                codeLang = codeCheck.language;
              }
              continue;
            }
          }
        }
        if (texts.length > 0) {
          return { text: texts.join('\n\n'), isJson: false, isCode: hasCode, language: codeLang };
        }
      }
      
      // If we couldn't extract text, format it nicely as code
      return { text: JSON.stringify(parsed, null, 2), isJson: true, isCode: false, jsonData: parsed };
    }
  } catch (e) {
    // Not valid JSON, continue to other checks
  }

  // Check if it contains nested JSON strings (like {"text": "..."})
  try {
    // Match JSON strings with text field
    const jsonMatch = rawText.match(/\{"text":\s*"([^"]+)"\}/);
    if (jsonMatch && jsonMatch[1]) {
      const text = jsonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      const codeCheck = isCodeContent(text);
      return { text, isJson: false, isCode: codeCheck.isCode, language: codeCheck.language };
    }
    
    // Match content field with nested JSON
    const contentMatch = rawText.match(/"content":\s*"(\{[^}]+\})"/);
    if (contentMatch && contentMatch[1]) {
      try {
        const contentParsed = JSON.parse(contentMatch[1]);
        const extracted = extractTextFromContent(contentParsed);
        if (extracted.text) {
          return { text: extracted.text, isJson: false, isCode: extracted.isCode, language: extracted.language };
        }
      } catch {
        // Ignore
      }
    }
  } catch (e) {
    // Ignore
  }

  // Check if raw text itself is code
  const codeCheck = isCodeContent(rawText);
  return { text: rawText, isJson: false, isCode: codeCheck.isCode, language: codeCheck.language };
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

  // Parse the text to extract actual content
  const { text: parsedText, isJson, isCode, language, jsonData, thoughts, thoughtsMeta, reasoningRecap } = parseMessageText(text);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous content and detach markdown component if present
    if (componentRef.current) {
      componentRef.current.unload();
      componentRef.current = null;
    }
    container.replaceChildren();
    container.style.userSelect = 'text';
    container.style.webkitUserSelect = 'text';
    container.style.mozUserSelect = 'text';
    container.style.msUserSelect = 'text';
    container.style.cursor = 'text';

    // Render structured thoughts view if available
    if (thoughts && thoughts.length > 0) {
      const wrapper = document.createElement('div');
      wrapper.className = 'aihp-thoughts-container';
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '10px';
      wrapper.style.padding = '12px';
      wrapper.style.background = 'var(--background-secondary)';
      wrapper.style.borderRadius = '10px';
      wrapper.style.border = '1px solid var(--background-modifier-border)';
      wrapper.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';

      // Header with duration if reasoning recap is available
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '4px';
      
      const headerLeft = document.createElement('div');
      headerLeft.style.display = 'flex';
      headerLeft.style.alignItems = 'center';
      headerLeft.style.gap = '8px';
      headerLeft.style.fontSize = '13px';
      headerLeft.style.fontWeight = '600';
      headerLeft.style.color = 'var(--text-normal)';
      
      const icon = document.createElement('span');
      icon.textContent = '🧠';
      icon.style.fontSize = '16px';
      headerLeft.appendChild(icon);
      
      const title = document.createElement('span');
      title.textContent = `${thoughtsMeta?.title || 'Thinking Process'} · ${thoughts.length} thought${thoughts.length !== 1 ? 's' : ''}`;
      headerLeft.appendChild(title);
      
      header.appendChild(headerLeft);
      
      // Duration badge if reasoning recap is available
      if (reasoningRecap && reasoningRecap.duration) {
        const durationBadge = document.createElement('div');
        durationBadge.style.display = 'flex';
        durationBadge.style.alignItems = 'center';
        durationBadge.style.gap = '4px';
        durationBadge.style.padding = '4px 10px';
        durationBadge.style.background = 'var(--interactive-accent)';
        durationBadge.style.color = 'var(--text-on-accent)';
        durationBadge.style.borderRadius = '12px';
        durationBadge.style.fontSize = '11px';
        durationBadge.style.fontWeight = '500';
        
        const clockIcon = document.createElement('span');
        clockIcon.textContent = '⏱️';
        clockIcon.style.fontSize = '12px';
        durationBadge.appendChild(clockIcon);
        
        const durationText = document.createElement('span');
        durationText.textContent = reasoningRecap.duration;
        durationBadge.appendChild(durationText);
        
        header.appendChild(durationBadge);
      }
      
      wrapper.appendChild(header);

      thoughts.forEach((item, index) => {
        const card = document.createElement('div');
        card.style.background = 'var(--background-modifier-hover)';
        card.style.borderRadius = '8px';
        card.style.padding = '8px 12px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '4px';
        card.style.borderLeft = '3px solid var(--interactive-accent)';
        card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)';

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.fontSize = '13px';
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '6px';
        title.style.color = 'var(--text-normal)';
        const thoughtIcon = item.finished ? '✓' : '•';
        title.textContent = `${thoughtIcon} ${item.summary || `Thought ${index + 1}`}`;
        card.appendChild(title);

        if (item.content) {
          const body = document.createElement('div');
          body.style.fontSize = '12px';
          body.style.lineHeight = '1.6';
          body.style.color = 'var(--text-muted)';
          body.style.marginTop = '4px';
          if (highlightText) {
            body.innerHTML = highlightText(item.content, query, useRegex);
          } else {
            body.textContent = item.content;
          }
          card.appendChild(body);
        }

        wrapper.appendChild(card);
      });

      container.appendChild(wrapper);
      return () => {
        if (componentRef.current) {
          componentRef.current.unload();
          componentRef.current = null;
        }
      };
    }

    // Render reasoning recap alone if no thoughts
    if (reasoningRecap && (!thoughts || thoughts.length === 0)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'aihp-reasoning-recap';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';
      wrapper.style.padding = '10px 14px';
      wrapper.style.background = 'var(--background-secondary)';
      wrapper.style.borderRadius = '8px';
      wrapper.style.border = '1px solid var(--background-modifier-border)';
      
      const icon = document.createElement('span');
      icon.textContent = '⏱️';
      icon.style.fontSize = '16px';
      wrapper.appendChild(icon);
      
      const content = document.createElement('span');
      content.textContent = reasoningRecap.content;
      content.style.fontSize = '12px';
      content.style.color = 'var(--text-normal)';
      wrapper.appendChild(content);
      
      container.appendChild(wrapper);
      return () => {
        if (componentRef.current) {
          componentRef.current.unload();
          componentRef.current = null;
        }
      };
    }

    // If it's code, render it as a code block
    if (isCode && parsedText) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = language ? `language-${language}` : '';
      code.textContent = parsedText;
      code.style.userSelect = 'text';
      code.style.webkitUserSelect = 'text';
      code.style.mozUserSelect = 'text';
      code.style.msUserSelect = 'text';
      code.style.cursor = 'text';
      code.style.whiteSpace = 'pre-wrap';
      code.style.wordBreak = 'break-word';
      code.style.display = 'block';
      code.style.padding = '12px';
      code.style.background = 'rgba(0, 0, 0, 0.3)';
      code.style.borderRadius = '6px';
      code.style.overflow = 'auto';
      pre.appendChild(code);
      pre.style.userSelect = 'text';
      pre.style.webkitUserSelect = 'text';
      pre.style.mozUserSelect = 'text';
      pre.style.msUserSelect = 'text';
      pre.style.cursor = 'text';
      pre.style.margin = '0';
      container.appendChild(pre);
      return () => {};
    }
    
    // Use Obsidian's markdown renderer if available
    if (app && MarkdownRenderer && !isJson) {
      componentRef.current = new Component();
      const contentToRender = highlightText ? highlightText(parsedText, query, useRegex) : parsedText;
      MarkdownRenderer.renderMarkdown(
        contentToRender,
        container,
        '',
        componentRef.current
      ).then(() => {
        const allElements = container.querySelectorAll('*');
        allElements.forEach((el: any) => {
          el.style.userSelect = 'text';
          el.style.webkitUserSelect = 'text';
          el.style.mozUserSelect = 'text';
          el.style.msUserSelect = 'text';
          el.style.cursor = 'text';
        });
      }).catch(err => {
        console.error('Markdown rendering error:', err);
        container.textContent = parsedText;
      });

      return () => {
        if (componentRef.current) {
          componentRef.current.unload();
          componentRef.current = null;
        }
      };
    }

    if (isJson && jsonData) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = JSON.stringify(jsonData, null, 2);
      code.style.userSelect = 'text';
      code.style.webkitUserSelect = 'text';
      code.style.mozUserSelect = 'text';
      code.style.msUserSelect = 'text';
      code.style.cursor = 'text';
      code.style.whiteSpace = 'pre-wrap';
      code.style.wordBreak = 'break-word';
      pre.appendChild(code);
      pre.style.userSelect = 'text';
      pre.style.webkitUserSelect = 'text';
      pre.style.mozUserSelect = 'text';
      pre.style.msUserSelect = 'text';
      pre.style.cursor = 'text';
      container.appendChild(pre);
      return () => {};
    }

    const contentToRender = highlightText ? highlightText(parsedText, query, useRegex) : parsedText;
    if (highlightText) {
      container.innerHTML = contentToRender.replace(/\n/g, '<br>');
    } else {
      const lines = parsedText.split('\n');
      lines.forEach((line, idx) => {
        container.appendChild(document.createTextNode(line));
        if (idx < lines.length - 1) {
          container.appendChild(document.createElement('br'));
        }
      });
    }

    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }
    };
  }, [parsedText, isJson, isCode, language, jsonData, query, useRegex, app, highlightText, thoughts, thoughtsMeta, reasoningRecap]);

  return (
    <div className="aihp-message-content" style={{
      userSelect: 'text',
      WebkitUserSelect: 'text',
      MozUserSelect: 'text',
      msUserSelect: 'text',
      cursor: 'text'
    }}>
      <div 
        ref={containerRef}
        className="aihp-message-text"
        style={{
          userSelect: 'text',
          WebkitUserSelect: 'text',
          MozUserSelect: 'text',
          msUserSelect: 'text',
          cursor: 'text'
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







