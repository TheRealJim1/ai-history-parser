import React from 'react';

type Props = { app?: any };

export default function App({ app }: Props) {
  return (
    <div style={{padding:'12px'}}>
      <h2 style={{margin:'0 0 8px'}}>AI History Parser</h2>
      <div style={{opacity:0.8}}>React view mounted ✓</div>
      <div style={{marginTop:'12px',fontSize:'12px',opacity:0.7}}>
        Vault: {app?.vault?.getName?.() ?? '(unknown)'}
      </div>
    </div>
  );
}