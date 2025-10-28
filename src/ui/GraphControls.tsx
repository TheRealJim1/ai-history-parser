import React, { useState } from 'react';
import type { App } from 'obsidian';
import type { GraphBuildOptions } from '../types/graph';
import { buildGraph } from '../services/graphBuilder';
import { writeGraph, resetGraph } from '../services/graphWriter';

type Props = {
  app: App;
  fetchCurrentMessages: () => Promise<any[]>; // use your existing selector
};

export default function GraphControls({ app, fetchCurrentMessages }: Props) {
  const [contextWindow, setCW] = useState(8);
  const [progress, setProgress] = useState<string>('idle');
  const [samplePct, setSamplePct] = useState(20);

  async function doBuild(sampleOnly = false) {
    setProgress('preparing…');
    const msgs = await fetchCurrentMessages();
    
    const opts: GraphBuildOptions = { 
      contextWindow: contextWindow, 
      minTopicLen: 3, 
      maxTopicsPerChunk: 8 
    };
    
    setProgress(`building on ${msgs.length} msgs…`);
    const g = buildGraph(msgs, opts);

    if (sampleOnly) {
      // top-K by degree
      const deg = new Map<string, number>();
      for (const e of g.edges) {
        deg.set(e.from, (deg.get(e.from) || 0) + 1);
        deg.set(e.to, (deg.get(e.to) || 0) + 1);
      }
      
      const keep = new Set([...g.nodes.keys()]
        .sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0))
        .slice(Math.max(10, Math.floor(g.nodes.size * (samplePct / 100)))));
      
      g.nodes.forEach((_, id) => { 
        if (!keep.has(id)) g.nodes.delete(id); 
      });
      g.edges = g.edges.filter(e => g.nodes.has(e.from) && g.nodes.has(e.to));
    }

    setProgress('writing…');
    await writeGraph(app, g, { baseDir: '/_ai-graph', sampleOnly: sampleOnly });
    setProgress('done');
  }

  return (
    <div className="aip-graph-controls">
      <div className="aip-graph-row">
        <label>Context window</label>
        <input 
          type="number" 
          min={4} 
          max={24} 
          value={contextWindow} 
          onChange={e => setCW(+e.target.value)} 
        />
        <button onClick={() => doBuild(false)}>Build Graph</button>
        <button onClick={() => doBuild(true)}>Sample ({samplePct}%)</button>
        <input 
          type="range" 
          min={5} 
          max={80} 
          value={samplePct} 
          onChange={e => setSamplePct(+e.target.value)} 
        />
        <button 
          className="aip-btn-danger" 
          onClick={async () => {
            if (confirm('Reset /_ai-graph ?')) { 
              setProgress('resetting…'); 
              await resetGraph(app, '/_ai-graph'); 
              setProgress('idle'); 
            }
          }}
        >
          Reset
        </button>
      </div>
      <div className="aip-graph-row">
        <small>Status: {progress}</small>
      </div>
    </div>
  );
}
