// Quick-Test Wizard component
import React, { useState } from "react";
import type { PythonPipelineSettings, Source } from "../types";
import { isTestModeEnabled, getIngestLimits, getAnnotationLimit } from "../utils/testMode";
import { getSourceLabel, formatSourcePath } from "../utils/folderDiscovery";

interface TestWizardProps {
  settings: PythonPipelineSettings;
  sources: Source[];
  onTestSync: (sourceId: string) => Promise<void>;
  onTestAnnotate: () => Promise<void>;
  onTestExport: () => Promise<void>;
}

export function TestWizard({ settings, sources, onTestSync, onTestAnnotate, onTestExport }: TestWizardProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>(sources.length > 0 ? sources[0].id : '');
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [isRunning, setIsRunning] = useState(false);
  
  if (!isTestModeEnabled(settings)) {
    return null;
  }
  
  const limits = getIngestLimits(settings);
  const annotLimit = getAnnotationLimit(settings);
  
  const selectedSource = sources.find(s => s.id === selectedSourceId);
  const subfolders = selectedSource ? ((selectedSource as any).subfolders || []) : [];
  
  const handleTestSync = async () => {
    if (!selectedSourceId) return;
    setIsRunning(true);
    try {
      await onTestSync(selectedSourceId);
      setCurrentStep(2);
    } finally {
      setIsRunning(false);
    }
  };
  
  const handleTestAnnotate = async () => {
    setIsRunning(true);
    try {
      await onTestAnnotate();
      setCurrentStep(3);
    } finally {
      setIsRunning(false);
    }
  };
  
  const handleTestExport = async () => {
    setIsRunning(true);
    try {
      await onTestExport();
    } finally {
      setIsRunning(false);
    }
  };
  
  return (
    <div className="aip-test-wizard" style={{
      padding: '16px',
      background: 'var(--background-secondary)',
      borderRadius: '8px',
      marginTop: '16px',
      border: '1px solid var(--background-modifier-border)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <strong>🧪 Quick-Test Wizard</strong>
        <span style={{ fontSize: '0.85em', opacity: 0.7 }}>
          Step {currentStep} of 3
        </span>
      </div>
      
      {/* Step 1: Choose source and Test Sync */}
      {currentStep === 1 && (
        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            <strong>Step 1: Choose parent folder</strong>
            <span style={{ fontSize: '0.85em', opacity: 0.7, marginLeft: '8px' }}>
              (subfolders will be discovered automatically)
            </span>
          </label>
          <select
            value={selectedSourceId}
            onChange={e => setSelectedSourceId(e.target.value)}
            style={{ width: '100%', padding: '6px', marginBottom: '8px' }}
            disabled={isRunning || sources.length === 0}
          >
            {sources.map(s => {
              const label = s.label || getSourceLabel(s.root);
              const subCount = ((s as any).subfolders || []).length;
              return (
                <option key={s.id} value={s.id}>
                  {label} {subCount > 0 ? `(${subCount} subfolders)` : ''}
                </option>
              );
            })}
          </select>
          
          {/* Show discovered subfolders */}
          {selectedSource && subfolders.length > 0 && (
            <div style={{ 
              marginBottom: '8px', 
              padding: '8px', 
              background: 'var(--background-modifier-border)', 
              borderRadius: '4px',
              fontSize: '0.85em',
              maxHeight: '120px',
              overflowY: 'auto'
            }}>
              <strong>Discovered subfolders ({subfolders.length}):</strong>
              <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {subfolders.slice(0, 10).map((subfolder: string) => (
                  <span key={subfolder} style={{ 
                    padding: '2px 6px', 
                    background: 'var(--background-secondary)', 
                    borderRadius: '3px',
                    fontSize: '0.8em'
                  }}>
                    {formatSourcePath(subfolder)}
                  </span>
                ))}
                {subfolders.length > 10 && (
                  <span style={{ padding: '2px 6px', opacity: 0.7 }}>
                    +{subfolders.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}
          
          <button
            onClick={handleTestSync}
            disabled={isRunning || !selectedSourceId}
            style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
          >
            {isRunning ? 'Running Test Sync...' : `Run Test Sync (${limits.maxFiles} files, ${limits.maxConversations} conversations)`}
          </button>
          
          <div style={{ fontSize: '0.85em', opacity: 0.7, marginTop: '8px' }}>
            Parent folder: <code style={{ fontSize: '0.9em' }}>{selectedSource?.root || '—'}</code><br/>
            Limits: {limits.maxFiles} files, {limits.maxConversations} conversations
            {limits.sinceDays && `, last ${limits.sinceDays} days`}
            {subfolders.length > 0 && <><br/>Subfolders: {subfolders.length} discovered</>}
          </div>
        </div>
      )}
      
      {/* Step 2: Test Annotate */}
      {currentStep === 2 && (
        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            <strong>Step 2: (Optional) Test Annotate</strong>
          </label>
          <button
            onClick={handleTestAnnotate}
            disabled={isRunning}
            style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
          >
            {isRunning ? 'Running Test Annotate...' : `Run Test Annotate (${annotLimit} conversations)`}
          </button>
          <button
            onClick={() => setCurrentStep(3)}
            disabled={isRunning}
            style={{ width: '100%', padding: '6px', marginTop: '4px', background: 'transparent' }}
          >
            Skip to Export →
          </button>
        </div>
      )}
      
      {/* Step 3: Test Export */}
      {currentStep === 3 && (
        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            <strong>Step 3: Test Export to Staging</strong>
          </label>
          <button
            onClick={handleTestExport}
            disabled={isRunning}
            style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
          >
            {isRunning ? 'Exporting to Staging...' : 'Export to Staging'}
          </button>
          
          {!isRunning && (
            <div style={{ marginTop: '12px', padding: '8px', background: 'var(--background-modifier-border)', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.9em', marginBottom: '4px' }}>
                <strong>Results:</strong>
              </div>
              <div style={{ fontSize: '0.85em' }}>
                📁 <a href={`obsidian://open?path=${encodeURIComponent(settings.testMode!.stagingFolder)}/_Index.md`}>
                  Open: {settings.testMode!.stagingFolder}/_Index.md
                </a>
              </div>
              <div style={{ fontSize: '0.85em' }}>
                📂 <a href={`obsidian://open?path=${encodeURIComponent(settings.testMode!.stagingFolder)}`}>
                  Open: {settings.testMode!.stagingFolder}/ folder
                </a>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Guidance */}
      <div style={{ 
        marginTop: '12px', 
        padding: '8px', 
        background: 'var(--background-modifier-border)', 
        borderRadius: '4px',
        fontSize: '0.85em'
      }}>
        <strong>💡 Test Mode saves to {settings.testMode!.stagingFolder} and caps volume.</strong><br/>
        When satisfied: Turn Test Mode OFF → Run full Sync/Export → Rebuild Omnisearch index.
      </div>
    </div>
  );
}

