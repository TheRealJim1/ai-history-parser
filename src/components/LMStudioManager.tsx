import React, { useState, useEffect } from 'react';
import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type AIHistoryParser from '../main';

interface LMStudioModel {
  id: string;
  name: string;
  object: string;
  created: number;
  owned_by: string;
}

interface LMStudioManagerProps {
  plugin: AIHistoryParser;
  app: App;
  onClose: () => void;
}

interface ModelConfig {
  task: 'vision' | 'embeddings' | 'chat';
  backend: 'lmstudio' | 'ollama';
  modelId: string;
  enabled: boolean;
}

interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export const LMStudioManager: React.FC<LMStudioManagerProps> = ({ plugin, app, onClose }) => {
  const [lmStudioUrl, setLMStudioUrl] = useState<string>(
    plugin.settings.pythonPipeline?.lmStudio?.url || 'http://localhost:1234'
  );
  const [ollamaUrl, setOllamaUrl] = useState<string>(
    plugin.settings.pythonPipeline?.aiAnnotation?.url || 'http://localhost:11434'
  );
  const [isConnectingLMStudio, setIsConnectingLMStudio] = useState(false);
  const [isConnectingOllama, setIsConnectingOllama] = useState(false);
  const [isConnectedLMStudio, setIsConnectedLMStudio] = useState(false);
  const [isConnectedOllama, setIsConnectedOllama] = useState(false);
  const [availableLMStudioModels, setAvailableLMStudioModels] = useState<LMStudioModel[]>([]);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>('');
  
  // Model configurations for different tasks
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([
    {
      task: 'vision',
      backend: (plugin.settings.pythonPipeline?.lmStudio?.visionBackend as 'lmstudio' | 'ollama') || 'lmstudio',
      modelId: plugin.settings.pythonPipeline?.lmStudio?.visionModel || '',
      enabled: plugin.settings.pythonPipeline?.lmStudio?.visionEnabled || false,
    },
    {
      task: 'embeddings',
      backend: (plugin.settings.pythonPipeline?.lmStudio?.embeddingsBackend as 'lmstudio' | 'ollama') || 'lmstudio',
      modelId: plugin.settings.pythonPipeline?.lmStudio?.embeddingsModel || '',
      enabled: plugin.settings.pythonPipeline?.lmStudio?.embeddingsEnabled || false,
    },
    {
      task: 'chat',
      backend: (plugin.settings.pythonPipeline?.lmStudio?.chatBackend as 'lmstudio' | 'ollama') || 'lmstudio',
      modelId: plugin.settings.pythonPipeline?.lmStudio?.chatModel || '',
      enabled: plugin.settings.pythonPipeline?.lmStudio?.chatEnabled || false,
    },
  ]);

  // Fetch available models from LM Studio
  const fetchLMStudioModels = async () => {
    setIsConnectingLMStudio(true);
    setError('');
    
    try {
      const response = await fetch(`${lmStudioUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.data && Array.isArray(data.data)) {
        setAvailableLMStudioModels(data.data);
        setIsConnectedLMStudio(true);
        setError('');
      } else {
        throw new Error('Invalid response format from LM Studio');
      }
    } catch (err: any) {
      setError(`LM Studio: ${err.message || 'Failed to connect'}`);
      setIsConnectedLMStudio(false);
      setAvailableLMStudioModels([]);
    } finally {
      setIsConnectingLMStudio(false);
    }
  };

  // Fetch available models from Ollama
  const fetchOllamaModels = async () => {
    setIsConnectingOllama(true);
    setError('');
    
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.models && Array.isArray(data.models)) {
        setAvailableOllamaModels(data.models);
        setIsConnectedOllama(true);
        setError('');
      } else {
        throw new Error('Invalid response format from Ollama');
      }
    } catch (err: any) {
      setError(`Ollama: ${err.message || 'Failed to connect'}`);
      setIsConnectedOllama(false);
      setAvailableOllamaModels([]);
    } finally {
      setIsConnectingOllama(false);
    }
  };

  // Test connections on URL change
  useEffect(() => {
    if (lmStudioUrl && lmStudioUrl.trim() !== '') {
      const timeout = setTimeout(() => {
        fetchLMStudioModels();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [lmStudioUrl]);

  useEffect(() => {
    if (ollamaUrl && ollamaUrl.trim() !== '') {
      const timeout = setTimeout(() => {
        fetchOllamaModels();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [ollamaUrl]);

  // Save settings
  const handleSave = async () => {
    if (!plugin.settings.pythonPipeline) {
      plugin.settings.pythonPipeline = {} as any;
    }

    plugin.settings.pythonPipeline.lmStudio = {
      url: lmStudioUrl,
      ollamaUrl: ollamaUrl,
      visionModel: modelConfigs.find(m => m.task === 'vision')?.modelId || '',
      visionBackend: modelConfigs.find(m => m.task === 'vision')?.backend || 'lmstudio',
      visionEnabled: modelConfigs.find(m => m.task === 'vision')?.enabled || false,
      embeddingsModel: modelConfigs.find(m => m.task === 'embeddings')?.modelId || '',
      embeddingsBackend: modelConfigs.find(m => m.task === 'embeddings')?.backend || 'lmstudio',
      embeddingsEnabled: modelConfigs.find(m => m.task === 'embeddings')?.enabled || false,
      chatModel: modelConfigs.find(m => m.task === 'chat')?.modelId || '',
      chatBackend: modelConfigs.find(m => m.task === 'chat')?.backend || 'lmstudio',
      chatEnabled: modelConfigs.find(m => m.task === 'chat')?.enabled || false,
    };

    await plugin.saveSettings();
    new Notice('AI model settings saved!');
    onClose();
  };

  const updateModelConfig = (task: 'vision' | 'embeddings' | 'chat', field: 'modelId' | 'enabled' | 'backend', value: any) => {
    setModelConfigs(prev => 
      prev.map(config => 
        config.task === task ? { ...config, [field]: value } : config
      )
    );
  };

  const getTaskDescription = (task: string) => {
    switch (task) {
      case 'vision':
        return 'Image tagging and description during import';
      case 'embeddings':
        return 'Text embeddings for semantic search';
      case 'chat':
        return 'Conversation analysis and AI features';
      default:
        return '';
    }
  };

  const getRecommendedModels = (task: string, backend: 'lmstudio' | 'ollama') => {
    if (backend === 'lmstudio') {
      return availableLMStudioModels.filter(model => {
        const name = model.name.toLowerCase();
        switch (task) {
          case 'vision':
            return name.includes('vision') || name.includes('llava') || name.includes('granite-vision');
          case 'embeddings':
            return name.includes('embed') || 
                   name.includes('nomic-embed') || 
                   name.includes('arctic-embed') ||
                   name.includes('minilm') ||
                   name.includes('instructor') || 
                   name.includes('bge') ||
                   name.includes('text-embedding');
          case 'chat':
            return !name.includes('vision') && 
                   !name.includes('embed') && 
                   !name.includes('minilm') &&
                   !name.includes('nomic-embed') &&
                   !name.includes('arctic-embed');
          default:
            return true;
        }
      });
    } else {
      // Ollama models
      return availableOllamaModels.filter(model => {
        const name = model.name.toLowerCase();
        switch (task) {
          case 'vision':
            return name.includes('llava') || name.includes('vision') || name.includes('bakllava');
          case 'embeddings':
            return name.includes('embed') || name.includes('nomic-embed') || name.includes('bge');
          case 'chat':
            return !name.includes('llava') && !name.includes('vision') && !name.includes('embed');
          default:
            return true;
        }
      });
    }
  };

  const getAllModels = (backend: 'lmstudio' | 'ollama') => {
    if (backend === 'lmstudio') {
      return availableLMStudioModels;
    } else {
      return availableOllamaModels;
    }
  };
  
  const getModelRecommendation = (task: string) => {
    // Provide specific recommendations based on task
    switch (task) {
      case 'vision':
        return 'Recommended: granite-vision-3.2-2b or llava-v1.6-mistral-7b (Q4 quantization for 6GB VRAM)';
      case 'embeddings':
        return 'Recommended: nomic-embed-text-v1.5 (Q5_K_M or Q8_0) or snowflake-arctic-embed-m-v1.5';
      case 'chat':
        return 'Recommended: Any chat-optimized model (llama3.2, mistral, etc.)';
      default:
        return '';
    }
  };

  return (
    <div className="modal-container" style={{ padding: '20px', maxWidth: '900px' }}>
      <h2 style={{ marginTop: 0 }}>AI Model Configuration</h2>
      <div style={{ marginBottom: '16px', fontSize: '12px', opacity: 0.8 }}>
        Configure LM Studio (recommended) or Ollama for vision, embeddings, and chat tasks. 
        You can mix and match - use LM Studio for some tasks and Ollama for others.
      </div>
      
      {/* URL Configuration */}
      <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* LM Studio URL */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            LM Studio API URL
          </label>
          <input
            type="text"
            value={lmStudioUrl}
            onChange={(e) => setLMStudioUrl(e.target.value)}
            placeholder="http://localhost:1234"
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--background-primary)',
              color: 'var(--text-normal)',
            }}
          />
          <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.7 }}>
            e.g., http://192.168.81.1:1234
          </div>
          {isConnectingLMStudio && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Connecting...</div>
          )}
          {isConnectedLMStudio && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-success)' }}>
              ✅ {availableLMStudioModels.length} model(s)
            </div>
          )}
          <button
            onClick={fetchLMStudioModels}
            disabled={isConnectingLMStudio || !lmStudioUrl}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--interactive-normal)',
              color: 'var(--text-on-accent)',
              cursor: isConnectingLMStudio || !lmStudioUrl ? 'not-allowed' : 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
        
        {/* Ollama URL */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Ollama API URL (Alternative)
          </label>
          <input
            type="text"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="http://localhost:11434"
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--background-primary)',
              color: 'var(--text-normal)',
            }}
          />
          <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.7 }}>
            e.g., http://localhost:11434
          </div>
          {isConnectingOllama && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Connecting...</div>
          )}
          {isConnectedOllama && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-success)' }}>
              ✅ {availableOllamaModels.length} model(s)
            </div>
          )}
          <button
            onClick={fetchOllamaModels}
            disabled={isConnectingOllama || !ollamaUrl}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--interactive-normal)',
              color: 'var(--text-on-accent)',
              cursor: isConnectingOllama || !ollamaUrl ? 'not-allowed' : 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      
      {error && (
        <div style={{ marginBottom: '16px', padding: '8px', background: 'var(--background-modifier-error)', borderRadius: '4px', fontSize: '12px', color: 'var(--text-error)' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Model Selection for Each Task */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '12px' }}>Model Configuration</h3>
        
        {['vision', 'embeddings', 'chat'].map((task) => {
          const config = modelConfigs.find(m => m.task === task);
          const recommended = getRecommendedModels(task);
          const allModels = availableModels.length > 0 ? availableModels : [];
          
          return (
            <div
              key={task}
              style={{
                marginBottom: '20px',
                padding: '16px',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                background: 'var(--background-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config?.enabled || false}
                  onChange={(e) => updateModelConfig(task as any, 'enabled', e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <label style={{ fontWeight: 'bold', textTransform: 'capitalize', marginRight: '8px' }}>
                  {task} Model
                </label>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                  {getTaskDescription(task)}
                </span>
              </div>
              
              {config?.enabled && (
                <div>
                  <select
                    value={config.modelId}
                    onChange={(e) => updateModelConfig(task as any, 'modelId', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '4px',
                      border: '1px solid var(--background-modifier-border)',
                      background: 'var(--background-primary)',
                      color: 'var(--text-normal)',
                    }}
                  >
                    <option value="">Select a model...</option>
                    {recommended.length > 0 && (
                      <optgroup label="Recommended">
                        {recommended.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} {model.owned_by ? `(${model.owned_by})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {allModels.length > 0 && (
                      <optgroup label="All Models">
                        {allModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} {model.owned_by ? `(${model.owned_by})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  
                  {recommended.length === 0 && allModels.length === 0 && (
                    <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.7 }}>
                      No models available. Connect to LM Studio first.
                    </div>
                  )}
                  
                  {recommended.length > 0 && (
                    <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8, fontStyle: 'italic' }}>
                      💡 {getModelRecommendation(task)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Use Cases Info */}
      <div style={{
        marginBottom: '20px',
        padding: '12px',
        background: 'var(--background-secondary-alt)',
        borderRadius: '6px',
        fontSize: '12px',
      }}>
        <strong>Use Cases:</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li><strong>Vision:</strong> Automatically tag images during folder import (e.g., Granite Vision 3.2 2B, LLaVA)</li>
          <li><strong>Embeddings:</strong> Generate semantic embeddings for search and similarity (e.g., nomic-embed-text-v1.5, snowflake-arctic-embed)</li>
          <li><strong>Chat:</strong> AI-powered conversation analysis, summaries, and Q&A features (e.g., llama3.2, mistral)</li>
        </ul>
        <div style={{ marginTop: '12px', padding: '8px', background: 'var(--background-primary)', borderRadius: '4px', fontSize: '11px' }}>
          <strong>Note:</strong> LM Studio shows models with "Text Embedding" label for embedding models. 
          These are optimized for generating vector embeddings, not for chat or vision tasks.
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: '1px solid var(--background-modifier-border)',
            background: 'var(--background-secondary)',
            color: 'var(--text-normal)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--interactive-accent)',
            color: 'var(--text-on-accent)',
            cursor: 'pointer',
          }}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
};

