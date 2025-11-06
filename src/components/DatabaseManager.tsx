import React, { useState, useEffect } from 'react';
import { Modal, Notice, TAbstractFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type AIHistoryParser from '../main';

interface SchemaType {
  id: string;
  name: string;
  description: string;
  script: string;
}

interface ImportProgress {
  currentFile: string;
  totalFiles: number;
  processedFiles: number;
  conversationsAdded: number;
  messagesAdded: number;
  errors: string[];
}

interface DatabaseManagerProps {
  plugin: AIHistoryParser;
  app: App;
  onClose: () => void;
}

const SCHEMA_TYPES: SchemaType[] = [
  {
    id: 'clean',
    name: 'Clean Schema (CLI Checklist)',
    description: 'Normalized schema with FTS5, follows CLI checklist best practices',
    script: 'create_clean_database_complete.py'
  },
  {
    id: 'v2_tree',
    name: 'V2 Tree Schema',
    description: 'Schema with conversation_nodes for tree structure',
    script: 'ai_history_to_sqlite.py'
  }
];

export const DatabaseManager: React.FC<DatabaseManagerProps> = ({ plugin, app, onClose }) => {
  const [selectedSchema, setSelectedSchema] = useState<string>('clean');
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [dbPath, setDbPath] = useState<string>(plugin.settings.pythonPipeline?.dbPath || '');
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [step, setStep] = useState<'schema' | 'folders' | 'import' | 'complete'>('schema');
  const [mode, setMode] = useState<'import' | 'backup'>('import');
  
  // Backup/Restore state
  const [backups, setBackups] = useState<string[]>([]);
  const [backupDescription, setBackupDescription] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<string>('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Get available folders from vault
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);

  useEffect(() => {
    // Scan for backup folders in AI Exports/ChatGPT
    const scanFolders = async () => {
      const folders: string[] = [];
      const vault = app.vault;
      
      // Try to find AI Exports/ChatGPT folder
      const exportPath = "AI Exports/ChatGPT";
      const vaultBasePath = (app.vault.adapter as any).basePath || '';
      const fullPath = vaultBasePath ? `${vaultBasePath}/${exportPath}`.replace(/\\/g, '/') : exportPath;
      
      // Check if we can access the folder
      try {
        const fs = require('fs');
        const path = require('path');
        
        if (fs.existsSync(fullPath)) {
          const dirs = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const dir of dirs) {
            if (dir.isDirectory() && dir.name.includes('conversations.json')) {
              // Check if folder contains conversations.json
              const convJsonPath = path.join(fullPath, dir.name, 'conversations.json');
              if (fs.existsSync(convJsonPath)) {
                folders.push(`${exportPath}/${dir.name}`);
              }
            } else if (dir.isDirectory()) {
              // Check if it's a backup folder (has conversations.json)
              const convJsonPath = path.join(fullPath, dir.name, 'conversations.json');
              if (fs.existsSync(convJsonPath)) {
                folders.push(`${exportPath}/${dir.name}`);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Could not scan backup folders:', e);
      }
      
      // Also check settings for recent folders
      if (plugin.settings.recentFolders) {
        plugin.settings.recentFolders.forEach(folder => {
          if (!folders.includes(folder)) {
            folders.push(folder);
          }
        });
      }
      
      setAvailableFolders(folders.sort());
    };
    
    scanFolders();
  }, [app, plugin]);

  // Load backups list
  useEffect(() => {
    if (mode === 'backup') {
      loadBackups();
    }
  }, [mode]);

  const loadBackups = async () => {
    try {
      const { spawn } = require('child_process');
      const { pythonPipeline } = plugin.settings;
      const pythonExec = pythonPipeline?.pythonExecutable || 'python';
      const scriptsRoot = pythonPipeline?.scriptsRoot || (app.vault.adapter as any).basePath;
      const scriptPath = `${scriptsRoot}/backup_database.py`;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, [scriptPath, 'list', '--dir', 'backups'], {
          cwd: scriptsRoot,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            // Parse backup list from output
            const lines = stdout.split('\n');
            const backupList: string[] = [];
            let currentBackup = '';
            for (const line of lines) {
              if (line.trim().match(/^\d+\./)) {
                // New backup entry
                if (currentBackup) {
                  backupList.push(currentBackup);
                }
                currentBackup = line.trim().replace(/^\d+\.\s+/, '');
              }
            }
            if (currentBackup) {
              backupList.push(currentBackup);
            }
            setBackups(backupList);
            resolve();
          } else {
            console.warn('Could not load backups:', stderr);
            setBackups([]);
            resolve(); // Don't reject, just show empty list
          }
        });
      });
    } catch (e) {
      console.warn('Error loading backups:', e);
      setBackups([]);
    }
  };

  const handleBackup = async () => {
    if (!dbPath) {
      new Notice('Please enter a database path');
      return;
    }

    setIsBackingUp(true);
    try {
      const { spawn } = require('child_process');
      const { pythonPipeline } = plugin.settings;
      const pythonExec = pythonPipeline?.pythonExecutable || 'python';
      const scriptsRoot = pythonPipeline?.scriptsRoot || (app.vault.adapter as any).basePath;
      const scriptPath = `${scriptsRoot}/backup_database.py`;

      const args = [
        scriptPath,
        'backup',
        dbPath,
        '--dir', 'backups'
      ];
      
      if (backupDescription) {
        args.push('--desc', backupDescription);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, args, {
          cwd: scriptsRoot,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            new Notice('Backup created successfully!');
            setBackupDescription('');
            loadBackups();
            resolve();
          } else {
            new Notice(`Backup failed: ${stderr || 'Unknown error'}`);
            reject(new Error(stderr));
          }
        });
      });
    } catch (error: any) {
      new Notice(`Backup failed: ${error.message}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) {
      new Notice('Please select a backup to restore');
      return;
    }

    if (!dbPath) {
      new Notice('Please enter a target database path');
      return;
    }

    const confirmed = confirm(`Are you sure you want to restore from this backup?\n\nThis will overwrite: ${dbPath}\n\nA backup of the current database will be created first.`);
    if (!confirmed) {
      return;
    }

    setIsRestoring(true);
    try {
      const { spawn } = require('child_process');
      const { pythonPipeline } = plugin.settings;
      const pythonExec = pythonPipeline?.pythonExecutable || 'python';
      const scriptsRoot = pythonPipeline?.scriptsRoot || (app.vault.adapter as any).basePath;
      const scriptPath = `${scriptsRoot}/backup_database.py`;
      const backupPath = `backups/${selectedBackup}`;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, [scriptPath, 'restore', backupPath, dbPath, '--force'], {
          cwd: scriptsRoot,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            new Notice('Database restored successfully!');
            // Update settings
            plugin.settings.pythonPipeline = {
              ...plugin.settings.pythonPipeline,
              dbPath: dbPath
            };
            plugin.saveSettings();
            onClose(); // Close modal and refresh
            resolve();
          } else {
            new Notice(`Restore failed: ${stderr || 'Unknown error'}`);
            reject(new Error(stderr));
          }
        });
      });
    } catch (error: any) {
      new Notice(`Restore failed: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleSchemaSelect = (schemaId: string) => {
    setSelectedSchema(schemaId);
  };

  const handleFolderToggle = (folder: string) => {
    setSelectedFolders(prev => 
      prev.includes(folder)
        ? prev.filter(f => f !== folder)
        : [...prev, folder]
    );
  };

  const handleNextStep = () => {
    if (step === 'schema') {
      if (!selectedSchema) {
        new Notice('Please select a schema type');
        return;
      }
      setStep('folders');
    } else if (step === 'folders') {
      if (selectedFolders.length === 0) {
        new Notice('Please select at least one folder');
        return;
      }
      if (!dbPath) {
        new Notice('Please enter a database path');
        return;
      }
      setStep('import');
      startImport();
    }
  };

  const handleBackStep = () => {
    if (step === 'folders') {
      setStep('schema');
    } else if (step === 'import') {
      setStep('folders');
      setIsImporting(false);
      setProgress(null);
    }
  };

  const startImport = async () => {
    setIsImporting(true);
    setProgress({
      currentFile: '',
      totalFiles: 0,
      processedFiles: 0,
      conversationsAdded: 0,
      messagesAdded: 0,
      errors: []
    });

    const schema = SCHEMA_TYPES.find(s => s.id === selectedSchema);
    if (!schema) {
      new Notice('Invalid schema selected');
      setIsImporting(false);
      return;
    }

    const { pythonPipeline } = plugin.settings;
    const pythonExec = pythonPipeline?.pythonExecutable || 'python';
    const scriptsRoot = pythonPipeline?.scriptsRoot || (app.vault.adapter as any).basePath;
    const scriptPath = `${scriptsRoot}/${schema.script}`;

    try {
      const { spawn } = require('child_process');
      const path = require('path');
      const fs = require('fs');

      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`Script not found: ${scriptPath}`);
      }

      // Process folders one by one
      for (let i = 0; i < selectedFolders.length; i++) {
        const folder = selectedFolders[i];
        const fullFolderPath = path.join((app.vault.adapter as any).basePath, folder);

        setProgress(prev => prev ? {
          ...prev,
          currentFile: folder,
          processedFiles: i
        } : null);

        // Build command based on schema
        let args: string[];
        if (schema.id === 'clean') {
          args = [
            scriptPath,
            '--db', dbPath,
            '--source', fullFolderPath,
            ...(i === 0 ? ['--force'] : []) // Force overwrite on first folder
          ];
        } else {
          // v2_tree schema uses different arguments
          args = [
            scriptPath,
            '--db', dbPath,
            '--root', fullFolderPath
          ];
        }

        // Execute import
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(pythonExec, args, {
            cwd: scriptsRoot,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = '';
          let stderr = '';

          proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
            // Parse progress from output
            const lines = stdout.split('\n');
            for (const line of lines) {
              if (line.includes('conversations') && line.includes('messages')) {
                const match = line.match(/(\d+)\s+conversations.*?(\d+)\s+messages/);
                if (match) {
                  setProgress(prev => prev ? {
                    ...prev,
                    conversationsAdded: prev.conversationsAdded + parseInt(match[1]),
                    messagesAdded: prev.messagesAdded + parseInt(match[2])
                  } : null);
                }
              }
            }
          });

          proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          proc.on('close', (code: number) => {
            if (code === 0) {
              resolve();
            } else {
              setProgress(prev => prev ? {
                ...prev,
                errors: [...prev.errors, `${folder}: ${stderr || 'Import failed'}`]
              } : null);
              reject(new Error(`Import failed for ${folder}: ${stderr}`));
            }
          });
        });

        // Small delay between folders
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Update database path in settings
      plugin.settings.pythonPipeline = {
        ...plugin.settings.pythonPipeline,
        dbPath: dbPath
      };
      await plugin.saveSettings();

      setStep('complete');
      new Notice('Database import completed successfully!');
    } catch (error: any) {
      new Notice(`Import failed: ${error.message}`);
      setProgress(prev => prev ? {
        ...prev,
        errors: [...prev.errors, error.message]
      } : null);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div style={{
      padding: '20px',
      maxWidth: '800px',
      margin: '0 auto',
      color: 'var(--text-normal)'
    }}>
      <h2 style={{ marginTop: 0 }}>Database Manager</h2>

      {/* Mode Selector */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        borderBottom: '1px solid var(--background-modifier-border)',
        paddingBottom: '12px'
      }}>
        <button
          onClick={() => setMode('import')}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: mode === 'import' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
            color: mode === 'import' ? 'var(--text-on-accent)' : 'var(--text-normal)',
            cursor: 'pointer',
            fontWeight: mode === 'import' ? '600' : '400'
          }}
        >
          Import
        </button>
        <button
          onClick={() => setMode('backup')}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: mode === 'backup' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
            color: mode === 'backup' ? 'var(--text-on-accent)' : 'var(--text-normal)',
            cursor: 'pointer',
            fontWeight: mode === 'backup' ? '600' : '400'
          }}
        >
          Backup & Restore
        </button>
      </div>

      {/* Backup/Restore Mode */}
      {mode === 'backup' && (
        <div>
          <h3>Backup & Restore</h3>

          {/* Create Backup */}
          <div style={{
            padding: '16px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <h4 style={{ marginTop: 0 }}>Create Backup</h4>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Database Path:
              </label>
              <input
                type="text"
                value={dbPath}
                onChange={(e) => setDbPath(e.target.value)}
                placeholder="C:\Dev\ai-history-parser\chatgpt_clean.db"
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--background-modifier-border)',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--text-normal)'
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Description (optional):
              </label>
              <input
                type="text"
                value={backupDescription}
                onChange={(e) => setBackupDescription(e.target.value)}
                placeholder="e.g., folders_1_6_clean_schema"
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--background-modifier-border)',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--text-normal)'
                }}
              />
            </div>
            <button
              onClick={handleBackup}
              disabled={isBackingUp || !dbPath}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'var(--interactive-accent)',
                color: 'var(--text-on-accent)',
                cursor: (isBackingUp || !dbPath) ? 'not-allowed' : 'pointer',
                opacity: (isBackingUp || !dbPath) ? 0.6 : 1
              }}
            >
              {isBackingUp ? 'Creating Backup...' : 'Create Backup'}
            </button>
          </div>

          {/* Restore from Backup */}
          <div style={{
            padding: '16px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '8px'
          }}>
            <h4 style={{ marginTop: 0 }}>Restore from Backup</h4>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Target Database Path:
              </label>
              <input
                type="text"
                value={dbPath}
                onChange={(e) => setDbPath(e.target.value)}
                placeholder="C:\Dev\ai-history-parser\chatgpt_clean.db"
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--background-modifier-border)',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--text-normal)'
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Available Backups:
              </label>
              <div style={{
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '4px',
                padding: '8px'
              }}>
                {backups.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>
                    No backups found. Create a backup first.
                  </div>
                ) : (
                  backups.map(backup => (
                    <label
                      key={backup}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        backgroundColor: selectedBackup === backup ? 'var(--background-modifier-hover)' : 'transparent'
                      }}
                    >
                      <input
                        type="radio"
                        name="backup"
                        checked={selectedBackup === backup}
                        onChange={() => setSelectedBackup(backup)}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ fontSize: '12px' }}>{backup}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <button
              onClick={handleRestore}
              disabled={isRestoring || !selectedBackup || !dbPath}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'var(--interactive-accent)',
                color: 'var(--text-on-accent)',
                cursor: (isRestoring || !selectedBackup || !dbPath) ? 'not-allowed' : 'pointer',
                opacity: (isRestoring || !selectedBackup || !dbPath) ? 0.6 : 1
              }}
            >
              {isRestoring ? 'Restoring...' : 'Restore from Backup'}
            </button>
          </div>
        </div>
      )}

      {/* Import Mode */}
      {mode === 'import' && (
        <>
      {/* Step 1: Select Schema */}
      {step === 'schema' && (
        <div>
          <h3>Step 1: Select Schema Type</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Choose the database schema you want to use for this import.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {SCHEMA_TYPES.map(schema => (
              <div
                key={schema.id}
                onClick={() => handleSchemaSelect(schema.id)}
                style={{
                  padding: '16px',
                  border: `2px solid ${selectedSchema === schema.id ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: selectedSchema === schema.id ? 'var(--background-modifier-hover)' : 'transparent',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {schema.name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {schema.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Select Folders */}
      {step === 'folders' && (
        <div>
          <h3>Step 2: Select Folders to Import</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Select one or more folders containing conversation exports.
          </p>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Database Path:
            </label>
            <input
              type="text"
              value={dbPath}
              onChange={(e) => setDbPath(e.target.value)}
              placeholder="C:\Dev\ai-history-parser\chatgpt_clean.db"
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid var(--background-modifier-border)',
                backgroundColor: 'var(--background-primary)',
                color: 'var(--text-normal)'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ marginBottom: '12px', fontWeight: '500' }}>
              Available Folders ({selectedFolders.length} selected):
            </div>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '4px',
              padding: '8px'
            }}>
              {availableFolders.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>
                  No folders found. Add folders manually or check your vault.
                </div>
              ) : (
                availableFolders.map(folder => (
                  <label
                    key={folder}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      backgroundColor: selectedFolders.includes(folder) ? 'var(--background-modifier-hover)' : 'transparent'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFolders.includes(folder)}
                      onChange={() => handleFolderToggle(folder)}
                      style={{ marginRight: '8px' }}
                    />
                    <span>{folder}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Import Progress */}
      {step === 'import' && progress && (
        <div>
          <h3>Step 3: Importing...</h3>
          
          <div style={{
            padding: '16px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Processing: {progress.currentFile || 'Initializing...'}</span>
                <span>{progress.processedFiles} / {selectedFolders.length} folders</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'var(--background-modifier-border)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${(progress.processedFiles / selectedFolders.length) * 100}%`,
                  height: '100%',
                  backgroundColor: 'var(--interactive-accent)',
                  transition: 'width 0.3s'
                }} />
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              <div>Conversations: {progress.conversationsAdded.toLocaleString()}</div>
              <div>Messages: {progress.messagesAdded.toLocaleString()}</div>
            </div>

            {progress.errors.length > 0 && (
              <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'var(--background-modifier-error)', borderRadius: '4px' }}>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>Errors:</div>
                {progress.errors.map((error, i) => (
                  <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{error}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && (
        <div>
          <h3>✅ Import Complete!</h3>
          <p style={{ color: 'var(--text-muted)' }}>
            Database has been created and populated successfully.
          </p>
          {progress && (
            <div style={{ marginTop: '16px' }}>
              <div>Total Conversations: {progress.conversationsAdded.toLocaleString()}</div>
              <div>Total Messages: {progress.messagesAdded.toLocaleString()}</div>
            </div>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
        <div>
          {step !== 'schema' && (
            <button
              onClick={handleBackStep}
              disabled={isImporting}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid var(--background-modifier-border)',
                backgroundColor: 'var(--background-primary)',
                color: 'var(--text-normal)',
                cursor: isImporting ? 'not-allowed' : 'pointer'
              }}
            >
              Back
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {step !== 'complete' && step !== 'import' && (
            <button
              onClick={handleNextStep}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'var(--interactive-accent)',
                color: 'var(--text-on-accent)',
                cursor: 'pointer'
              }}
            >
              Next
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isImporting}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              backgroundColor: 'var(--background-primary)',
              color: 'var(--text-normal)',
              cursor: isImporting ? 'not-allowed' : 'pointer'
            }}
          >
            {step === 'complete' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

