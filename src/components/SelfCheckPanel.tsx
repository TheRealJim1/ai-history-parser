// Self-check panel component
import React, { useState } from "react";
import type { SelfCheckResult } from "../utils/selfCheck";

interface SelfCheckPanelProps {
  result: SelfCheckResult | null;
  isLoading: boolean;
}

// Tooltip component for metric descriptions
function MetricTooltip({ children, description }: { children: React.ReactNode; description: string }) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <span
      style={{ position: 'relative', cursor: 'help' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {children}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '8px 12px',
            background: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            fontSize: '11px',
            lineHeight: '1.5',
            color: 'var(--text-normal)',
            whiteSpace: 'pre-wrap',
            maxWidth: '300px',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          {description}
          <div
            style={{
              position: 'absolute',
              bottom: '-5px',
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              width: '10px',
              height: '10px',
              background: 'var(--background-primary)',
              borderRight: '1px solid var(--background-modifier-border)',
              borderBottom: '1px solid var(--background-modifier-border)'
            }}
          />
        </div>
      )}
    </span>
  );
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
  
  // Metric descriptions explaining how each number is calculated
  const metricDescriptions = {
    conversations: `Total number of conversations in the database.\n\nCalculated from: SELECT COUNT(*) FROM conversations (or 'conversation' for v1 schema)`,
    messages: `Total number of messages across all conversations.\n\nCalculated from: SELECT COUNT(*) FROM messages (or 'message' for v1 schema)`,
    treeNodes: `Total number of tree nodes in conversations.\n\nCalculated from: SELECT COUNT(*) FROM conversation_nodes\n\nEach node represents a point in the conversation tree structure.`,
    rootNodes: `Number of root nodes (starting points) in conversation trees.\n\nCalculated from: SELECT COUNT(*) FROM conversation_nodes WHERE is_root = 1\n\nRoot nodes are the first messages in each conversation branch.`,
    branchPoints: `Number of branch points where conversations split into multiple paths.\n\nCalculated from: SELECT COUNT(*) FROM conversation_nodes WHERE is_branch_point = 1\n\nBranch points occur when a message has multiple children (multiple responses).`,
    maxDepth: `Maximum tree depth across all conversations.\n\nCalculated from: SELECT MAX(depth) FROM conversation_nodes\n\nDepth represents how many levels deep a node is from the root (root = 0).`,
    avgDepth: `Average tree depth across all nodes.\n\nCalculated from: SELECT AVG(depth) FROM conversation_nodes\n\nShows the typical depth of conversation threads.`,
    deepestDepth: `Maximum depth in the deepest conversation tree.\n\nFound by: SELECT conversation_id, MAX(depth) FROM conversation_nodes GROUP BY conversation_id ORDER BY MAX(depth) DESC LIMIT 1\n\nShows the conversation with the longest thread path.`,
    outlierIds: `Number of messages containing extracted Outlier IDs.\n\nExtracted using regex patterns: "Outlier ID[:\\s=]+(\\w+)", "OUTLIERID[:\\s=]+(\\w+)", "BOTPROCESSID[:\\s=]+(\\w+)"\n\nStored in: outlier_ids table`,
    fullTextSearch: `Number of messages indexed for full-text search.\n\nCalculated from: SELECT COUNT(*) FROM messages_fts (or message_fts)\n\nFTS5 enables fast text search across message content.`,
    assetsLinked: `Total number of assets/attachments linked to messages.\n\nChecked from: message_asset, attachments, or attachments_ext tables\n\nAssets include images, files, and other media referenced in conversations.`,
    annotations: `Number of conversations with AI-generated annotations.\n\nCalculated from: SELECT COUNT(*) FROM conversation_annotation\n\nPLANNED FEATURE: Annotations are AI-generated metadata (not from ChatGPT JSON exports) that enrich conversations with:\n• Summary: AI-generated conversation summaries\n• Tags: Auto-extracted topic tags (JSON array)\n• Topics: Main themes/subjects (JSON array)\n• Entities: Named entities (person, org, tech, etc.) as JSON\n• Sentiment: Overall conversation sentiment\n• Risk Flags: Important warnings or concerns (JSON array)\n\nGeneration: A Python annotation script will use LLM APIs (OpenAI, Ollama, etc.) to analyze conversation content and populate the conversation_annotation table. This enables advanced filtering, search, and insights beyond raw message content.\n\nTable Schema (planned):\nconversation_annotation (\n  conversation_id TEXT PRIMARY KEY,\n  summary TEXT,\n  tags_json TEXT,\n  topics_json TEXT,\n  entities JSON,\n  sentiment TEXT,\n  risk_flags JSON,\n  updated_at TEXT\n)`,
    freshRows: `Number of conversations created or updated in the last 3 days.\n\nCalculated from: SELECT COUNT(*) FROM conversations WHERE created_at >= ? OR updated_at >= ?\n\nShows recent activity in the database.`,
    importErrors: `Total number of import errors logged.\n\nFrom: SELECT COUNT(*) FROM import_errors\n\nErrors occur when parsing JSON/HTML files fails.`,
    recentErrors: `Import errors from the last 7 days.\n\nCalculated from: SELECT COUNT(*) FROM import_errors WHERE timestamp >= datetime('now', '-7 days')\n\nShows recent import issues.`,
    nodesWithMessages: `Number of tree nodes that have associated messages.\n\nCalculated from: SELECT COUNT(*) FROM conversation_nodes WHERE message_id IS NOT NULL\n\nSome nodes may exist without messages (structural nodes).`,
    nodesWithoutMessages: `Number of tree nodes without associated messages.\n\nCalculated as: total_nodes - nodes_with_messages\n\nThese are structural nodes in the tree hierarchy.`
  };
  
  return (
    <div className="aip-self-check" style={{ padding: '12px', background: 'var(--background-secondary)', borderRadius: '6px', marginTop: '12px' }}>
      <strong style={{ display: 'block', marginBottom: '8px' }}>📊 Self-Check Results</strong>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '0.9em' }}>
        <div>
          {getStatusIcon(result.dbExists.status)} <strong>DB exists:</strong> {result.dbExists.message}
        </div>
        <div>
          {getStatusIcon(result.conversations.status)} <strong>Conversations:</strong>{' '}
          <MetricTooltip description={metricDescriptions.conversations}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.conversations.message}
            </span>
          </MetricTooltip>
        </div>
        <div>
          {getStatusIcon(result.messages.status)} <strong>Messages:</strong>{' '}
          <MetricTooltip description={metricDescriptions.messages}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.messages.message}
            </span>
          </MetricTooltip>
        </div>
        {result.treeStructure.status !== 'skip' && (
          <div>
            {getStatusIcon(result.treeStructure.status)} <strong>Tree Structure:</strong>{' '}
            <MetricTooltip description={`${metricDescriptions.treeNodes}\n\nSchema: ${result.treeStructure.schema || 'unknown'}`}>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                {result.treeStructure.message}
              </span>
            </MetricTooltip>
          </div>
        )}
        {result.treeStructure.status === 'pass' && result.treeStructure.branchPoints !== undefined && (
          <div style={{ gridColumn: '1 / -1', fontSize: '0.85em', opacity: 0.8, marginTop: '4px' }}>
            • <MetricTooltip description={metricDescriptions.rootNodes}>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
                {result.treeStructure.rootNodes} root nodes
              </span>
            </MetricTooltip>
            {' '}• <MetricTooltip description={metricDescriptions.branchPoints}>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
                {result.treeStructure.branchPoints} branch points
              </span>
            </MetricTooltip>
            {' '}• Avg depth:{' '}
            <MetricTooltip description={metricDescriptions.avgDepth}>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
                {result.treeStructure.avgDepth}
              </span>
            </MetricTooltip>
            {result.treeStructure.deepestDepth && result.treeStructure.deepestDepth > 100 && (
              <>
                {' '}• Deepest:{' '}
                <MetricTooltip description={metricDescriptions.deepestDepth}>
                  <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
                    {result.treeStructure.deepestDepth} levels
                  </span>
                </MetricTooltip>
              </>
            )}
          </div>
        )}
        <div>
          {getStatusIcon(result.outlierIds.status)} <strong>Outlier IDs:</strong>{' '}
          <MetricTooltip description={metricDescriptions.outlierIds}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.outlierIds.message}
            </span>
          </MetricTooltip>
        </div>
        <div>
          {getStatusIcon(result.fullTextSearch.status)} <strong>Full-Text Search:</strong>{' '}
          <MetricTooltip description={metricDescriptions.fullTextSearch}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.fullTextSearch.message}
            </span>
          </MetricTooltip>
        </div>
        <div>
          {getStatusIcon(result.assetsLinked.status)} <strong>Assets linked:</strong>{' '}
          <MetricTooltip description={metricDescriptions.assetsLinked}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.assetsLinked.message}
            </span>
          </MetricTooltip>
        </div>
        <div>
          {getStatusIcon(result.annotations.status)} <strong>Annotations:</strong>{' '}
          <MetricTooltip description={metricDescriptions.annotations}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.annotations.message}
            </span>
          </MetricTooltip>
        </div>
        <div>
          {getStatusIcon(result.freshRows.status)} <strong>Recent:</strong>{' '}
          <MetricTooltip description={metricDescriptions.freshRows}>
            <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {result.freshRows.message}
            </span>
          </MetricTooltip>
        </div>
        {result.importErrors.status !== 'skip' && (
          <div>
            {getStatusIcon(result.importErrors.status)} <strong>Import Errors:</strong>{' '}
            <MetricTooltip description={`${metricDescriptions.importErrors}\n\nRecent (7 days): ${metricDescriptions.recentErrors}`}>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                {result.importErrors.message}
              </span>
            </MetricTooltip>
          </div>
        )}
        {result.topProviders.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <strong>Top providers:</strong>{' '}
            {result.topProviders.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && ', '}
                <MetricTooltip description={`Number of conversations from provider "${p.name}"\n\nCalculated from: SELECT provider, COUNT(*) FROM conversations GROUP BY provider ORDER BY COUNT(*) DESC`}>
                  <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
                    {p.name} ({p.count})
                  </span>
                </MetricTooltip>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      
      {result.topEntities.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '0.85em' }}>
          <strong>Top entities:</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {result.topEntities.map((e, i) => (
              <MetricTooltip 
                key={i} 
                description={`Entity "${e.name}" appears in ${e.count} annotated conversation${e.count !== 1 ? 's' : ''}.\n\nCategory: ${e.category}\n\nExtracted from: conversation_annotation.entities JSON field\n\nTop entities are calculated from the first 50 annotated conversations, counting occurrences of each entity name by category.`}
              >
                <span 
                  style={{ 
                    padding: '2px 6px', 
                    background: 'var(--background-modifier-border)', 
                    borderRadius: '3px',
                    textDecoration: 'underline',
                    textDecorationStyle: 'dotted',
                    cursor: 'help'
                  }}
                >
                  {e.name} ({e.count}) <span style={{ opacity: 0.6 }}>{e.category}</span>
                </span>
              </MetricTooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



