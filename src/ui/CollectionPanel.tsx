import React, { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { Notice } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import { runPythonJson } from "../utils/scriptRunner";
import { resolveVaultPath } from "../settings";

export interface CollectionTOCItem {
  title: string;
  anchor?: string;
  level: number;
}

export interface Collection {
  id: string;
  label: string;
  content: string;
  createdAt: number;
  itemCount: number;
  tags?: string[];
  template?: string;
  color?: string;
  summary?: string;
  tableOfContents?: CollectionTOCItem[];
  enrichedAt?: number;
  enrichModel?: string;  // Model used for AI enrichment
  enrichDuration?: number;  // Duration in seconds
  generatedTitle?: string;  // AI-generated title
  savedVersions?: CollectionVersion[];  // History of saved versions
}

export interface CollectionVersion {
  id: string;
  timestamp: number;
  label: string;
  content: string;
  tags?: string[];
  summary?: string;
  itemCount: number;
}

const slugifyTitle = (title: string): string => title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

// Helper to determine if text should be white or black based on background color
const getContrastColor = (hexColor: string): 'white' | 'black' => {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'black' : 'white';
};

// Context for sharing collection state across components
interface CollectionContextType {
  collections: Collection[];
  addToCollection: (collectionId: string, text: string, append?: boolean) => void;
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  usingDatabase: boolean;
  refreshCollections?: () => Promise<void>;
}

const CollectionContext = createContext<CollectionContextType | null>(null);

export const useCollectionPanel = () => {
  const context = useContext(CollectionContext);
  if (!context) {
    const [collections, setCollections] = useState<Collection[]>([]);
    const addToCollection = useCallback((collectionId: string, text: string, append: boolean = true) => {
      setCollections(prev => prev.map(coll => {
        if (coll.id === collectionId) {
          const newContent = append 
            ? (coll.content ? coll.content + '\n\n---\n\n' + text : text)
            : text;
          const lines = newContent.split('\n').filter(l => l.trim().length > 0);
          return {
            ...coll,
            content: newContent,
            itemCount: lines.length
          };
        }
        return coll;
      }));
    }, []);
    return { collections, addToCollection, setCollections, usingDatabase: false };
  }
  return context;
};

interface CollectionProviderProps {
  plugin: any;
  children: React.ReactNode;
}

// Provider component
export const CollectionProvider: React.FC<CollectionProviderProps> = ({ plugin, children }) => {
  const [collections, setCollections] = useState<Collection[]>(() => {
    try {
      const saved = localStorage.getItem('aihp-collections');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('[Collections] Failed to load from localStorage:', e);
    }
    return [];
  });
  const [usingDatabase, setUsingDatabase] = useState(false);
  const prevSerializedRef = useRef<Map<string, string>>(new Map());
  const collectionsRef = useRef<Collection[]>(collections);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    collectionsRef.current = collections;
  }, [collections]);

  // Extract load function so it can be reused for refresh - MUST be outside useEffect
  const loadFromDatabase = useCallback(async () => {
    try {
      // Double-check plugin is ready
      if (!plugin || !plugin.settings) {
        console.warn('[Collections] Plugin still not ready after delay');
        setUsingDatabase(false);
        return;
      }

      const pipeline = plugin.settings.pythonPipeline;
      if (!pipeline?.dbPath || !pipeline?.scriptsRoot || !pipeline?.pythonExecutable) {
        setUsingDatabase(false);
        return;
      }

      // Use async file checks with timeout
      const checkFile = (filePath: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 1000);
          try {
            const exists = fs.existsSync(filePath);
            clearTimeout(timeout);
            resolve(exists);
          } catch {
            clearTimeout(timeout);
            resolve(false);
          }
        });
      };

      const scriptPath = path.join(pipeline.scriptsRoot, 'collection_store.py');
      const scriptExists = await checkFile(scriptPath);
      if (!scriptExists) {
        console.warn('[Collections] collection_store.py not found at', scriptPath);
        setUsingDatabase(false);
        return;
      }

      if (!plugin.app || !plugin.app.vault || !plugin.app.vault.adapter) {
        console.warn('[Collections] Plugin app not ready');
        setUsingDatabase(false);
        return;
      }
      const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
      const dbPath = resolveVaultPath(pipeline.dbPath, vaultBasePath);
      const dbExists = await checkFile(dbPath);
      if (!dbExists) {
        console.warn('[Collections] Database not found at', dbPath);
        setUsingDatabase(false);
        return;
      }

      // Add timeout to Python script execution
      const loadPromise = runPythonJson<{ collections: any[] }>([
        pipeline.pythonExecutable || 'python',
        scriptPath,
        '--db',
        dbPath,
        '--action',
        'list'
      ]);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database load timeout')), 5000);
      });

      const result = await Promise.race([loadPromise, timeoutPromise]);

      const mapped = (result.collections || []).map((item) => {
        const content = item.content || '';
        const itemCount = content.split('\n').filter((l: string) => l.trim().length > 0).length;
        return {
          id: item.id,
          label: item.label || 'Untitled Collection',
          content,
          color: item.color || undefined,
          tags: Array.isArray(item.tags) ? item.tags : (item.tags ? item.tags : []),
          summary: item.summary || '',
          tableOfContents: Array.isArray(item.tableOfContents) ? item.tableOfContents : (item.tableOfContents || []),
          enrichedAt: item.enrichedAt || item.enriched_at || null,
          createdAt: item.createdAt || item.created_at || Date.now(),
          updatedAt: item.updatedAt || item.updated_at || Date.now(),
          itemCount
        } as Collection;
      });

      setCollections(mapped);
      const map = new Map<string, string>();
      mapped.forEach(coll => {
        map.set(coll.id, JSON.stringify({
          id: coll.id,
          label: coll.label,
          content: coll.content,
          color: coll.color || null,
          tags: coll.tags || [],
          summary: coll.summary || '',
          tableOfContents: coll.tableOfContents || [],
          enrichedAt: coll.enrichedAt || null,
          createdAt: coll.createdAt || Date.now()
        }));
      });
      prevSerializedRef.current = map;
      setUsingDatabase(true);
    } catch (error) {
      console.error('[Collections] Failed to load from database:', error);
      setUsingDatabase(false);
      // Fallback to localStorage if database fails
      try {
        const saved = localStorage.getItem('aihp-collections');
        if (saved) {
          const localCollections = JSON.parse(saved);
          setCollections(localCollections);
        }
      } catch (e) {
        console.error('[Collections] Failed to load from localStorage:', e);
      }
      throw error; // Re-throw so caller can handle it
    }
  }, [plugin]);

  useEffect(() => {
    // Defer ALL initialization to avoid blocking Obsidian startup
    // Check if plugin is ready first
    if (!plugin || !plugin.settings) {
      console.warn('[Collections] Plugin not ready, skipping initialization');
      return;
    }

    const timeoutId = setTimeout(() => {
      void loadFromDatabase();
    }, 1000); // Defer by 1 second to let Obsidian finish loading

    return () => clearTimeout(timeoutId);
  }, [plugin, loadFromDatabase]);

  const persistCollections = useCallback(async () => {
    if (!usingDatabase) return;
    if (!plugin || !plugin.settings) {
      console.warn('[Collections] Plugin not ready, cannot persist');
      return;
    }
    const pipeline = plugin.settings.pythonPipeline;
    if (!pipeline?.dbPath || !pipeline?.scriptsRoot || !pipeline?.pythonExecutable) {
      return;
    }

    const scriptPath = path.join(pipeline.scriptsRoot, 'collection_store.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('[Collections] collection_store.py not found at', scriptPath);
      setUsingDatabase(false);
      return;
    }
    if (!plugin.app || !plugin.app.vault || !plugin.app.vault.adapter) {
      console.warn('[Collections] Plugin app not ready for persistence');
      return;
    }
    const vaultBasePath = (plugin.app.vault.adapter as any).basePath || '';
    const dbPath = resolveVaultPath(pipeline.dbPath, vaultBasePath);
    if (!fs.existsSync(dbPath)) {
      console.warn('[Collections] Database not found at', dbPath);
      setUsingDatabase(false);
      return;
    }

    const prevMap = prevSerializedRef.current;
    const nextMap = new Map<string, string>();
    const toUpsert: any[] = [];

    const current = collectionsRef.current;
    current.forEach(coll => {
      const payload = {
        id: coll.id,
        label: coll.label || 'Untitled Collection',
        content: coll.content || '',
        color: coll.color || null,
        tags: coll.tags || [],
        summary: coll.summary || '',
        tableOfContents: coll.tableOfContents || [],
        enrichedAt: coll.enrichedAt || null,
        createdAt: coll.createdAt || Date.now()
      };
      const serialized = JSON.stringify(payload);
      nextMap.set(coll.id, serialized);
      if (prevMap.get(coll.id) !== serialized) {
        toUpsert.push(payload);
      }
    });

    const toDelete: string[] = [];
    prevMap.forEach((_value, key) => {
      if (!nextMap.has(key)) {
        toDelete.push(key);
      }
    });

    if (toUpsert.length === 0 && toDelete.length === 0) {
      prevSerializedRef.current = nextMap;
      return;
    }

    try {
      for (const payload of toUpsert) {
        await runPythonJson([
          pipeline.pythonExecutable || 'python',
          scriptPath,
          '--db',
          dbPath,
          '--action',
          'upsert',
          '--data',
          JSON.stringify(payload)
        ]);
      }
      for (const id of toDelete) {
        await runPythonJson([
          pipeline.pythonExecutable || 'python',
          scriptPath,
          '--db',
          dbPath,
          '--action',
          'delete',
          '--id',
          id
        ]);
      }
      prevSerializedRef.current = nextMap;
    } catch (error) {
      console.error('[Collections] Failed to persist to database:', error);
      setUsingDatabase(false);
    }
  }, [plugin, usingDatabase]);

  useEffect(() => {
    if (!usingDatabase) {
      prevSerializedRef.current = new Map();
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      void persistCollections();
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [collections, usingDatabase, persistCollections]);

  const addToCollection = useCallback((collectionId: string, text: string, append: boolean = true) => {
    setCollections(prev => prev.map(coll => {
      if (coll.id === collectionId) {
        const newContent = append 
          ? (coll.content ? coll.content + '\n\n---\n\n' + text : text)
          : text;
        const lines = newContent.split('\n').filter(l => l.trim().length > 0);
        return {
          ...coll,
          content: newContent,
          itemCount: lines.length
        };
      }
      return coll;
    }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('aihp-collections', JSON.stringify(collections));
    } catch (e) {
      console.error('Failed to save collections:', e);
    }
  }, [collections]);

  // Create refresh function that wraps loadFromDatabase
  const refreshCollections = useCallback(async () => {
    try {
      await loadFromDatabase();
      new Notice('✅ Collections refreshed');
    } catch (error: any) {
      new Notice(`❌ Failed to refresh collections: ${error.message}`);
    }
  }, [loadFromDatabase]);

  return (
    <CollectionContext.Provider value={{ collections, addToCollection, setCollections, usingDatabase, refreshCollections }}>
      {children}
    </CollectionContext.Provider>
  );
};

interface CollectionPanelProps {
  onCollectionUpdate?: (collections: Collection[]) => void;
  plugin?: any; // AIHistoryParser plugin instance for accessing settings
}

export const CollectionPanel: React.FC<CollectionPanelProps> = ({ onCollectionUpdate, plugin }) => {
  // Use context if available, otherwise fallback to local state
  const context = useContext(CollectionContext);
  const [localCollections, setLocalCollections] = useState<Collection[]>(() => {
    // Load from localStorage on mount
    try {
      const saved = localStorage.getItem('aihp-collections');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load collections:', e);
    }
    return [];
  });
  
  const collections = context?.collections || localCollections;
  const setCollections = context?.setCollections || setLocalCollections;

  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'count'>('date');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [showTagModal, setShowTagModal] = useState<string | null>(null);  // Collection ID showing tag modal
  const [showHistoryModal, setShowHistoryModal] = useState<string | null>(null);  // Collection ID showing history
  const [showProjectModal, setShowProjectModal] = useState(false);  // Show add to project modal
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionPageSize] = useState(10);
  const [hoveredCollectionId, setHoveredCollectionId] = useState<string | null>(null);
  const MAX_VISIBLE_TAGS = 5;  // Show top 5 tags, rest in modal

  // Save collection version to history
  const saveCollectionVersion = useCallback((collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return;

    const version: CollectionVersion = {
      id: `v-${Date.now()}`,
      timestamp: Date.now(),
      label: collection.label,
      content: collection.content,
      tags: [...(collection.tags || [])],
      summary: collection.summary,
      itemCount: collection.itemCount
    };

    setCollections(prev => prev.map(c => {
      if (c.id !== collectionId) return c;
      const versions = c.savedVersions || [];
      return {
        ...c,
        savedVersions: [version, ...versions].slice(0, 50)  // Keep last 50 versions
      };
    }));

    new Notice(`Collection saved (${collection.savedVersions?.length || 0} previous versions)`);
  }, [collections]);

  // Restore collection from version
  const restoreCollectionVersion = useCallback((collectionId: string, versionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection || !collection.savedVersions) return;

    const version = collection.savedVersions.find(v => v.id === versionId);
    if (!version) return;

    setCollections(prev => prev.map(c => {
      if (c.id !== collectionId) return c;
      return {
        ...c,
        label: version.label,
        content: version.content,
        tags: version.tags,
        summary: version.summary,
        itemCount: version.itemCount
      };
    }));

    setShowHistoryModal(null);
    new Notice('Collection restored from version');
  }, [collections]);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save to localStorage whenever collections change (only if using local state)
  useEffect(() => {
    if (!context) {
      try {
        localStorage.setItem('aihp-collections', JSON.stringify(collections));
        onCollectionUpdate?.(collections);
      } catch (e) {
        console.error('Failed to save collections:', e);
      }
    } else {
      onCollectionUpdate?.(collections);
    }
  }, [collections, onCollectionUpdate, context]);

  // Create a new collection
  const createCollection = useCallback((templateId?: string) => {
    const id = `collection-${Date.now()}`;
    const label = `Collection ${collections.length + 1}`;
    let initialContent = '';
    let initialTags: string[] = [];
    
    // If template is provided, use it
    if (templateId) {
      const template = collections.find(c => c.id === templateId);
      if (template) {
        initialContent = template.template || '';
        initialTags = [...(template.tags || [])];
      }
    }
    
    const newCollection: Collection = {
      id,
      label,
      content: initialContent,
      createdAt: Date.now(),
      itemCount: 0,
      tags: initialTags,
      color: undefined
    };
    setCollections(prev => [...prev, newCollection]);
    setActiveCollectionId(id);
    new Notice(`Created ${label}`);
    return id;
  }, [collections]);

  // Use a ref to store enrichCollection to avoid circular dependency issues
  const enrichCollectionRef = useRef<((collectionId: string, background?: boolean) => Promise<void>) | null>(null);

  // AI enrich collection: tags + summary + ToC (with background option) - MUST BE BEFORE addToCollection
  const enrichCollection = useCallback(async (collectionId: string, background: boolean = false) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection || !collection.content.trim()) {
      new Notice('Collection is empty');
      return;
    }

    if (isEnriching && !background) {
      new Notice('AI enrichment already in progress');
      return;
    }

    // If background mode, queue it instead
    if (background) {
      const { getBackgroundAIService } = await import('../utils/backgroundAI');
      const bgService = getBackgroundAIService();
      bgService.addTask({
        type: 'collection_enrich',
        targetId: collectionId,
        content: collection.content,
        priority: 'normal',
      });
      new Notice('AI enrichment queued for background processing');
      return;
    }

    setIsEnriching(true);
    const startTime = Date.now();

    try {
      const aiSettings = plugin?.settings?.pythonPipeline?.aiAnnotation;
      const pipelineSettings = plugin?.settings?.pythonPipeline;
      const scriptsRoot = pipelineSettings?.scriptsRoot || '.';
      const pythonExecutable = pipelineSettings?.pythonExecutable || 'python';

      let backend: 'ollama' | 'openai' | 'auto' = 'auto';
      let model = 'llama3.2:3b-instruct';
      let url = 'http://127.0.0.1:11434';

      if (aiSettings?.enabled) {
        backend = aiSettings.backend;
        model = aiSettings.model || model;
        url = aiSettings.url || url;
      }

      const { spawn } = require('child_process');
      const path = require('path');
      const scriptPath = path.join(scriptsRoot, 'collection_ai_enrich.py');

      await new Promise<void>((resolve, reject) => {
        const args: string[] = [
          scriptPath,
          '--content', collection.content,
          '--backend', backend,
        ];

        if (backend === 'ollama' || backend === 'openai') {
          args.push('--model', model);
          args.push('--url', url);
        }

        const proc = spawn(pythonExecutable, args, { shell: false });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number) => {
          const duration = Math.round((Date.now() - startTime) / 1000);
          
          if (code === 0 && stdout.trim()) {
            try {
              const result = JSON.parse(stdout.trim());
              const generatedTitle: string = typeof result?.title === 'string' ? result.title.trim() : '';
              const suggestedTags: string[] = Array.isArray(result?.tags) ? result.tags : [];
              const summary: string = typeof result?.summary === 'string' ? result.summary : '';
              const toc = Array.isArray(result?.toc) ? result.toc : [];

              setCollections(prev => prev.map(c => {
                if (c.id !== collectionId) return c;

                const existingTags = c.tags || [];
                // Add model and duration tags
                const aiTags = [
                  `ai:${model.replace(/[:/]/g, '-')}`,
                  `duration:${duration}s`
                ];
                const newTags = suggestedTags
                  .map(tag => tag.toLowerCase())
                  .filter(tag => tag && !existingTags.includes(tag));
                const mergedTags = Array.from(new Set([...existingTags, ...newTags, ...aiTags]));

                return {
                  ...c,
                  tags: mergedTags,
                  summary: summary || c.summary,
                  tableOfContents: toc.length > 0 ? toc : c.tableOfContents,
                  enrichedAt: Date.now(),
                  enrichModel: model,
                  enrichDuration: duration,
                  generatedTitle: generatedTitle || c.generatedTitle,
                  label: generatedTitle ? generatedTitle : c.label
                };
              }));

              new Notice(`✨ AI enrichment complete (${duration}s)`);
            } catch (e: any) {
              console.error('Failed to parse AI enrichment result:', e, stdout);
              new Notice(`AI enrichment failed: ${e.message}`);
            }
          } else {
            console.error('AI enrichment script failed:', stderr || stdout);
            new Notice(`AI enrichment failed: ${stderr || 'Unknown error'}`);
          }
          setIsEnriching(false);
          resolve();
        });

        proc.on('error', (error: any) => {
          console.error('AI enrichment process error:', error);
          new Notice(`AI enrichment failed: ${error.message}`);
          setIsEnriching(false);
          reject(error);
        });
      });
    } catch (error: any) {
      console.error('AI enrichment error:', error);
      new Notice(`AI enrichment failed: ${error.message}`);
      setIsEnriching(false);
    }
  }, [collections, isEnriching, plugin]);

  // Update ref when enrichCollection changes
  useEffect(() => {
    enrichCollectionRef.current = enrichCollection;
  }, [enrichCollection]);

  // Add content to a collection
  const addToCollection = useCallback((collectionId: string, text: string, append: boolean = true) => {
    setCollections(prev => prev.map(coll => {
      if (coll.id === collectionId) {
        const oldContent = coll.content;
        const newContent = append 
          ? (oldContent ? oldContent + '\n\n---\n\n' + text : text)
          : text;
        const lines = newContent.split('\n').filter(l => l.trim().length > 0);
        const updated = {
          ...coll,
          content: newContent,
          itemCount: lines.length
        };
        
        // Auto-enrich if content exists and AI is enabled (run in background)
        if (newContent.trim() && plugin?.settings?.pythonPipeline?.aiAnnotation?.enabled) {
          // Debounce auto-enrichment - only run if content changed significantly
          const shouldAutoEnrich = !coll.enrichedAt || 
            (oldContent && newContent.length > oldContent.length * 1.1) || // 10% growth
            (coll.enrichedAt && Date.now() - coll.enrichedAt > 60000); // 1 minute since last enrich
          
          if (shouldAutoEnrich) {
            setTimeout(() => {
              // Run in background mode for auto-enrichment
              if (enrichCollectionRef.current) {
                enrichCollectionRef.current(collectionId, true).catch(err => {
                  console.error('Auto-enrichment failed:', err);
                });
              }
            }, 2000); // 2 second delay
          }
        }
        
        return updated;
      }
      return coll;
    }));
  }, [plugin]);

  // Handle clipboard paste
  const handlePasteToCollection = useCallback(async (collectionId: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        addToCollection(collectionId, text, true);
        new Notice(`Pasted to ${collections.find(c => c.id === collectionId)?.label || 'collection'}`);
      } else {
        new Notice('Clipboard is empty');
      }
    } catch (e) {
      console.error('Failed to read clipboard:', e);
      new Notice('Failed to read clipboard. Please ensure clipboard access is allowed.');
    }
  }, [collections, addToCollection]);

  // Handle right-click paste
  const handleRightClick = useCallback((e: React.MouseEvent, collectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    handlePasteToCollection(collectionId);
  }, [handlePasteToCollection]);

  // Handle left-click paste (Ctrl+C then click)
  const handleLeftClickPaste = useCallback((e: React.MouseEvent, collectionId: string) => {
    // Check if Ctrl/Cmd is held (user might have just copied)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      handlePasteToCollection(collectionId);
    }
  }, [handlePasteToCollection]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set dragging to false if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
    setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, collectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    try {
      // Try to get text from drag data - check multiple formats
      let text = e.dataTransfer.getData('text/plain') || 
                 e.dataTransfer.getData('text') ||
                 e.dataTransfer.getData('text/html');
      
      // If HTML, try to extract text content
      if (text && text.includes('<')) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text;
        text = tempDiv.textContent || tempDiv.innerText || text;
      }
      
      // Also try getting selected text from window
      if (!text && window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
          text = selection.toString();
        }
      }
      
      if (text && text.trim()) {
        addToCollection(collectionId, text.trim(), true);
        new Notice(`Dropped text into ${collections.find(c => c.id === collectionId)?.label || 'collection'}`);
        return;
      }

      // Try to get files
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const fileContents = await Promise.all(
          files.map(file => {
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.onerror = reject;
              reader.readAsText(file);
            });
          })
        );
        const combinedText = fileContents.join('\n\n---\n\n');
        addToCollection(collectionId, combinedText, true);
        new Notice(`Dropped ${files.length} file(s) into ${collections.find(c => c.id === collectionId)?.label || 'collection'}`);
      }
    } catch (error) {
      console.error('Drop failed:', error);
      new Notice('Failed to process dropped content');
    }
  }, [collections, addToCollection]);

  // Delete collection
  const deleteCollection = useCallback((collectionId: string) => {
    setCollections(prev => prev.filter(c => c.id !== collectionId));
    if (activeCollectionId === collectionId) {
      setActiveCollectionId(null);
    }
    new Notice('Collection deleted');
  }, [activeCollectionId]);

  // Update collection label
  const updateLabel = useCallback((collectionId: string, newLabel: string) => {
    setCollections(prev => prev.map(c => 
      c.id === collectionId ? { ...c, label: newLabel } : c
    ));
  }, []);

  // Clear collection content
  const clearCollection = useCallback((collectionId: string) => {
    setCollections(prev => prev.map(c => 
      c.id === collectionId ? { ...c, content: '', itemCount: 0 } : c
    ));
    new Notice('Collection cleared');
  }, []);

  // Copy collection content to clipboard
  const copyCollection = useCallback(async (collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (collection && collection.content) {
      try {
        await navigator.clipboard.writeText(collection.content);
        new Notice(`Copied ${collection.label} to clipboard`);
      } catch (e) {
        console.error('Failed to copy:', e);
        new Notice('Failed to copy to clipboard');
      }
    }
  }, [collections]);

  // Export collection
  const exportCollection = useCallback((collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (collection && collection.content) {
      const blob = new Blob([collection.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.label.replace(/[^a-z0-9]/gi, '_')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      new Notice(`Exported ${collection.label}`);
    }
  }, [collections]);

  // Duplicate collection
  const duplicateCollection = useCallback((collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId);
    if (collection) {
      const id = `collection-${Date.now()}`;
      const newCollection: Collection = {
        ...collection,
        id,
        label: `${collection.label} (Copy)`,
        createdAt: Date.now()
      };
      setCollections(prev => [...prev, newCollection]);
      setActiveCollectionId(id);
      new Notice(`Duplicated ${collection.label}`);
    }
  }, [collections]);

  // Merge collections
  const mergeCollections = useCallback((sourceId: string, targetId: string) => {
    const source = collections.find(c => c.id === sourceId);
    const target = collections.find(c => c.id === targetId);
    if (source && target) {
      const mergedContent = target.content 
        ? `${target.content}\n\n---\n\n${source.content}`
        : source.content;
      const lines = mergedContent.split('\n').filter(l => l.trim().length > 0);
      setCollections(prev => prev.map(c => 
        c.id === targetId 
          ? { ...c, content: mergedContent, itemCount: lines.length }
          : c
      ).filter(c => c.id !== sourceId));
      setActiveCollectionId(targetId);
      setMergeSource(null);
      new Notice(`Merged ${source.label} into ${target.label}`);
    }
  }, [collections]);

  // Add tag to collection
  const addTag = useCallback((collectionId: string, tag: string) => {
    if (!tag.trim()) return;
    setCollections(prev => prev.map(c => {
      if (c.id === collectionId) {
        const tags = c.tags || [];
        if (!tags.includes(tag.trim())) {
          return { ...c, tags: [...tags, tag.trim()] };
        }
      }
      return c;
    }));
  }, []);

  // Remove tag from collection
  const removeTag = useCallback((collectionId: string, tag: string) => {
    setCollections(prev => prev.map(c => {
      if (c.id === collectionId) {
        const tags = (c.tags || []).filter(t => t !== tag);
        return { ...c, tags };
      }
      return c;
    }));
  }, []);

  // Set collection color
  const setCollectionColor = useCallback((collectionId: string, color: string | undefined) => {
    setCollections(prev => prev.map(c => 
      c.id === collectionId ? { ...c, color } : c
    ));
  }, []);

  // Save template from collection
  const saveAsTemplate = useCallback((collectionId: string) => {
    setCollections(prev => prev.map(c => {
      if (c.id === collectionId) {
        return { ...c, template: c.content };
      }
      return c;
    }));
    new Notice('Template saved');
  }, []);


  // Filter and sort collections
  const filteredAndSortedCollections = React.useMemo(() => {
    let filtered = collections;
    
    // Apply search filter
    if (searchFilter.trim()) {
      const query = searchFilter.toLowerCase();
      filtered = filtered.filter(c => 
        c.label.toLowerCase().includes(query) ||
        c.content.toLowerCase().includes(query) ||
        (c.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.label.localeCompare(b.label);
        case 'count':
          return b.itemCount - a.itemCount;
        case 'date':
        default:
          return b.createdAt - a.createdAt;
      }
    });
    
    return sorted;
  }, [collections, searchFilter, sortBy]);

  // Paginate collections
  const collectionPageCount = Math.ceil(filteredAndSortedCollections.length / collectionPageSize);
  const paginatedCollections = filteredAndSortedCollections.slice(
    (collectionPage - 1) * collectionPageSize,
    collectionPage * collectionPageSize
  );

  useEffect(() => {
    if (collectionPage > collectionPageCount && collectionPageCount > 0) {
      setCollectionPage(collectionPageCount);
    }
  }, [collectionPageCount]);

  const activeCollection = collections.find(c => c.id === activeCollectionId);

  return (
    <div 
      className="aip-collection-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        minHeight: '100vh',
        maxHeight: '100vh',
        backgroundColor: 'var(--background-primary)',
        width: '100%',
        overflow: 'hidden',
        marginTop: 0,
        paddingTop: 0
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px',
        paddingTop: '8px',
        borderBottom: '1px solid var(--background-modifier-border)',
        display: 'flex',
        flexDirection: 'column',
        marginTop: 0,
        gap: '10px',
        background: 'var(--background-primary)',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#ffffff' }}>Collections</h3>
          <div style={{ display: 'flex', gap: '4px' }}>
            {refreshCollections && (
              <button
                onClick={async () => {
                  setIsRefreshing(true);
                  try {
                    await refreshCollections();
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: isRefreshing ? 'var(--background-modifier-border)' : 'var(--background-secondary)',
                  color: isRefreshing ? 'var(--text-muted)' : 'var(--text-normal)',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '6px',
                  cursor: isRefreshing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: isRefreshing ? 0.6 : 1
                }}
                title="Refresh collections from database"
              >
                <span style={{ 
                  display: 'inline-block',
                  animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                  transformOrigin: 'center'
                }}>
                  🔄
                </span>
              </button>
            )}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                background: showAdvanced ? 'var(--interactive-accent)' : 'var(--background-secondary)',
                color: showAdvanced ? 'var(--text-on-accent)' : 'var(--text-normal)',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              title="Toggle advanced options"
            >
              ⚙️
            </button>
            <button
              onClick={() => createCollection()}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'var(--interactive-accent)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
              title="Create new collection"
            >
              + New
            </button>
          </div>
        </div>
        
        {/* Search and Sort */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Search collections..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: '12px',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '6px',
              background: 'var(--background-primary)',
              color: '#ffffff',
              fontWeight: 700,
              transition: 'all 0.2s ease'
            }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'count')}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '6px',
              background: 'var(--background-primary)',
              color: '#ffffff',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <option value="date" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Sort: Date</option>
            <option value="name" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Sort: Name</option>
            <option value="count" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Sort: Count</option>
          </select>
        </div>
      </div>

      {/* Collection Buttons (Vertical Bar) */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        marginTop: 0,
        paddingTop: 0,
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        background: 'var(--background-primary)'
      }}>
        {paginatedCollections.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--aihp-text-muted)',
            fontSize: '12px'
          }}>
            {collections.length === 0 
              ? <>No collections yet.<br />Click "+ New" to create one.</>
              : <>No collections match your search.</>
            }
          </div>
        ) : (
          paginatedCollections.map(collection => (
            <div
              key={collection.id}
              ref={collection.id === activeCollectionId ? dropZoneRef : null}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, collection.id)}
              onClick={() => setActiveCollectionId(collection.id)}
              onContextMenu={(e) => handleRightClick(e, collection.id)}
              onMouseDown={(e) => handleLeftClickPaste(e, collection.id)}
              onMouseEnter={() => setHoveredCollectionId(collection.id)}
              onMouseLeave={() => setHoveredCollectionId(null)}
              style={{
                padding: '12px',
                backgroundColor: collection.color && activeCollectionId === collection.id
                  ? collection.color
                  : activeCollectionId === collection.id 
                    ? 'var(--background-secondary)'
                    : collection.color
                      ? `${collection.color}15`
                      : 'var(--background-primary)',
                color: collection.color && activeCollectionId === collection.id
                  ? (getContrastColor(collection.color) === 'white' ? '#ffffff' : '#000000')
                  : 'var(--text-normal)',
                border: `1px solid ${activeCollectionId === collection.id 
                  ? (collection.color || 'var(--interactive-accent)')
                  : collection.color
                    ? `${collection.color}40`
                    : 'var(--background-modifier-border)'}`,
                borderLeft: activeCollectionId === collection.id 
                  ? `4px solid ${collection.color || 'var(--interactive-accent)'}`
                  : collection.color
                    ? `4px solid ${collection.color}60`
                    : '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                cursor: 'pointer',
                position: 'relative',
                minHeight: '60px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                opacity: isDragging && activeCollectionId === collection.id ? 0.7 : 1,
                boxShadow: activeCollectionId === collection.id 
                  ? '0 2px 8px rgba(0,0,0,0.1)'
                  : hoveredCollectionId === collection.id
                    ? '0 1px 4px rgba(0,0,0,0.1)'
                    : 'none',
                transform: hoveredCollectionId === collection.id ? 'translateY(-1px)' : 'none',
                transition: 'all 0.2s ease'
              }}
              title={`${collection.label}\n${collection.itemCount} items\n\nLeft-click: Select\nRight-click: Paste clipboard\nCtrl+Click: Paste clipboard\nDrag text here: Add to collection`}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{
                  fontSize: '16px',
                  opacity: 0.7,
                  cursor: 'grab',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  color: collection.color && activeCollectionId === collection.id
                    ? (getContrastColor(collection.color) === 'white' ? '#ffffff' : '#000000')
                    : '#ffffff'
                }} title="Drag handle">☰</span>
                <input
                  type="text"
                  value={collection.label}
                  onChange={(e) => {
                    e.stopPropagation();
                    updateLabel(collection.id, e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: collection.color && activeCollectionId === collection.id
                      ? (getContrastColor(collection.color) === 'white' ? '#ffffff' : '#000000')
                      : '#ffffff',
                    fontSize: '14px',
                    fontWeight: '700',
                    flex: 1,
                    padding: '2px 4px',
                    borderRadius: '3px',
                    outline: 'none'
                  }}
                  placeholder="Collection name"
                />
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center'
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '500',
                    padding: '3px 8px',
                    background: activeCollectionId === collection.id 
                      ? (collection.color ? `${collection.color}15` : 'var(--background-modifier-hover)')
                      : 'var(--background-modifier-border)',
                    color: activeCollectionId === collection.id && collection.color
                      ? collection.color
                      : 'var(--text-muted)',
                    borderRadius: '4px',
                    border: activeCollectionId === collection.id && collection.color
                      ? `1px solid ${collection.color}40`
                      : 'none'
                  }}>
                    {collection.itemCount}
                  </span>
                  {/* Quick Actions - Show on hover */}
                  {(hoveredCollectionId === collection.id || activeCollectionId === collection.id) && (
                    <>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          duplicateCollection(collection.id);
                        }}
                        style={{
                          background: 'var(--background-secondary)',
                          border: '1px solid var(--background-modifier-border)',
                          color: '#ffffff',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          opacity: 0.9,
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.background = 'var(--interactive-accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.9';
                          e.currentTarget.style.background = 'var(--background-secondary)';
                        }}
                        title="Duplicate collection"
                      >
                        📋
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          exportCollection(collection.id);
                        }}
                        style={{
                          background: 'var(--background-secondary)',
                          border: '1px solid var(--background-modifier-border)',
                          color: '#ffffff',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          opacity: 0.9,
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.background = 'var(--interactive-accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.9';
                          e.currentTarget.style.background = 'var(--background-secondary)';
                        }}
                        title="Export collection"
                      >
                        💾
                      </button>
                    </>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Popout individual collection to a new markdown note
                      try {
                        if (!plugin?.app) return;
                        const currentCollection = collections.find(c => c.id === collection.id);
                        if (!currentCollection) return;
                        
                        // Create a temporary markdown file with collection content
                        const vault = plugin.app.vault;
                        const fileName = `Collection_${currentCollection.label.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.md`;
                        const filePath = fileName;
                        
                        // Create markdown content
                        const content = `# ${currentCollection.label}\n\n${currentCollection.content}\n\n---\n\n**Tags:** ${(currentCollection.tags || []).join(', ')}\n**Items:** ${currentCollection.itemCount}\n**Created:** ${new Date(currentCollection.createdAt).toLocaleString()}`;
                        
                        // Create file and open in popout
                        const file = await vault.create(filePath, content);
                        const leaf = plugin.app.workspace.openPopoutLeaf();
                        await leaf.openFile(file);
                        new Notice(`Collection "${currentCollection.label}" opened in popout window`);
                      } catch (error: any) {
                        new Notice(`Failed to popout collection: ${error.message}`);
                        console.error('Collection popout error:', error);
                      }
                    }}
                    style={{
                      background: hoveredCollectionId === collection.id || activeCollectionId === collection.id 
                        ? 'var(--background-secondary)' 
                        : 'transparent',
                      border: '1px solid var(--background-modifier-border)',
                      color: '#ffffff',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      fontSize: '11px',
                      borderRadius: '4px',
                      opacity: hoveredCollectionId === collection.id || activeCollectionId === collection.id ? 0.9 : 0.5,
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.background = 'var(--interactive-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = hoveredCollectionId === collection.id || activeCollectionId === collection.id ? '0.9' : '0.5';
                      e.currentTarget.style.background = hoveredCollectionId === collection.id || activeCollectionId === collection.id 
                        ? 'var(--background-secondary)' 
                        : 'transparent';
                    }}
                    title="Popout this collection to a separate window"
                  >
                    🔲
                  </button>
                  {showAdvanced && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mergeSource) {
                          if (mergeSource === collection.id) {
                            setMergeSource(null);
                          } else {
                            mergeCollections(mergeSource, collection.id);
                          }
                        } else {
                          setMergeSource(collection.id);
                        }
                      }}
                      style={{
                        background: mergeSource === collection.id ? 'var(--interactive-accent)' : 'transparent',
                        border: '1px solid var(--background-modifier-border)',
                        color: '#ffffff',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        opacity: hoveredCollectionId === collection.id || activeCollectionId === collection.id ? 0.9 : 0.5,
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (mergeSource !== collection.id) {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.background = 'var(--interactive-accent)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (mergeSource !== collection.id) {
                          e.currentTarget.style.opacity = hoveredCollectionId === collection.id || activeCollectionId === collection.id ? '0.9' : '0.5';
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                      title={mergeSource === collection.id ? "Cancel merge" : mergeSource ? "Merge into this" : "Select to merge"}
                    >
                      {mergeSource === collection.id ? '✓' : '🔗'}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete collection "${collection.label}"?`)) {
                        deleteCollection(collection.id);
                      }
                    }}
                    style={{
                      background: hoveredCollectionId === collection.id || activeCollectionId === collection.id 
                        ? 'var(--background-secondary)' 
                        : 'transparent',
                      border: '1px solid var(--background-modifier-border)',
                      color: '#ff6b6b',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      fontSize: '12px',
                      borderRadius: '4px',
                      opacity: hoveredCollectionId === collection.id || activeCollectionId === collection.id ? 0.9 : 0.5,
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.background = '#ff6b6b20';
                      e.currentTarget.style.color = '#ff4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = hoveredCollectionId === collection.id || activeCollectionId === collection.id ? '0.9' : '0.5';
                      e.currentTarget.style.background = hoveredCollectionId === collection.id || activeCollectionId === collection.id 
                        ? 'var(--background-secondary)' 
                        : 'transparent';
                      e.currentTarget.style.color = '#ff6b6b';
                    }}
                    title="Delete collection"
                  >
                    ×
                  </button>
                </div>
              </div>
              {/* Tags - Show top tags with "show more" button */}
              {collection.tags && collection.tags.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  flexWrap: 'wrap',
                  marginTop: '4px',
                  alignItems: 'center'
                }}>
                  {collection.tags.slice(0, MAX_VISIBLE_TAGS).map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '10px',
                        padding: '3px 7px',
                        background: activeCollectionId === collection.id 
                          ? (collection.color ? `${collection.color}20` : 'var(--background-modifier-hover)')
                          : 'var(--background-modifier-border)',
                        color: collection.color && activeCollectionId === collection.id
                          ? (getContrastColor(collection.color) === 'white' ? '#ffffff' : '#000000')
                          : '#ffffff',
                        borderRadius: '4px',
                        border: collection.color ? `1px solid ${collection.color}30` : 'none',
                        fontWeight: '600'
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                  {collection.tags.length > MAX_VISIBLE_TAGS && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTagModal(collection.id);
                      }}
                      style={{
                        fontSize: '9px',
                        padding: '3px 7px',
                        background: 'var(--background-modifier-border)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: '600'
                      }}
                      title={`Show all ${collection.tags.length} tags`}
                    >
                      +{collection.tags.length - MAX_VISIBLE_TAGS} more
                    </button>
                  )}
                </div>
              )}
              {collection.content && (
                <div style={{
                  fontSize: '10px',
                  opacity: 0.8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%'
                }}>
                  {collection.content.substring(0, 50)}...
                </div>
              )}
            </div>
          ))
        )}
        {/* Pagination */}
        {collectionPageCount > 1 && (
          <div style={{
            padding: '10px',
            borderTop: '1px solid var(--background-modifier-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            fontWeight: '700',
            color: '#ffffff',
            background: 'var(--background-primary)'
          }}>
            <button
              onClick={() => setCollectionPage(Math.max(1, collectionPage - 1))}
              disabled={collectionPage === 1}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                background: collectionPage === 1 ? 'var(--background-modifier-border)' : 'var(--interactive-accent)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '3px',
                cursor: collectionPage === 1 ? 'not-allowed' : 'pointer',
                fontWeight: '700',
                opacity: collectionPage === 1 ? 0.5 : 1
              }}
            >
              ← Prev
            </button>
            <span>
              Page {collectionPage} / {collectionPageCount}
            </span>
            <button
              onClick={() => setCollectionPage(Math.min(collectionPageCount, collectionPage + 1))}
              disabled={collectionPage === collectionPageCount}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                background: collectionPage === collectionPageCount ? 'var(--background-modifier-border)' : 'var(--interactive-accent)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '3px',
                cursor: collectionPage === collectionPageCount ? 'not-allowed' : 'pointer',
                fontWeight: '700',
                opacity: collectionPage === collectionPageCount ? 0.5 : 1
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Active Collection Content View */}
      {activeCollection && (
        <div 
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            const relatedTarget = e.relatedTarget as HTMLElement;
            if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
              setIsDragging(false);
            }
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            
            try {
              let text = e.dataTransfer.getData('text/plain') || 
                         e.dataTransfer.getData('text') ||
                         e.dataTransfer.getData('text/html');
              
              if (text && text.includes('<')) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = text;
                text = tempDiv.textContent || tempDiv.innerText || text;
              }
              
              if (!text && window.getSelection) {
                const selection = window.getSelection();
                if (selection && selection.toString().trim()) {
                  text = selection.toString();
                }
              }
              
              if (text && text.trim()) {
                addToCollection(activeCollection.id, text.trim(), true);
                new Notice(`Dropped text into ${activeCollection.label}`);
              }
            } catch (error) {
              console.error('Drop failed:', error);
              new Notice('Failed to process dropped content');
            }
          }}
          style={{
            borderTop: '1px solid var(--background-modifier-border)',
          display: 'flex',
          flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
            zIndex: 1
        }}>
          <div style={{
            padding: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--background-modifier-border)',
            backgroundColor: activeCollection.color 
              ? `${activeCollection.color}20`
              : 'var(--background-modifier-hover)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <span className="aip-collection-label" style={{ fontSize: '14px', fontWeight: '700', color: activeCollection.color && getContrastColor(activeCollection.color) === 'white' ? '#ffffff' : 'var(--text-normal)' }}>
              {activeCollection.label}
            </span>
              {/* Tags for active collection */}
              {showAdvanced && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(activeCollection.tags || []).map(tag => (
                    <span
                      key={tag}
                style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                  background: 'var(--aihp-bg-primary)',
                  border: '1px solid var(--aihp-bg-modifier)',
                  borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                }}
              >
                      #{tag}
              <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTag(activeCollection.id, tag);
                        }}
                style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                  fontSize: '10px',
                          lineHeight: 1
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {editingTag === activeCollection.id ? (
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTag.trim()) {
                          addTag(activeCollection.id, newTag);
                          setNewTag('');
                          setEditingTag(null);
                        } else if (e.key === 'Escape') {
                          setEditingTag(null);
                          setNewTag('');
                        }
                      }}
                      autoFocus
                      placeholder="Tag name"
                      style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                        border: '1px solid var(--aihp-bg-modifier)',
                        borderRadius: '3px',
                        background: 'var(--aihp-bg-primary)',
                        color: 'var(--aihp-text-normal)',
                        width: '80px'
                      }}
                    />
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTag(activeCollection.id);
                        }}
                        style={{
                          fontSize: '9px',
                          padding: '2px 6px',
                  background: 'var(--aihp-bg-primary)',
                  border: '1px solid var(--aihp-bg-modifier)',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
                        title="Add tag manually"
              >
                        + Tag
              </button>
              <button
                        onClick={(e) => {
                          e.stopPropagation();
                          enrichCollection(activeCollection.id);
                        }}
                        disabled={isEnriching}
                style={{
                          fontSize: '9px',
                          padding: '2px 6px',
                          background: isEnriching ? 'var(--aihp-bg-modifier)' : 'var(--aihp-accent)',
                          color: isEnriching ? 'var(--aihp-text-muted)' : 'var(--text-on-accent)',
                  border: '1px solid var(--aihp-bg-modifier)',
                  borderRadius: '3px',
                          cursor: isEnriching ? 'wait' : 'pointer',
                          opacity: isEnriching ? 0.6 : 1
                }}
                        title="AI enrich collection (title, tags, executive summary, table of contents)"
              >
                        {isEnriching ? '🤖...' : '✨ AI Enrich'}
              </button>
                    </>
                  )}
            </div>
              )}
          </div>
            {/* Action Buttons - Organized into groups */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px',
              padding: '8px 0'
            }}>
              {/* Primary Actions Group */}
              <div style={{ 
                display: 'flex', 
                gap: '4px', 
                flexWrap: 'wrap', 
                alignItems: 'center',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--background-modifier-border)'
              }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '100%',
                  marginBottom: '4px'
                }}>Primary Actions</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    saveCollectionVersion(activeCollection.id);
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'var(--interactive-accent)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: '1',
                    minWidth: '120px',
                    justifyContent: 'center'
                  }}
                  title="Save current version to history"
                >
                  💾 Save Version
                </button>
                {activeCollection.savedVersions && activeCollection.savedVersions.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowHistoryModal(activeCollection.id);
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: '11px',
                      background: 'var(--background-secondary)',
                      color: '#ffffff',
                      border: '1px solid var(--background-modifier-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flex: '1',
                      minWidth: '120px',
                      justifyContent: 'center'
                    }}
                    title={`View history (${activeCollection.savedVersions.length} versions)`}
                  >
                    📜 History ({activeCollection.savedVersions.length})
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowProjectModal(true);
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'var(--interactive-accent)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: '1',
                    minWidth: '120px',
                    justifyContent: 'center'
                  }}
                  title="Add collection to project"
                >
                  📁 Add to Project
                </button>
              </div>

              {/* Export Actions Group */}
              <div style={{ 
                display: 'flex', 
                gap: '4px', 
                flexWrap: 'wrap', 
                alignItems: 'center',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--background-modifier-border)'
              }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '100%',
                  marginBottom: '4px'
                }}>Export & Share</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(activeCollection.content);
                    new Notice('Collection content copied to clipboard');
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'var(--background-secondary)',
                    color: '#ffffff',
                    border: '1px solid var(--background-modifier-border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: '1',
                    minWidth: '100px',
                    justifyContent: 'center'
                  }}
                  title="Copy collection content to clipboard"
                >
                  📋 Copy
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const blob = new Blob([activeCollection.content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activeCollection.label.replace(/[^a-z0-9]/gi, '_')}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                    new Notice('Collection exported');
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'var(--background-secondary)',
                    color: '#ffffff',
                    border: '1px solid var(--background-modifier-border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: '1',
                    minWidth: '100px',
                    justifyContent: 'center'
                  }}
                  title="Export collection to file"
                >
                  📤 Export
                </button>
              </div>

              {/* Management Actions Group */}
              <div style={{ 
                display: 'flex', 
                gap: '4px', 
                flexWrap: 'wrap', 
                alignItems: 'center'
              }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '100%',
                  marginBottom: '4px'
                }}>Management</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Clear all content from this collection?')) {
                      setCollections(prev => prev.map(c => {
                        if (c.id === activeCollection.id) {
                          return { ...c, content: '', itemCount: 0 };
                        }
                        return c;
                      }));
                      new Notice('Collection cleared');
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'var(--background-secondary)',
                    color: '#ffffff',
                    border: '1px solid var(--background-modifier-border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: '1',
                    minWidth: '100px',
                    justifyContent: 'center'
                  }}
                  title="Clear collection content"
                >
                  🗑️ Clear
                </button>
              {showAdvanced && (
                <>
                  <button
                    onClick={() => duplicateCollection(activeCollection.id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '11px',
                      background: 'var(--background-secondary)',
                      border: '1px solid var(--background-modifier-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: '#ffffff',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flex: '1',
                      minWidth: '100px',
                      justifyContent: 'center'
                    }}
                    title="Duplicate collection"
                  >
                    📋 Duplicate
                  </button>
                  <button
                    onClick={() => saveAsTemplate(activeCollection.id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '11px',
                      background: 'var(--background-secondary)',
                      border: '1px solid var(--background-modifier-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: '#ffffff',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flex: '1',
                      minWidth: '100px',
                      justifyContent: 'center'
                    }}
                    title="Save as template"
                  >
                    📝 Save Template
                  </button>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <input
                      type="color"
                      value={activeCollection.color || '#3b82f6'}
                      onChange={(e) => setCollectionColor(activeCollection.id, e.target.value || undefined)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '32px',
                        height: '32px',
                        padding: '2px',
                        background: activeCollection.color || 'var(--background-primary)',
                        border: `2px solid ${activeCollection.color || 'var(--interactive-accent)'}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        outline: 'none',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                      title="Set color"
                      className="aip-color-picker"
                    />
                    {activeCollection.color && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollectionColor(activeCollection.id, undefined);
                        }}
                        style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-6px',
                          width: '18px',
                          height: '18px',
                          background: 'var(--text-error)',
                          color: 'white',
                          border: '2px solid var(--background-primary)',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          fontSize: '10px',
                          fontWeight: '700',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          lineHeight: 1
                        }}
                        title="Remove color"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </>
              )}
              </div>
            </div>

            {/* AI Enrichment - Prominent placement */}
            {activeCollection.content.trim() && (
              <div style={{
                paddingTop: '8px',
                borderTop: '1px solid var(--background-modifier-border)',
                marginTop: '8px',
                padding: '12px'
              }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '100%',
                  marginBottom: '8px',
                  display: 'block'
                }}>AI Enhancement</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    enrichCollection(activeCollection.id);
                  }}
                  disabled={isEnriching}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    background: isEnriching ? 'var(--background-modifier-border)' : 'var(--interactive-accent)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isEnriching ? 'not-allowed' : 'pointer',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: isEnriching ? 0.6 : 1,
                    width: '100%',
                    justifyContent: 'center',
                    boxShadow: isEnriching ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isEnriching) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = isEnriching ? 'none' : '0 2px 4px rgba(0,0,0,0.2)';
                  }}
                  title={isEnriching ? "AI enrichment in progress..." : "Generate tags, summary, and table of contents using AI (auto-enrichment enabled)"}
                >
                  {isEnriching ? '⏳ Enriching...' : '✨ AI Enrich'}
                  {activeCollection.enrichedAt && (
                    <span style={{
                      fontSize: '9px',
                      opacity: 0.8,
                      marginLeft: '4px'
                    }}>
                      ({activeCollection.enrichModel || 'AI'})
                    </span>
                  )}
                </button>
                {activeCollection.enrichedAt && (
                  <div style={{
                    fontSize: '9px',
                    color: 'rgba(255,255,255,0.5)',
                    marginTop: '4px',
                    textAlign: 'center'
                  }}>
                    Last enriched: {new Date(activeCollection.enrichedAt).toLocaleString()}
                    {activeCollection.enrichDuration && ` (${activeCollection.enrichDuration}s)`}
                  </div>
                )}
              </div>
            )}
          </div>

          {(activeCollection.summary || (activeCollection.tableOfContents && activeCollection.tableOfContents.length > 0)) && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--aihp-bg-primary)',
              borderBottom: '1px solid var(--aihp-bg-modifier)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '160px',
              overflowY: 'auto'
            }}>
              {activeCollection.summary && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Executive Summary</span>
                    {activeCollection.enrichedAt && (
                      <span style={{ fontSize: '10px', color: 'var(--aihp-text-muted)' }}>
                        Updated {new Date(activeCollection.enrichedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', lineHeight: 1.4, color: 'var(--aihp-text-normal)' }}>
                    {activeCollection.summary}
                  </div>
                </div>
              )}

              {activeCollection.tableOfContents && activeCollection.tableOfContents.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>Table of Contents</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {activeCollection.tableOfContents.map((item, idx) => (
                      <div
                        key={`${item.anchor || item.title}-${idx}`}
                        style={{
                          fontSize: '10px',
                          color: 'var(--aihp-text-muted)',
                          paddingLeft: `${(item.level - 1) * 12}px`
                        }}
                      >
                        {item.level <= 2 ? '• ' : '◦ '}
                        {item.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <textarea
            value={activeCollection.content}
            onChange={(e) => {
              const newContent = e.target.value;
              setCollections(prev => prev.map(c => 
                c.id === activeCollection.id 
                  ? { ...c, content: newContent, itemCount: newContent.split('\n').filter(l => l.trim().length > 0).length }
                  : c
              ));
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              // Check if we're actually leaving the textarea
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX;
              const y = e.clientY;
              if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                setIsDragging(false);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              
              try {
                // Get text from drag data - try multiple formats
                let text = e.dataTransfer.getData('text/plain') || 
                           e.dataTransfer.getData('text') ||
                           e.dataTransfer.getData('text/html');
                
                // If HTML, extract text content
                if (text && text.includes('<')) {
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = text;
                  text = tempDiv.textContent || tempDiv.innerText || text;
                }
                
                // Fallback: try window selection
                if (!text || !text.trim()) {
                  const selection = window.getSelection();
                  if (selection && selection.toString().trim()) {
                    text = selection.toString();
                  }
                }
                
                if (text && text.trim()) {
                  addToCollection(activeCollection.id, text.trim(), true);
                  new Notice(`Dropped text into ${activeCollection.label}`);
                } else {
                  new Notice('No text found to drop');
                }
              } catch (error) {
                console.error('Drop failed:', error);
                new Notice('Failed to process dropped content');
              }
            }}
            style={{
              flex: 1,
              padding: '12px',
              background: 'var(--aihp-bg-primary)',
              color: '#ffffff',
              border: 'none',
              resize: 'none',
              fontFamily: 'var(--font-monospace)',
              fontSize: '12px',
              lineHeight: '1.5',
              fontWeight: '600'
            }}
            placeholder="Collection content will appear here...&#10;&#10;Right-click a collection button to paste from clipboard.&#10;Drag and drop text here.&#10;Select messages and use the 'Add to Collection' button."
          />
        </div>
      )}

      {/* Tag Modal */}
      {showTagModal && (() => {
        const collection = collections.find(c => c.id === showTagModal);
        if (!collection || !collection.tags || collection.tags.length === 0) return null;
        
        return (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowTagModal(null);
            }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}
          >
            <div
              style={{
                background: 'var(--background-primary)',
                borderRadius: '12px',
                padding: '20px',
                maxWidth: '500px',
                maxHeight: '70vh',
                overflowY: 'auto',
                border: '2px solid var(--interactive-accent)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>
                  All Tags ({collection.tags.length})
                </h3>
                <button
                  onClick={() => setShowTagModal(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontWeight: '800'
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                {collection.tags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      fontSize: '12px',
                      padding: '6px 12px',
                      background: collection.color ? `${collection.color}30` : 'var(--background-modifier-hover)',
                      color: collection.color && getContrastColor(collection.color) === 'white' ? '#ffffff' : '#ffffff',
                      borderRadius: '6px',
                      border: collection.color ? `1px solid ${collection.color}50` : '1px solid var(--background-modifier-border)',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    #{tag}
                    {activeCollectionId === collection.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTag(collection.id, tag);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '14px',
                          lineHeight: 1,
                          marginLeft: '4px'
                        }}
                        title="Remove tag"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {collection.enrichModel && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: 'var(--background-secondary)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#ffffff',
                  fontWeight: '600'
                }}>
                  <div>🤖 AI Enrichment Info:</div>
                  <div style={{ marginTop: '4px', opacity: 0.9 }}>
                    Model: {collection.enrichModel}
                    {collection.enrichDuration && ` • Duration: ${collection.enrichDuration}s`}
                    {collection.enrichedAt && ` • ${new Date(collection.enrichedAt).toLocaleString()}`}
                  </div>
                </div>
              )}
            </div>
    </div>
  );
      })()}

      {/* History Modal */}
      {showHistoryModal && (() => {
        const collection = collections.find(c => c.id === showHistoryModal);
        if (!collection || !collection.savedVersions || collection.savedVersions.length === 0) return null;
        
        return (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowHistoryModal(null);
            }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}
          >
            <div
              style={{
                background: 'var(--background-primary)',
                borderRadius: '12px',
                padding: '20px',
                maxWidth: '600px',
                maxHeight: '80vh',
                overflowY: 'auto',
                border: '2px solid var(--interactive-accent)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                width: '90%'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>
                  📜 Collection History ({collection.savedVersions.length} versions)
                </h3>
                <button
                  onClick={() => setShowHistoryModal(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontWeight: '800'
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {collection.savedVersions.map((version, idx) => (
                  <div
                    key={version.id}
                    style={{
                      padding: '12px',
                      background: 'var(--background-secondary)',
                      borderRadius: '8px',
                      border: '1px solid var(--background-modifier-border)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontWeight: '700', color: '#ffffff', fontSize: '13px', marginBottom: '4px' }}>
                          {version.label}
                        </div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', fontWeight: '600' }}>
                          {new Date(version.timestamp).toLocaleString()} • {version.itemCount} items
                        </div>
                      </div>
                      <button
                        onClick={() => restoreCollectionVersion(collection.id, version.id)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '10px',
                          background: 'var(--interactive-accent)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: '700'
                        }}
                        title="Restore this version"
                      >
                        ↶ Restore
                      </button>
                    </div>
                    {version.summary && (
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.8)', marginTop: '6px', lineHeight: '1.4' }}>
                        {version.summary.substring(0, 150)}{version.summary.length > 150 ? '...' : ''}
                      </div>
                    )}
                    {version.tags && version.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                        {version.tags.slice(0, 5).map(tag => (
                          <span key={tag} style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            background: 'var(--background-modifier-hover)',
                            color: '#ffffff',
                            borderRadius: '3px',
                            fontWeight: '600'
                          }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add to Project Modal */}
      {showProjectModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProjectModal(false);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div
            style={{
              background: 'var(--background-primary)',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '500px',
              width: '90%',
              border: '2px solid var(--interactive-accent)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>
                Push to ERPNext / Add to Project
              </h3>
              <button
                onClick={() => setShowProjectModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontWeight: '800'
                }}
              >
                ×
              </button>
            </div>
            {activeCollection && (() => {
              const [erpnextConfig, setErpnextConfig] = useState<ERPNextConfig | null>(null);
              const [projectType, setProjectType] = useState<string>('NPD');
              const [isPushing, setIsPushing] = useState(false);
              const [erpnextUrl, setErpnextUrl] = useState('');
              const [erpnextApiKey, setErpnextApiKey] = useState('');
              const [erpnextApiSecret, setErpnextApiSecret] = useState('');

              // Load ERPNext config from localStorage
              useEffect(() => {
                try {
                  const stored = localStorage.getItem('aihp-erpnext-config');
                  if (stored) {
                    const config = JSON.parse(stored);
                    setErpnextConfig(config);
                    setErpnextUrl(config.baseUrl || '');
                    setErpnextApiKey(config.apiKey || '');
                    setErpnextApiSecret(config.apiSecret || '');
                  }
                } catch (e) {
                  console.error('Failed to load ERPNext config:', e);
                }
              }, []);

              const handlePushToERPNext = async () => {
                if (!erpnextUrl || !erpnextApiKey || !erpnextApiSecret) {
                  new Notice('Please configure ERPNext connection details');
                  return;
                }

                setIsPushing(true);
                try {
                  const config: ERPNextConfig = {
                    baseUrl: erpnextUrl,
                    apiKey: erpnextApiKey,
                    apiSecret: erpnextApiSecret,
                  };

                  // Save config
                  localStorage.setItem('aihp-erpnext-config', JSON.stringify(config));
                  setErpnextConfig(config);

                  const client = createERPNextClient(config);
                  const result = await client.pushCollectionAsProject(
                    activeCollection.label,
                    activeCollection.content,
                    activeCollection.tags || [],
                    projectType
                  );

                  new Notice(`✅ Collection pushed to ERPNext as ${projectType} project: ${result.projectId}`);
                  setShowProjectModal(false);
                } catch (error: any) {
                  new Notice(`❌ Failed to push to ERPNext: ${error.message}`);
                  console.error('ERPNext push error:', error);
                } finally {
                  setIsPushing(false);
                }
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#ffffff', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>
                      Project Type
                    </label>
                    <select
                      value={projectType}
                      onChange={(e) => setProjectType(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--background-secondary)',
                        color: '#ffffff',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    >
                      <option value="NPD" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>NPD (New Product Development)</option>
                      <option value="Internal" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Internal Project</option>
                      <option value="Customer" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Customer Project</option>
                      <option value="Research" style={{ background: 'var(--background-primary)', color: '#ffffff', fontWeight: 700 }}>Research</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', color: '#ffffff', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>
                      ERPNext Base URL
                    </label>
                    <input
                      type="text"
                      value={erpnextUrl}
                      onChange={(e) => setErpnextUrl(e.target.value)}
                      placeholder="https://your-instance.erpnext.com"
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--background-secondary)',
                        color: '#ffffff',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', color: '#ffffff', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>
                      API Key (Username)
                    </label>
                    <input
                      type="text"
                      value={erpnextApiKey}
                      onChange={(e) => setErpnextApiKey(e.target.value)}
                      placeholder="ERPNext username"
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--background-secondary)',
                        color: '#ffffff',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', color: '#ffffff', fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>
                      API Secret (Password)
                    </label>
                    <input
                      type="password"
                      value={erpnextApiSecret}
                      onChange={(e) => setErpnextApiSecret(e.target.value)}
                      placeholder="ERPNext password"
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--background-secondary)',
                        color: '#ffffff',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    />
                  </div>

                  <div style={{ 
                    padding: '12px', 
                    background: 'var(--background-secondary)', 
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: 'rgba(255,255,255,0.8)',
                    fontWeight: '600'
                  }}>
                    <strong style={{ color: '#ffffff' }}>What will be created:</strong>
                    <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                      <li>Project: "{activeCollection.label}" ({projectType})</li>
                      <li>Tasks: Up to 10 tasks from collection content</li>
                      <li>Notes: Collection tags as notes</li>
                    </ul>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setShowProjectModal(false)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        background: 'var(--background-secondary)',
                        color: '#ffffff',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '700'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePushToERPNext}
                      disabled={isPushing || !erpnextUrl || !erpnextApiKey || !erpnextApiSecret}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        background: isPushing || !erpnextUrl || !erpnextApiKey || !erpnextApiSecret 
                          ? 'var(--background-modifier-hover)' 
                          : 'var(--interactive-accent)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isPushing || !erpnextUrl || !erpnextApiKey || !erpnextApiSecret ? 'not-allowed' : 'pointer',
                        fontWeight: '700',
                        opacity: isPushing || !erpnextUrl || !erpnextApiKey || !erpnextApiSecret ? 0.6 : 1
                      }}
                    >
                      {isPushing ? '⏳ Pushing...' : '🚀 Push to ERPNext'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};


