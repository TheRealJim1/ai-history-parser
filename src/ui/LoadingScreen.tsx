import React from "react";

export interface LoadingStep {
  name: string;
  status: 'pending' | 'loading' | 'complete' | 'error';
  message?: string;
  progress?: number;
  total?: number;
}

interface LoadingScreenProps {
  steps: LoadingStep[];
  currentStep?: string;
  overallProgress?: number;
  error?: string;
  showDevInfo?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  steps,
  currentStep,
  overallProgress,
  error,
  showDevInfo = false
}) => {
  const completedSteps = steps.filter(s => s.status === 'complete').length;
  const totalSteps = steps.length;
  const progressPercent = overallProgress !== undefined 
    ? overallProgress 
    : totalSteps > 0 
      ? (completedSteps / totalSteps) * 100 
      : 0;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'var(--background-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '40px',
      fontFamily: 'var(--font-text)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '600px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            marginBottom: '8px',
            color: 'var(--text-normal)'
          }}>
            Loading AI History Parser
          </h2>
          {error ? (
            <p style={{ color: 'var(--text-error)', fontSize: '14px', marginTop: '8px' }}>
              {error}
            </p>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              {currentStep || 'Initializing...'}
            </p>
          )}
        </div>

        {/* Overall Progress Bar */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
            fontSize: '12px',
            color: 'var(--text-muted)'
          }}>
            <span>Overall Progress</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: 'var(--background-modifier-border)',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progressPercent}%`,
              height: '100%',
              backgroundColor: error ? 'var(--text-error)' : 'var(--interactive-accent)',
              transition: 'width 0.3s ease',
              borderRadius: '4px'
            }} />
          </div>
        </div>

        {/* Step List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '300px',
          overflowY: 'auto',
          padding: '12px',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--background-modifier-border)'
        }}>
          {steps.map((step, index) => {
            const isActive = step.status === 'loading' || (step.status === 'pending' && index === 0);
            const isComplete = step.status === 'complete';
            const isError = step.status === 'error';

            return (
              <div
                key={step.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px',
                  borderRadius: '4px',
                  backgroundColor: isActive ? 'var(--background-modifier-hover)' : 'transparent',
                  transition: 'all 0.2s ease'
                }}
              >
                {/* Status Icon */}
                <div style={{
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {isError ? (
                    <span style={{ color: 'var(--text-error)', fontSize: '16px' }}>✕</span>
                  ) : isComplete ? (
                    <span style={{ color: 'var(--interactive-accent)', fontSize: '16px' }}>✓</span>
                  ) : isActive ? (
                    <div style={{
                      width: '12px',
                      height: '12px',
                      border: '2px solid var(--interactive-accent)',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite'
                    }} />
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>○</span>
                  )}
                </div>

                {/* Step Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: isActive ? '600' : '400',
                    color: isError 
                      ? 'var(--text-error)' 
                      : isActive 
                        ? 'var(--text-normal)' 
                        : isComplete 
                          ? 'var(--text-muted)' 
                          : 'var(--text-muted)',
                    marginBottom: step.message || step.progress !== undefined ? '4px' : '0'
                  }}>
                    {step.name}
                  </div>
                  {step.message && (
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {step.message}
                    </div>
                  )}
                  {step.progress !== undefined && step.total !== undefined && (
                    <div style={{ marginTop: '4px' }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        marginBottom: '2px'
                      }}>
                        <span>{step.progress} / {step.total}</span>
                        <span>{Math.round((step.progress / step.total) * 100)}%</span>
                      </div>
                      <div style={{
                        width: '100%',
                        height: '4px',
                        backgroundColor: 'var(--background-modifier-border)',
                        borderRadius: '2px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${(step.progress / step.total) * 100}%`,
                          height: '100%',
                          backgroundColor: 'var(--interactive-accent)',
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dev Info Panel */}
        {showDevInfo && (
          <details style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--background-modifier-border)',
            fontSize: '11px',
            fontFamily: 'var(--font-monospace)'
          }}>
            <summary style={{
              cursor: 'pointer',
              fontWeight: '600',
              marginBottom: '8px',
              color: 'var(--text-normal)'
            }}>
              Developer Info (Click to expand)
            </summary>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              color: 'var(--text-muted)',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              <div>
                <strong>Current Step:</strong> {currentStep || 'None'}
              </div>
              <div>
                <strong>Overall Progress:</strong> {Math.round(progressPercent)}%
              </div>
              <div>
                <strong>Completed Steps:</strong> {completedSteps} / {totalSteps}
              </div>
              <div>
                <strong>Steps Status:</strong>
                <pre style={{
                  marginTop: '4px',
                  padding: '8px',
                  backgroundColor: 'var(--background-primary)',
                  borderRadius: '4px',
                  fontSize: '10px',
                  overflow: 'auto'
                }}>
                  {JSON.stringify(steps, null, 2)}
                </pre>
              </div>
              <div>
                <strong>Console:</strong> Open DevTools (F12) to see detailed logs
              </div>
            </div>
          </details>
        )}

        {/* Instructions */}
        <div style={{
          textAlign: 'center',
          fontSize: '11px',
          color: 'var(--text-muted)',
          padding: '12px',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: '6px'
        }}>
          <div style={{ marginBottom: '4px' }}>
            💡 <strong>Debug Tips:</strong>
          </div>
          <div style={{ lineHeight: '1.6' }}>
            • Press <kbd style={{
              padding: '2px 6px',
              backgroundColor: 'var(--background-modifier-border)',
              borderRadius: '3px',
              fontSize: '10px'
            }}>F12</kbd> to open DevTools Console
            <br />
            • Check the Console tab for detailed loading logs
            <br />
            • Look for messages starting with 🔄, ✅, or ❌
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

