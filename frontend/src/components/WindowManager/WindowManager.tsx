import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { marked } from 'marked';
import './WindowManager.css';

// Import WinBox CSS
import 'winbox/dist/css/winbox.min.css';

// WinBox constructor type
interface WinBoxConstructor {
  new(options: any): any;
}

// Dynamic import for WinBox to handle ES module issues
let WinBoxClass: WinBoxConstructor | null = null;

// Load WinBox dynamically using npm package
const loadWinBox = async (): Promise<WinBoxConstructor | null> => {
  if (!WinBoxClass) {
    try {
      // Import WinBox module from npm package
      const winboxModule = await import('winbox');
      // Handle different export patterns
      WinBoxClass = (winboxModule as any).default || winboxModule;

      // Verify it's a constructor
      if (typeof WinBoxClass !== 'function') {
        console.error('WinBox is not a constructor function');
        return null;
      }

      console.log('WinBox loaded successfully from npm package');
    } catch (error) {
      console.error('Failed to load WinBox:', error);
      return null;
    }
  }
  return WinBoxClass;
};

export const WindowManager: React.FC = () => {
  const {
    activePanes,
    registerWindow,
    unregisterWindow
  } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<Map<string, any>>(new Map());

  // Initialize WinBox on component mount
  useEffect(() => {
    loadWinBox();
  }, []);

  useEffect(() => {
    const initializeWindows = async () => {
      // Create windows for new panes
      for (const pane of Object.values(activePanes)) {
        if (!windowsRef.current.has(pane.id)) {
          await createWindow(pane);
        }
      }

      // Remove windows for deleted panes
      windowsRef.current.forEach((window, paneId) => {
        if (!activePanes[paneId]) {
          window.close();
          windowsRef.current.delete(paneId);
          unregisterWindow(paneId);
        }
      });
    };

    initializeWindows();
  }, [activePanes, unregisterWindow]);

  const createWindow = async (pane: any) => {
    if (!containerRef.current) return;

    const WinBoxConstructor = await loadWinBox();
    if (!WinBoxConstructor) {
      console.error('WinBox constructor not available');
      return;
    }

    const windowCount = windowsRef.current.size;
    const offsetX = (windowCount % 3) * 50;
    const offsetY = Math.floor(windowCount / 3) * 50;

    const winbox = new WinBoxConstructor({
      title: `${pane.modelInfo.provider}:${pane.modelInfo.name}`,
      width: 400,
      height: 500,
      x: 100 + offsetX,
      y: 100 + offsetY,
      root: containerRef.current,
      class: ['chat-pane-window'],
      html: createPaneContent(pane),
      onclose: () => {
        windowsRef.current.delete(pane.id);
        unregisterWindow(pane.id);
        return false; // Prevent default close, we'll handle it
      },
      onresize: (_width: number, _height: number) => {
        // Handle window resize if needed
      },
      onmove: (_x: number, _y: number) => {
        // Handle window move if needed
      }
    });

    windowsRef.current.set(pane.id, winbox);
    registerWindow(pane.id, winbox);
  };

  const createPaneContent = (pane: any): string => {
    const messagesHtml = pane.messages.map((message: any) => {
      // Parse markdown content to HTML
      const parsedContent = marked.parse(message.content, {
        breaks: true,
        gfm: true
      }) as string;

      return `
        <div class="message message-${message.role}">
          <div class="message-header">
            <span class="message-role">${message.role}</span>
            <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
          </div>
          <div class="message-content">${parsedContent}</div>
          ${message.provenance ? `
            <div class="message-provenance">
              From: ${message.provenance.sourceModel} (${message.provenance.sourcePaneId})
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const streamingIndicator = pane.isStreaming ? `
      <div class="streaming-indicator">
        <div class="streaming-dots">
          <span></span><span></span><span></span>
        </div>
        <span>Streaming response...</span>
      </div>
    ` : '';

    const metricsHtml = `
      <div class="pane-metrics">
        <div class="metric">
          <span class="metric-label">Latency:</span>
          <span class="metric-value">${pane.metrics.latency}ms</span>
        </div>
      </div>
    `;

    return `
      <div class="chat-pane-content" data-pane-id="${pane.id}">
        <div class="pane-header">
          <div class="model-info">
            <h4>${pane.modelInfo.provider}:${pane.modelInfo.name}</h4>
            <span class="model-details">Max tokens: ${pane.modelInfo.maxTokens}</span>
          </div>
          ${metricsHtml}
        </div>
        
        <div class="messages-container">
          ${messagesHtml}
          ${streamingIndicator}
        </div>
        
        <div class="pane-actions">
          <button class="action-btn" onclick="window.selectMessages('${pane.id}')">
            Select Messages
          </button>
          <button class="action-btn" onclick="window.sendToPane('${pane.id}')">
            Send To...
          </button>
        </div>
      </div>
    `;
  };

  // Expose functions to window for button clicks
  useEffect(() => {
    (window as any).selectMessages = (paneId: string) => {
      console.log('Select messages for pane:', paneId);
      // This will be implemented in future tasks
    };

    (window as any).sendToPane = (paneId: string) => {
      console.log('Send to pane:', paneId);
      // This will be implemented in future tasks
    };

    return () => {
      delete (window as any).selectMessages;
      delete (window as any).sendToPane;
    };
  }, []);

  // Update window content when pane data changes
  useEffect(() => {
    Object.values(activePanes).forEach(pane => {
      const window = windowsRef.current.get(pane.id);
      if (window) {
        window.body.innerHTML = createPaneContent(pane);
      }
    });
  }, [activePanes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      windowsRef.current.forEach(window => {
        window.close();
      });
      windowsRef.current.clear();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="window-manager-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {Object.keys(activePanes).length === 0 && (
        <div className="no-panes-message">
          <p>No active panes. Start a broadcast to create chat panes.</p>
        </div>
      )}
    </div>
  );
};