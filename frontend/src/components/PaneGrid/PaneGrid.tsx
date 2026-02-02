import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { marked } from 'marked';
import './PaneGrid.css';
import '../ChatPane/ChatPane.css';

// Import WinBox CSS
import 'winbox/dist/css/winbox.min.css';

// WinBox constructor type
interface WinBoxConstructor {
  new(options: any): any;
}

// Use a simple approach - load WinBox from the installed npm package
let WinBoxConstructor: WinBoxConstructor | null = null;

// Initialize WinBox on first use
const initWinBox = async (): Promise<WinBoxConstructor | null> => {
  if (WinBoxConstructor) {
    return WinBoxConstructor;
  }

  try {
    // Use dynamic import which should work better with Vite
    const winboxModule = await import('winbox');

    // Log what we got to debug
    console.log('WinBox module imported:', winboxModule);

    // Try to find the constructor in different places
    const possibleConstructors = [
      winboxModule.default,
      winboxModule,
      (winboxModule as any).WinBox,
      (window as any).WinBox
    ];

    for (const constructor of possibleConstructors) {
      if (constructor && typeof constructor === 'function') {
        console.log('Found WinBox constructor:', constructor);
        WinBoxConstructor = constructor as WinBoxConstructor;
        return WinBoxConstructor;
      }
    }

    console.error('No valid WinBox constructor found in:', possibleConstructors);
    return null;
  } catch (error) {
    console.error('Failed to import WinBox:', error);
    return null;
  }
};

export interface WindowManagerConfig {
  layout: 'grid' | 'tabs' | 'split';
  resizable: boolean;
  closable: boolean;
  draggable: boolean;
}

export interface PaneGridProps {
  windowManagerConfig?: WindowManagerConfig;
  onPaneAction?: (action: PaneAction) => void;
  onSendMessage?: (paneId: string, message: string) => void;
  isCompareMode?: boolean;
  selectedPanes?: [string, string] | null;
  onArrangeWindows?: () => void;
  onMinimizeAll?: () => void;
  onCloseAll?: () => void;
}

export interface PaneAction {
  type: 'close' | 'select' | 'sendTo';
  paneId: string;
  data?: any;
}

export const PaneGrid: React.FC<PaneGridProps> = ({
  onPaneAction,
  onSendMessage,
  isCompareMode = false,
  selectedPanes = null,
  onArrangeWindows,
  onMinimizeAll,
  onCloseAll
}) => {
  const {
    activePanes,
    registerWindow,
    unregisterWindow,
    removePane
  } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<Map<string, any>>(new Map());
  const selectionStateRef = useRef<{ [paneId: string]: { isSelectionMode: boolean; selectedMessages: Set<string> } }>({});

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

    const WinBoxConstructor = await initWinBox();
    if (!WinBoxConstructor) {
      console.error('WinBox constructor not available');
      return;
    }

    const windowCount = windowsRef.current.size;
    const offsetX = (windowCount % 3) * 50;
    const offsetY = Math.floor(windowCount / 3) * 50;

    // Create a container div for the React component
    const contentDiv = document.createElement('div');
    contentDiv.style.height = '100%';
    contentDiv.style.overflow = 'hidden';

    const winbox = new WinBoxConstructor({
      title: `${pane.modelInfo?.provider || 'Unknown'}:${pane.modelInfo?.name || 'Unknown'}`,
      width: 450,
      height: 600,
      x: 100 + offsetX,
      y: 100 + offsetY,
      root: containerRef.current,
      class: ['chat-pane-window', isCompareMode ? 'compare-mode' : ''].filter(Boolean),
      mount: contentDiv,
      onclose: () => {
        windowsRef.current.delete(pane.id);
        unregisterWindow(pane.id);
        removePane(pane.id);
        onPaneAction?.({ type: 'close', paneId: pane.id });
        return false; // Prevent default close behavior
      },
      onresize: (_width: number, _height: number) => {
        // Handle window resize if needed
      },
      onmove: (_x: number, _y: number) => {
        // Handle window move if needed
      },
      onmaximize: () => {
        // Custom maximize behavior - resize to 1/3 of screen instead of full screen
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const targetWidth = Math.floor(containerRect.width / 3);
          const targetHeight = Math.floor(containerRect.height * 0.8); // 80% of height
          const targetX = 50;
          const targetY = 50;

          // Resize and position the window
          winbox.resize(targetWidth, targetHeight);
          winbox.move(targetX, targetY);
        }
        return false; // Prevent default maximize behavior
      }
    });

    // Render React component into the content div
    renderPaneContent(contentDiv, pane);

    windowsRef.current.set(pane.id, winbox);
    registerWindow(pane.id, winbox);
  };

  const renderPaneContent = (container: HTMLElement, pane: any) => {
    // Debug logging
    console.log('Rendering pane content for:', pane.id, 'Messages:', pane.messages.length, pane.messages);

    // Ensure the container has proper styling
    container.style.background = '#ffffff';
    container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    // Create a properly styled HTML representation that matches the ChatPane component
    const messagesHtml = pane.messages.map((message: any) => {
      // Parse markdown content to HTML
      const parsedContent = marked.parse(message.content, {
        breaks: true,
        gfm: true
      }) as string;

      return `
        <div class="message message-${message.role} selectable" data-message-id="${message.id}" onclick="window.toggleMessageSelection('${pane.id}', '${message.id}')">
          <div class="message-header">
            <div class="message-meta">
              <span class="message-role">${message.role}</span>
              <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>

            </div>
            <div class="selection-checkbox" id="checkbox-${pane.id}-${message.id}" style="display: none;">
              <input type="checkbox" onchange="window.handleMessageCheckbox('${pane.id}', '${message.id}', this.checked)" onclick="event.stopPropagation()">
            </div>
          </div>
          <div class="message-content">
            <div class="message-text">${parsedContent}</div>
          </div>
        </div>
      `;
    }).join('');

    const streamingIndicator = pane.isStreaming ? `
      <div class="streaming-indicator">
        <div class="streaming-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="streaming-text">${pane.modelInfo?.name || 'Model'} is generating response...</span>
      </div>
    ` : '';

    const metricsHtml = `
      <div class="pane-metrics">
        <div class="metric">
          <span class="metric-label">Latency:</span>
          <span class="metric-value">${pane.metrics?.latency || 0}ms</span>
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="chat-pane" data-pane-id="${pane.id}">
        <div class="pane-header">
          <div class="model-info">
            <h4 class="model-name">${pane.modelInfo?.provider || 'Unknown'}:${pane.modelInfo?.name || 'Unknown'}</h4>
            <div class="model-details">
              <span class="model-detail">Max: ${pane.modelInfo.maxTokens ? pane.modelInfo.maxTokens.toLocaleString() : 'N/A'}</span>
            </div>
          </div>
          ${metricsHtml}
        </div>
        
        <div class="messages-container">
          ${pane.messages.length === 0 ? `
            <div class="empty-messages">
              <p>No messages yet. Start a broadcast to see responses here.</p>
            </div>
          ` : messagesHtml}
          ${streamingIndicator}
        </div>
        
        <div class="chat-input-section">
          <div class="chat-input-container">
            <textarea 
              class="chat-input" 
              placeholder="Chat with ${pane.modelInfo?.name || 'Model'}..." 
              rows="2"
              onkeydown="window.handleChatKeyDown(event, '${pane.id}')"
              ${pane.isStreaming ? 'disabled' : ''}
            ></textarea>
            <button 
              class="send-btn" 
              onclick="window.sendChatMessage('${pane.id}')"
              ${pane.isStreaming ? 'disabled' : ''}
              title="Send message (Enter)"
            >
              ${pane.isStreaming ? '⏳' : '📤'}
            </button>
          </div>
        </div>
        
        <div class="pane-actions">
          <div class="selection-actions">
            <button class="action-btn" id="select-btn-${pane.id}" onclick="window.toggleSelectionMode('${pane.id}')">
              Select Messages
            </button>
            <button class="action-btn secondary" id="select-all-btn-${pane.id}" onclick="window.selectAllMessages('${pane.id}')" style="display: none;">
              Select All
            </button>
            <button class="action-btn secondary" id="clear-btn-${pane.id}" onclick="window.clearSelection('${pane.id}')" style="display: none;">
              Clear
            </button>
          </div>
          <div class="transfer-actions">
            <button class="action-btn primary" id="send-to-btn-${pane.id}" onclick="window.sendToPane('${pane.id}')" style="display: none;">
              Send To... (<span id="selected-count-${pane.id}">0</span>)
            </button>
          </div>
        </div>
      </div>
    `;

    // Apply additional styling to ensure proper appearance
    const chatPane = container.querySelector('.chat-pane') as HTMLElement;
    if (chatPane) {
      chatPane.style.cssText = `
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        background: rgba(255, 255, 255, 0.95) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        border-radius: 16px !important;
        overflow: hidden !important;
        backdrop-filter: blur(20px) !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      `;
    }

    // Style the header
    const header = container.querySelector('.pane-header') as HTMLElement;
    if (header) {
      header.style.cssText = `
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        padding: 16px 20px !important;
        background: linear-gradient(135deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.8) 100%) !important;
        border-bottom: 1px solid rgba(226, 232, 240, 0.5) !important;
        gap: 16px !important;
        backdrop-filter: blur(10px) !important;
      `;
    }

    // Style messages
    const messages = container.querySelectorAll('.message');
    messages.forEach((message) => {
      const messageEl = message as HTMLElement;
      const isUser = message.classList.contains('message-user');
      const isAssistant = message.classList.contains('message-assistant');

      messageEl.style.cssText = `
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        padding: 16px 20px !important;
        border-radius: 18px !important;
        backdrop-filter: blur(10px) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        margin-bottom: 16px !important;
        max-width: 75% !important;
        ${isUser ? `
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%) !important;
          border-color: rgba(59, 130, 246, 0.2) !important;
          align-self: flex-end !important;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.1) !important;
        ` : ''}
        ${isAssistant ? `
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%) !important;
          border-color: rgba(16, 185, 129, 0.2) !important;
          align-self: flex-start !important;
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.1) !important;
        ` : ''}
      `;
    });

    // Style message text specifically
    const messageTexts = container.querySelectorAll('.message-text');
    messageTexts.forEach(text => {
      const textEl = text as HTMLElement;
      textEl.style.cssText = `
        font-size: 15px !important;
        line-height: 1.6 !important;
        color: #0f172a !important;
        word-wrap: break-word !important;
        font-weight: 400 !important;
      `;
    });

    // Style the messages container
    const messagesContainer = container.querySelector('.messages-container') as HTMLElement;
    if (messagesContainer) {
      messagesContainer.style.cssText = `
        flex: 1 !important;
        overflow-y: auto !important;
        padding: 20px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 16px !important;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, rgba(248, 250, 252, 0.05) 100%) !important;
      `;
    }

    // Style input section
    const inputSection = container.querySelector('.chat-input-section') as HTMLElement;
    if (inputSection) {
      inputSection.style.cssText = `
        border-top: 1px solid rgba(226, 232, 240, 0.5) !important;
        background: linear-gradient(135deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.8) 100%) !important;
        padding: 16px 20px !important;
        backdrop-filter: blur(10px) !important;
      `;
    }

    // Style input container
    const inputContainer = container.querySelector('.chat-input-container') as HTMLElement;
    if (inputContainer) {
      inputContainer.style.cssText = `
        display: flex !important;
        gap: 8px !important;
        align-items: flex-end !important;
      `;
    }

    // Style input
    const input = container.querySelector('.chat-input') as HTMLElement;
    if (input) {
      input.style.cssText = `
        flex: 1 !important;
        min-height: 44px !important;
        max-height: 120px !important;
        padding: 12px 16px !important;
        border: 1px solid rgba(203, 213, 225, 0.5) !important;
        border-radius: 12px !important;
        font-size: 14px !important;
        background: rgba(255, 255, 255, 0.9) !important;
        color: #0f172a !important;
        font-family: inherit !important;
        resize: vertical !important;
      `;
    }

    // Style send button
    const sendBtn = container.querySelector('.send-btn') as HTMLElement;
    if (sendBtn) {
      sendBtn.style.cssText = `
        padding: 12px 16px !important;
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
        color: white !important;
        border: none !important;
        border-radius: 12px !important;
        cursor: pointer !important;
        min-width: 48px !important;
        height: 44px !important;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      `;
    }

    // Style action buttons
    const actionBtns = container.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
      const btnEl = btn as HTMLElement;
      btnEl.style.cssText = `
        padding: 8px 16px !important;
        border: 1px solid rgba(203, 213, 225, 0.5) !important;
        border-radius: 10px !important;
        background: rgba(255, 255, 255, 0.9) !important;
        color: #475569 !important;
        font-size: 12px !important;
        cursor: pointer !important;
        font-weight: 500 !important;
        white-space: nowrap !important;
        backdrop-filter: blur(10px) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05) !important;
      `;
    });


    // Style code blocks (triple backticks) and add copy button
    const preElements = container.querySelectorAll('.message-text pre');
    preElements.forEach(pre => {
      const preEl = pre as HTMLElement;

      // Make pre element position relative for absolute positioning of button
      preEl.style.cssText = `
        background-color: #f6f8fa !important;
        border-radius: 8px !important;
        padding: 16px !important;
        padding-top: 40px !important;
        overflow-x: auto !important;
        margin: 12px 0 !important;
        border: 1px solid #e1e4e8 !important;
        font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace !important;
        position: relative !important;
      `;

      // Create copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = '📋';
      copyBtn.title = 'Copy code';
      copyBtn.style.cssText = `
        position: absolute !important;
        top: 8px !important;
        right: 8px !important;
        background-color: rgba(255, 255, 255, 0.9) !important;
        border: 1px solid #d0d7de !important;
        border-radius: 6px !important;
        padding: 6px 10px !important;
        cursor: pointer !important;
        font-size: 14px !important;
        transition: all 0.2s ease !important;
        z-index: 10 !important;
      `;

      // Add hover effect
      copyBtn.onmouseenter = () => {
        copyBtn.style.backgroundColor = 'rgba(255, 255, 255, 1) !important';
        copyBtn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1) !important';
      };
      copyBtn.onmouseleave = () => {
        copyBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.9) !important';
        copyBtn.style.boxShadow = 'none !important';
      };

      // Add click handler
      copyBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const codeElement = preEl.querySelector('code');
        const codeText = codeElement?.textContent || '';

        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.innerHTML = '✅';
          copyBtn.title = 'Copied!';
          setTimeout(() => {
            copyBtn.innerHTML = '📋';
            copyBtn.title = 'Copy code';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
          copyBtn.innerHTML = '❌';
          setTimeout(() => {
            copyBtn.innerHTML = '📋';
          }, 2000);
        }
      };

      // Insert copy button at the beginning of pre element
      preEl.insertBefore(copyBtn, preEl.firstChild);
    });

    // Style code inside pre tags
    const preCodeElements = container.querySelectorAll('.message-text pre code');
    preCodeElements.forEach(code => {
      const codeEl = code as HTMLElement;
      codeEl.style.cssText = `
        background-color: transparent !important;
        padding: 0 !important;
        border-radius: 0 !important;
        font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace !important;
        font-size: 0.9em !important;
        line-height: 1.6 !important;
        color: #24292e !important;
        display: block !important;
        font-weight: 400 !important;
      `;
    });

    // Style inline code (backticks) - not inside pre tags
    const inlineCodeElements = container.querySelectorAll('.message-text code:not(pre code)');
    inlineCodeElements.forEach(code => {
      const codeEl = code as HTMLElement;
      codeEl.style.cssText = `
        background-color: rgba(175, 184, 193, 0.2) !important;
        padding: 0.2em 0.4em !important;
        border-radius: 4px !important;
        font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace !important;
        font-size: 0.85em !important;
        color: #d63384 !important;
        font-weight: 500 !important;
      `;
    });
  };



  // Expose functions to window for button clicks
  useEffect(() => {
    (window as any).selectMessages = (paneId: string) => {
      console.log('Select messages for pane:', paneId);
      onPaneAction?.({ type: 'select', paneId });
    };

    // Use persistent selection state from ref
    const selectionState = selectionStateRef.current;

    (window as any).toggleSelectionMode = (paneId: string) => {
      if (!selectionState[paneId]) {
        selectionState[paneId] = { isSelectionMode: false, selectedMessages: new Set() };
      }

      const state = selectionState[paneId];
      state.isSelectionMode = !state.isSelectionMode;

      // Update UI
      const selectBtn = document.getElementById(`select-btn-${paneId}`);
      const selectAllBtn = document.getElementById(`select-all-btn-${paneId}`);
      const clearBtn = document.getElementById(`clear-btn-${paneId}`);
      const sendToBtn = document.getElementById(`send-to-btn-${paneId}`);

      if (state.isSelectionMode) {
        selectBtn!.textContent = '✓ Select Mode';
        selectBtn!.classList.add('active');
        selectAllBtn!.style.display = 'inline-block';
        clearBtn!.style.display = 'inline-block';

        // Show checkboxes
        document.querySelectorAll(`[id^="checkbox-${paneId}-"]`).forEach(checkbox => {
          (checkbox as HTMLElement).style.display = 'block';
        });

        // Add selectable styling
        document.querySelectorAll(`[data-message-id]`).forEach(msg => {
          if (msg.getAttribute('onclick')?.includes(paneId)) {
            msg.classList.add('selectable');
          }
        });
      } else {
        selectBtn!.textContent = '☐ Select';
        selectBtn!.classList.remove('active');
        selectAllBtn!.style.display = 'none';
        clearBtn!.style.display = 'none';
        sendToBtn!.style.display = 'none';

        // Hide checkboxes
        document.querySelectorAll(`[id^="checkbox-${paneId}-"]`).forEach(checkbox => {
          (checkbox as HTMLElement).style.display = 'none';
        });

        // Remove selectable styling and clear selection
        document.querySelectorAll(`[data-message-id]`).forEach(msg => {
          if (msg.getAttribute('onclick')?.includes(paneId)) {
            msg.classList.remove('selectable', 'selected');
          }
        });

        // Clear selection
        state.selectedMessages.clear();
      }
    };

    (window as any).toggleMessageSelection = (paneId: string, messageId: string) => {
      if (!selectionState[paneId] || !selectionState[paneId].isSelectionMode) return;

      const state = selectionState[paneId];
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      const checkbox = document.querySelector(`#checkbox-${paneId}-${messageId} input`) as HTMLInputElement;

      if (state.selectedMessages.has(messageId)) {
        state.selectedMessages.delete(messageId);
        messageElement?.classList.remove('selected');
        if (checkbox) checkbox.checked = false;
      } else {
        state.selectedMessages.add(messageId);
        messageElement?.classList.add('selected');
        if (checkbox) checkbox.checked = true;
      }

      // Update send to button
      const sendToBtn = document.getElementById(`send-to-btn-${paneId}`);
      const selectedCount = document.getElementById(`selected-count-${paneId}`);

      if (state.selectedMessages.size > 0) {
        sendToBtn!.style.display = 'inline-block';
        selectedCount!.textContent = state.selectedMessages.size.toString();
      } else {
        sendToBtn!.style.display = 'none';
      }
    };

    (window as any).handleMessageCheckbox = (paneId: string, messageId: string, checked: boolean) => {
      if (!selectionState[paneId]) return;

      const state = selectionState[paneId];
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);

      if (checked) {
        state.selectedMessages.add(messageId);
        messageElement?.classList.add('selected');
      } else {
        state.selectedMessages.delete(messageId);
        messageElement?.classList.remove('selected');
      }

      // Update send to button
      const sendToBtn = document.getElementById(`send-to-btn-${paneId}`);
      const selectedCount = document.getElementById(`selected-count-${paneId}`);

      if (state.selectedMessages.size > 0) {
        sendToBtn!.style.display = 'inline-block';
        selectedCount!.textContent = state.selectedMessages.size.toString();
      } else {
        sendToBtn!.style.display = 'none';
      }
    };

    (window as any).selectAllMessages = (paneId: string) => {
      if (!selectionState[paneId]) return;

      const state = selectionState[paneId];
      const pane = Object.values(activePanes).find((p: any) => p.id === paneId);
      if (!pane) return;

      // Select all messages
      pane.messages.forEach((message: any) => {
        state.selectedMessages.add(message.id);
        const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
        const checkbox = document.querySelector(`#checkbox-${paneId}-${message.id} input`) as HTMLInputElement;

        messageElement?.classList.add('selected');
        if (checkbox) checkbox.checked = true;
      });

      // Update send to button
      const sendToBtn = document.getElementById(`send-to-btn-${paneId}`);
      const selectedCount = document.getElementById(`selected-count-${paneId}`);

      sendToBtn!.style.display = 'inline-block';
      selectedCount!.textContent = state.selectedMessages.size.toString();
    };

    (window as any).clearSelection = (paneId: string) => {
      if (!selectionState[paneId]) return;

      const state = selectionState[paneId];

      // Clear all selections
      state.selectedMessages.forEach(messageId => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        const checkbox = document.querySelector(`#checkbox-${paneId}-${messageId} input`) as HTMLInputElement;

        messageElement?.classList.remove('selected');
        if (checkbox) checkbox.checked = false;
      });

      state.selectedMessages.clear();

      // Hide send to button
      const sendToBtn = document.getElementById(`send-to-btn-${paneId}`);
      sendToBtn!.style.display = 'none';
    };

    (window as any).sendToPane = (paneId: string) => {
      const pane = Object.values(activePanes).find((p: any) => p.id === paneId);
      if (!pane) return;

      // Get selection state (may be undefined if no selection has been made)
      const state = selectionState[paneId];

      // Get selected messages (or empty if none selected)
      const selectedMessages = state ? pane.messages.filter((msg: any) =>
        state.selectedMessages.has(msg.id)
      ) : [];

      const selectedText = selectedMessages.map((msg: any) => msg.content).join('\n\n');

      const selectedContent = {
        messageIds: state ? Array.from(state.selectedMessages) : [],
        text: selectedText
      };

      console.log('Send to pane:', paneId, selectedContent);
      onPaneAction?.({
        type: 'sendTo',
        paneId,
        data: selectedContent
      });
    };

    (window as any).sendChatMessage = (paneId: string) => {
      const paneElement = document.querySelector(`[data-pane-id="${paneId}"]`);
      const textarea = paneElement?.querySelector('.chat-input') as HTMLTextAreaElement;

      if (textarea && textarea.value.trim()) {
        const message = textarea.value.trim();
        textarea.value = '';
        console.log('Sending chat message to pane:', paneId, message);
        onSendMessage?.(paneId, message);
      }
    };

    (window as any).handleChatKeyDown = (event: KeyboardEvent, paneId: string) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        (window as any).sendChatMessage(paneId);
      }
    };

    return () => {
      delete (window as any).selectMessages;
      delete (window as any).sendToPane;
      delete (window as any).sendChatMessage;
      delete (window as any).handleChatKeyDown;
      delete (window as any).toggleSelectionMode;
      delete (window as any).toggleMessageSelection;
      delete (window as any).handleMessageCheckbox;
      delete (window as any).selectAllMessages;
      delete (window as any).clearSelection;
    };
  }, [onPaneAction, onSendMessage]);

  // Update window content when pane data changes
  useEffect(() => {
    console.log('🔄 PaneGrid: useEffect triggered! activePanes:', Object.keys(activePanes).length);
    console.log('🔄 Available pane IDs:', Object.keys(activePanes));
    console.log('🔄 Window IDs:', Array.from(windowsRef.current.keys()));

    // Force update all windows
    Object.values(activePanes).forEach(pane => {
      const window = windowsRef.current.get(pane.id);
      if (window && window.body) {
        console.log('✅ PaneGrid: Updating pane', pane.id, 'with', pane.messages.length, 'messages');
        console.log('📝 Messages:', pane.messages.map(m => `${m.role}: ${m.content.substring(0, 30)}...`));
        renderPaneContent(window.body, pane);
      } else {
        console.log('❌ PaneGrid: Window not found for pane', pane.id);
      }
    });
  }, [activePanes, isCompareMode, selectedPanes]);



  // Update window styling for compare mode
  useEffect(() => {
    windowsRef.current.forEach((window, paneId) => {
      const isInCompare = selectedPanes?.includes(paneId) || false;
      const windowElement = window.dom;

      if (windowElement) {
        if (isInCompare) {
          windowElement.classList.add('compare-mode');
        } else {
          windowElement.classList.remove('compare-mode');
        }
      }
    });
  }, [selectedPanes]);

  // Window management functions
  const arrangeWindows = () => {
    const windows = Array.from(windowsRef.current.values());
    const cols = Math.ceil(Math.sqrt(windows.length));
    const rows = Math.ceil(windows.length / cols);
    const windowWidth = Math.floor((window.innerWidth - 100) / cols);
    const windowHeight = Math.floor((window.innerHeight - 100) / rows);

    windows.forEach((winbox, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = 50 + col * windowWidth;
      const y = 50 + row * windowHeight;

      winbox.resize(windowWidth - 20, windowHeight - 20);
      winbox.move(x, y);
    });
  };

  const minimizeAllWindows = () => {
    windowsRef.current.forEach(winbox => {
      winbox.minimize();
    });
  };

  const closeAllWindows = () => {
    windowsRef.current.forEach(winbox => {
      winbox.close();
    });
  };

  // Expose window management functions
  useEffect(() => {
    if (onArrangeWindows) {
      (window as any).arrangeWindows = arrangeWindows;
    }
    if (onMinimizeAll) {
      (window as any).minimizeAllWindows = minimizeAllWindows;
    }
    if (onCloseAll) {
      (window as any).closeAllWindows = closeAllWindows;
    }

    return () => {
      delete (window as any).arrangeWindows;
      delete (window as any).minimizeAllWindows;
      delete (window as any).closeAllWindows;
    };
  }, [onArrangeWindows, onMinimizeAll, onCloseAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      windowsRef.current.forEach(window => {
        window.close();
      });
      windowsRef.current.clear();
    };
  }, []);

  const paneCount = Object.keys(activePanes).length;

  return (
    <div className="pane-grid">
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
        {paneCount === 0 && (
          <div className="no-panes-message">
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <h3>No Active Panes</h3>
              <p>Start a broadcast to create chat panes and see responses from multiple LLMs.</p>
              <div className="empty-hint">
                <small>Use the Broadcast Bar above to select models and send your first prompt.</small>
              </div>
            </div>
          </div>
        )}
      </div>

      {isCompareMode && selectedPanes && (
        <div className="compare-mode-indicator">
          <div className="compare-status">
            <span className="compare-icon">⚖️</span>
            <span className="compare-text">
              Comparing {selectedPanes.length} panes
            </span>
          </div>
        </div>
      )}


    </div>
  );
};