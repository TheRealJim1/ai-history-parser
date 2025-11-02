// Self-check panel component
import React from "react";
import type { SelfCheckResult } from "../utils/selfCheck";

interface SelfCheckPanelProps {
  result: SelfCheckResult | null;
  isLoading: boolean;
}

export function SelfCheckPanel({ result, isLoading }: SelfCheckPanelProps) {
  if (isLoading) {
    return (
      <div className="aip-self-check" style={{ padding: '12px', background: 'var(--background-secondary)', borderRadius: '6px', marginTop: '12px' }}>
        <strong>🔍 Running self-check...</strong>
      </div>
    );
  }
  
  if (!result) {
    return null;
  }
  
  function getStatusIcon(status: 'pass' | 'fail' | 'warn' | 'skip') {
    switch (status) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'warn': return '⚠️';
      case 'skip': return '➖';
    }
  }
  
  return (
    <div className="aip-self-check" style={{ padding: '12px', background: 'var(--background-secondary)', borderRadius: '6px', marginTop: '12px' }}>
      <strong style={{ display: 'block', marginBottom: '8px' }}>📊 Self-Check Results</strong>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '0.9em' }}>
        <div>
          {getStatusIcon(result.dbExists.status)} <strong>DB exists:</strong> {result.dbExists.message}
        </div>
        <div>
          {getStatusIcon(result.conversations.status)} <strong>Conversations:</strong> {result.conversations.message}
        </div>
        <div>
          {getStatusIcon(result.assetsLinked.status)} <strong>Assets linked:</strong> {result.assetsLinked.message}
        </div>
        <div>
          {getStatusIcon(result.annotations.status)} <strong>Annotations:</strong> {result.annotations.message}
        </div>
        <div>
          {getStatusIcon(result.freshRows.status)} <strong>Recent:</strong> {result.freshRows.message}
        </div>
        {result.topProviders.length > 0 && (
          <div>
            <strong>Top providers:</strong> {result.topProviders.map(p => `${p.name} (${p.count})`).join(', ')}
          </div>
        )}
      </div>
      
      {result.topEntities.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '0.85em' }}>
          <strong>Top entities:</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {result.topEntities.map((e, i) => (
              <span key={i} style={{ padding: '2px 6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }}>
                {e.name} ({e.count}) <span style={{ opacity: 0.6 }}>{e.category}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

