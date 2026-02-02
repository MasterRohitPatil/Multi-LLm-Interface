import React, { useRef, useEffect, useState } from 'react';
import { ChatPane as ChatPaneType, Message, SelectedContent } from '../../types';
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import './ChatPane.css';

export interface ChatPaneProps {
  pane: ChatPaneType;
  onSelectContent?: (content: SelectedContent) => void;
  onSendTo?: (paneId: string) => void;
  onSendMessage?: (paneId: string, message: string) => void;
  isCompareMode?: boolean;
  compareHighlights?: Array<{
    type: 'added' | 'removed' | 'unchanged';
    text: string;
    startIndex: number;
    endIndex: number;
  }>;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  pane,
  onSelectContent,
  onSendTo,
  onSendMessage,
  isCompareMode = false,
  compareHighlights = []
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef<number>(0);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [inputMessage, setInputMessage] = useState('');

  // Auto-scroll to bottom ONLY when new messages are added to THIS pane
  useEffect(() => {
    const currentMessageCount = pane.messages.length;

    // Only scroll if message count actually increased (new message added)
    if (currentMessageCount > prevMessageCountRef.current) {
      // Scroll to bottom using multiple methods for reliability
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }

      // Also scroll the container to bottom
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }

    // Update the previous count
    prevMessageCountRef.current = currentMessageCount;
  }, [pane.messages.length]);

  // Also scroll on streaming updates (when message content changes)
  useEffect(() => {
    const lastMessage = pane.messages[pane.messages.length - 1];
    if (lastMessage && pane.isStreaming) {
      // During streaming, scroll to bottom
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  }, [pane.messages, pane.isStreaming]);

  const handleMessageSelect = (messageId: string) => {
    if (!isSelectionMode) return;

    const newSelection = new Set(selectedMessages);
    if (newSelection.has(messageId)) {
      newSelection.delete(messageId);
    } else {
      newSelection.add(messageId);
    }
    setSelectedMessages(newSelection);

    // Update selected content
    if (onSelectContent) {
      const selectedMsgs = pane.messages.filter(m => newSelection.has(m.id));
      const selectedText = selectedMsgs.map(m => m.content).join('\n\n');
      onSelectContent({
        messageIds: Array.from(newSelection),
        text: selectedText
      });
    }
  };

  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    if (isSelectionMode) {
      setSelectedMessages(new Set());
      onSelectContent?.({ messageIds: [], text: '' });
    }
  };

  const selectAllMessages = () => {
    const allIds = new Set(pane.messages.map(m => m.id));
    setSelectedMessages(allIds);

    if (onSelectContent) {
      const selectedText = pane.messages.map(m => m.content).join('\n\n');
      onSelectContent({
        messageIds: Array.from(allIds),
        text: selectedText
      });
    }
  };

  const clearSelection = () => {
    setSelectedMessages(new Set());
    onSelectContent?.({ messageIds: [], text: '' });
  };

  const handleSendMessage = () => {
    if (inputMessage.trim() && onSendMessage && !pane.isStreaming) {
      onSendMessage(pane.id, inputMessage.trim());
      setInputMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const renderMessageContent = (message: Message) => {
    if (!isCompareMode || compareHighlights.length === 0) {
      // Render markdown for normal messages
      return (
        <div className="message-text">
          <MarkdownRenderer content={message.content} />
        </div>
      );
    }

    // Apply compare highlights to message content
    let highlightedContent = message.content;
    const highlights = compareHighlights.filter(h =>
      message.content.includes(h.text)
    );

    if (highlights.length > 0) {
      // Sort highlights by start index to apply them in order
      highlights.sort((a, b) => a.startIndex - b.startIndex);

      let offset = 0;
      highlights.forEach(highlight => {
        const startIndex = highlight.startIndex + offset;
        const endIndex = highlight.endIndex + offset;
        const beforeText = highlightedContent.substring(0, startIndex);
        const highlightText = highlightedContent.substring(startIndex, endIndex);
        const afterText = highlightedContent.substring(endIndex);

        const wrappedText = `<span class="diff-${highlight.type}">${highlightText}</span>`;
        highlightedContent = beforeText + wrappedText + afterText;
        offset += wrappedText.length - highlightText.length;
      });
    }

    return (
      <div
        className="message-text"
        dangerouslySetInnerHTML={{ __html: highlightedContent }}
      />
    );
  };

  return (
    <div className={`chat-pane ${isCompareMode ? 'compare-mode' : ''}`}>
      {/* Pane Header */}
      <div className="pane-header">
        <div className="model-info">
          <h4 className="model-name">
            {pane.modelInfo.provider}:{pane.modelInfo.name}
          </h4>
          <div className="model-details">
            <span className="model-detail">
              Max: {pane.modelInfo.maxTokens.toLocaleString()}
            </span>
            <span className="model-detail">
              Cost/1K: ${pane.modelInfo.costPer1kTokens.toFixed(4)}
            </span>
            {pane.modelInfo.supportsStreaming && (
              <span className="streaming-support">📡</span>
            )}
          </div>
        </div>

        <div className="pane-metrics">
          <div className="metric">
            <span className="metric-label">Tokens:</span>
            <span className="metric-value">{pane.metrics.tokenCount}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Cost:</span>
            <span className="metric-value">${pane.metrics.cost.toFixed(4)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Latency:</span>
            <span className="metric-value">{pane.metrics.latency}ms</span>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div className="messages-container" ref={messagesContainerRef}>
        {pane.messages.length === 0 ? (
          <div className="empty-messages">
            <p>No messages yet. Start a broadcast to see responses here.</p>
          </div>
        ) : (
          pane.messages.map((message) => (
            <div
              key={message.id}
              className={`message message-${message.role} ${selectedMessages.has(message.id) ? 'selected' : ''
                } ${isSelectionMode ? 'selectable' : ''}`}
              onClick={() => handleMessageSelect(message.id)}
            >
              <div className="message-header">
                <div className="message-meta">
                  <span className="message-role">{message.role}</span>
                  <span className="message-time">
                    {formatTimestamp(message.timestamp)}
                  </span>

                </div>
                {isSelectionMode && (
                  <div className="selection-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedMessages.has(message.id)}
                      onChange={() => handleMessageSelect(message.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
              </div>

              <div className="message-content">
                {renderMessageContent(message)}

                {message.metadata && (
                  <div className="message-metadata">
                    {message.metadata.tokenCount && (
                      <span className="metadata-item">
                        {message.metadata.tokenCount} tokens
                      </span>
                    )}
                    {message.metadata.cost && (
                      <span className="metadata-item">
                        ${message.metadata.cost.toFixed(4)}
                      </span>
                    )}
                    {message.metadata.latency && (
                      <span className="metadata-item">
                        {message.metadata.latency}ms
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Streaming Indicator */}
        {pane.isStreaming && (
          <div className="streaming-indicator">
            <div className="streaming-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="streaming-text">
              {pane.modelInfo.name} is generating response...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <div className="chat-input-section">
        <div className="chat-input-container">
          <textarea
            className="chat-input"
            placeholder={`Chat with ${pane.modelInfo.name}...`}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={pane.isStreaming}
            rows={2}
          />
          <button
            className="send-btn"
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || pane.isStreaming}
            title="Send message (Enter)"
          >
            {pane.isStreaming ? '⏳' : '📤'}
          </button>
        </div>
      </div>

      {/* Pane Actions */}
      <div className="pane-actions">
        <div className="selection-actions">
          <button
            className={`action-btn ${isSelectionMode ? 'active' : ''}`}
            onClick={toggleSelectionMode}
            title="Toggle message selection mode"
          >
            {isSelectionMode ? '✓ Select Mode' : '☐ Select'}
          </button>

          {isSelectionMode && (
            <>
              <button
                className="action-btn secondary"
                onClick={selectAllMessages}
                title="Select all messages"
              >
                Select All
              </button>
              <button
                className="action-btn secondary"
                onClick={clearSelection}
                title="Clear selection"
              >
                Clear
              </button>
            </>
          )}
        </div>

        <div className="transfer-actions">
          {selectedMessages.size > 0 && onSendTo && (
            <button
              className="action-btn primary"
              onClick={() => onSendTo(pane.id)}
              title="Send selected messages to another pane"
            >
              Send To... ({selectedMessages.size})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};