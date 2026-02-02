import React, { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '../store';
import { FloatingModelSelector } from '../components/FloatingModelSelector';
import { FloatingToolbar } from '../components/FloatingToolbar';
import { FloatingSessionMetrics } from '../components/FloatingSessionMetrics/FloatingSessionMetrics';
import { PaneGrid } from '../components/PaneGrid';
import { SendToMenu } from '../components/SendToMenu';
import { DiffViewer } from '../components/DiffViewer/DiffViewer';


import { ModelInfo, SelectedContent, TransferContent } from '../types';
import { apiService } from '../services/api';

import './Workspace.css';

export const Workspace: React.FC = () => {
  const {
    currentSession,
    createSession,
    activePanes,
    availableModels,
    isComparing,
    selectedPanes,
    setComparing,
    setSelectedPanes,
    refreshSessionFromBackend,
    addPane,
    addPaneWithId,
    setAvailableModels,
    updatePaneMessages
  } = useAppStore();

  const [isStreaming, setIsStreaming] = useState(false);
  const [sendToMenuVisible, setSendToMenuVisible] = useState(false);
  const [sessionMetricsVisible, setSessionMetricsVisible] = useState(false);


  const [sendToData, setSendToData] = useState<{
    sourcePane: string;
    selectedContent: SelectedContent;
  } | null>(null);


  useEffect(() => {
    // Create a session if none exists
    if (!currentSession) {
      createSession();
    }
  }, [currentSession, createSession]);

  // Initialize WebSocket connection when session is available (using global manager)
  useEffect(() => {
    if (currentSession) {
      console.log(`🔌 Ensuring WebSocket for session: ${currentSession.id}`);
      // WebSocket is now managed globally by the store
      // No need to manage it at component level
    }
  }, [currentSession]);

  // Fetch available models from backend
  useEffect(() => {
    const fetchModels = async () => {
      if (availableModels.length === 0) {
        try {
          console.log('Fetching models from backend...');
          const models = await apiService.getAvailableModels();

          if (models) {
            console.log('Backend response:', models);
            const data = { models };

            if (data.models && Array.isArray(data.models)) {
              // Transform backend model format to frontend format
              const transformedModels = data.models.map((model: any) => ({
                id: model.id,
                name: model.name,
                provider: model.provider,
                maxTokens: model.max_tokens,
                costPer1kTokens: model.cost_per_1k_tokens,
                supportsStreaming: model.supports_streaming
              }));

              setAvailableModels(transformedModels);
              console.log('Successfully loaded models from backend:', transformedModels);
            } else {
              console.warn('Invalid models response format, using fallback');
              setFallbackModels();
            }
          } else {
            console.warn('Backend not available, using fallback models');
            setFallbackModels();
          }
        } catch (error) {
          console.error('Error fetching models from backend:', error);
          setFallbackModels();
        }
      }
    };

    const setFallbackModels = () => {
      const fallbackModels = [
        {
          id: 'gemini-3-flash-preview',
          name: 'Gemini 3 Flash (Preview)',
          provider: 'google',
          maxTokens: 1048576,
          costPer1kTokens: 0.0007,
          supportsStreaming: true
        },
        {
          id: 'llama-3.1-8b-instant',
          name: 'Llama 3.1 8B Instant',
          provider: 'groq',
          maxTokens: 8192,
          costPer1kTokens: 0.0001,
          supportsStreaming: true
        },
        {
          id: 'qwen/qwen3-32b',
          name: 'Qwen 3 32B',
          provider: 'groq',
          maxTokens: 32768,
          costPer1kTokens: 0.0008,
          supportsStreaming: true
        },
        {
          id: 'openai/gpt-oss-120b',
          name: 'GPT OSS 120B',
          provider: 'groq',
          maxTokens: 8192,
          costPer1kTokens: 0.0012,
          supportsStreaming: true
        },
        {
          id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
          name: 'Llama 4 Maverick 17B',
          provider: 'groq',
          maxTokens: 8192,
          costPer1kTokens: 0.0008,
          supportsStreaming: true
        }
      ];

      setAvailableModels(fallbackModels);
      console.log('Using fallback models:', fallbackModels);
    };

    fetchModels();
  }, [availableModels, setAvailableModels]);

  const handleModelSelect = async (model: ModelInfo, prompt?: string) => {
    setIsStreaming(true);

    try {
      // Create pane for the selected model
      addPane(model);

      // If prompt is provided, add messages after a short delay
      if (prompt) {
        setTimeout(() => {
          const currentPanes = Object.values(activePanes);

          // Find the most recently created pane for this model
          const matchingPanes = currentPanes.filter(pane =>
            pane.modelInfo.provider === model.provider &&
            pane.modelInfo.id === model.id
          );

          const targetPane = matchingPanes[matchingPanes.length - 1];

          if (targetPane) {
            // Add user message
            const userMessage = {
              id: `msg-${Date.now()}-user`,
              role: 'user' as const,
              content: prompt,
              timestamp: new Date()
            };

            updatePaneMessages(targetPane.id, userMessage);

            // Add assistant response after a delay (simulated)
            setTimeout(() => {
              const assistantMessage = {
                id: `msg-${Date.now()}-assistant`,
                role: 'assistant' as const,
                content: `This is a simulated response from ${model.name}. In the real implementation, this would be streamed from the backend API.\n\nYour prompt was: "${prompt}"`,
                timestamp: new Date()
              };

              updatePaneMessages(targetPane.id, assistantMessage);
            }, 800);
          }
        }, 300);
      }

      setTimeout(() => setIsStreaming(false), 1200);

    } catch (error) {
      console.error('Model selection failed:', error);
      setIsStreaming(false);
    }
  };

  const handleSendMessage = async (paneId: string, message: string) => {
    if (!currentSession) return;

    const pane = activePanes[paneId];
    if (!pane) return;

    // Add user message to pane
    const userMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user' as const,
      content: message,
      timestamp: new Date()
    };
    updatePaneMessages(paneId, userMessage);

    try {
      // Use apiService to send chat message
      await apiService.sendChatMessage(paneId, currentSession.id, message);
      console.log('✅ Message sent to', pane.modelInfo.name);
    } catch (error) {
      console.error('❌ Error sending message:', error);
    }
  };

  const handleMultiModelSelect = async (models: ModelInfo[], prompt: string) => {
    if (!currentSession || models.length === 0) return;

    setIsStreaming(true);
    console.log(`Broadcasting to ${models.length} models:`, models.map(m => m.name));

    try {
      // Call the backend broadcast endpoint
      // Call the backend broadcast endpoint
      const result = await apiService.createBroadcast({
        session_id: currentSession.id,
        prompt: prompt,
        models: models.map(model => ({
          provider_id: model.provider,
          model_id: model.id,
          temperature: 0.7,
          max_tokens: 1000
        }))
      });

      if (result) {
        console.log('Broadcast started:', result);

        // Create panes for each model if they don't exist and add user message
        result.pane_ids.forEach((paneId: string, index: number) => {
          const modelInfo = models[index];

          if (modelInfo && !activePanes[paneId]) {
            console.log('🎯 Creating pane with ID:', paneId, 'for model:', modelInfo.name);
            addPaneWithId(paneId, modelInfo);

            // Add the user message to the pane using backend-provided ID
            const userMessageId = result.user_message_ids?.[paneId];
            if (userMessageId) {
              const userMessage = {
                id: userMessageId, // Use backend-generated ID
                role: 'user' as const,
                content: prompt,
                timestamp: new Date()
              };
              updatePaneMessages(paneId, userMessage);
              console.log('✅ Added user message with backend ID:', userMessageId);
            } else {
              console.warn('⚠️ No user message ID provided by backend for pane:', paneId);
            }
          }
        });

      } else {
        console.error('Broadcast failed: No result returned');
        alert('Broadcast Failed: No result returned from backend');
      }
    } catch (error) {
      console.error('Error broadcasting:', error);
      alert(`Error broadcasting: ${error}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleCompareToggle = (paneIds: [string, string] | null) => {
    console.log('handleCompareToggle called with:', paneIds);
    console.log('Current activePanes before toggle:', Object.keys(activePanes));

    setSelectedPanes(paneIds);
    setComparing(!!paneIds);
  };

  const handlePaneAction = (action: any) => {
    switch (action.type) {
      case 'sendTo':
        setSendToData({
          sourcePane: action.paneId,
          selectedContent: action.data || { messageIds: [], text: '' }
        });
        setSendToMenuVisible(true);
        break;
      case 'close':
        // Pane closing is handled by the store
        break;
      default:
        console.log('Unknown pane action:', action);
    }
  };

  const handleSendTo = async (targetPaneId: string, content: TransferContent, options: {
    transferMode: 'append' | 'replace' | 'summarize';
    additionalContext?: string;
    preserveRoles: boolean;
    summaryInstructions?: string;
  }) => {
    if (!sendToData) return;

    try {
      console.log('Sending content to pane:', {
        sourceId: sendToData.sourcePane,
        targetId: targetPaneId,
        content,
        options
      });

      // Call the API to transfer content with full context
      const result = await apiService.sendToPane({
        sourceId: sendToData.sourcePane,
        targetId: targetPaneId,
        content: content,
        sessionId: currentSession?.id || 'default-session',
        transferMode: options.transferMode,
        additionalContext: options.additionalContext,
        preserveRoles: options.preserveRoles,
        summaryInstructions: options.summaryInstructions,
        selectedMessageIds: sendToData.selectedContent.messageIds // Pass original message IDs
      });

      console.log('Transfer result:', result);

      if (result.success) {
        console.log(`✅ Successfully transferred ${result.transferred_count} messages to pane ${targetPaneId} (mode: ${options.transferMode})`);

        // Refresh the session state from backend to show transferred messages
        if (currentSession?.id) {
          await refreshSessionFromBackend(currentSession.id);
          console.log('🔄 Session state refreshed after transfer');
        }
      } else {
        console.error('❌ Transfer failed:', result);
      }

      setSendToMenuVisible(false);
      setSendToData(null);
    } catch (error) {
      console.error('❌ Failed to transfer content:', error);
      // Still close the menu even if transfer failed
      setSendToMenuVisible(false);
      setSendToData(null);
    }
  };

  const handleCloseSendToMenu = () => {
    setSendToMenuVisible(false);
    setSendToData(null);
  };



  const handleBroadcastToActive = async (paneIds: string[], prompt: string) => {
    console.log(`Broadcasting to ${paneIds.length} active panes:`, paneIds);

    if (!currentSession) {
      console.error('No current session for broadcast');
      return;
    }

    try {
      // Add user message to selected panes first
      paneIds.forEach((paneId, index) => {
        const userMessage = {
          id: `msg-${Date.now()}-${index}-user`,
          role: 'user' as const,
          content: prompt,
          timestamp: new Date()
        };
        updatePaneMessages(paneId, userMessage);
      });

      console.log('🚀 Sending messages to existing panes via /chat endpoint');

      // Send to each existing pane using the /chat/{pane_id} endpoint
      const chatPromises = paneIds.map(async (paneId) => {
        const pane = activePanes[paneId];
        if (!pane) {
          console.error(`Pane not found: ${paneId}`);
          return;
        }

        try {
          const result = await apiService.sendChatMessage(paneId, currentSession.id, prompt);
          console.log(`✅ Message sent to pane ${paneId}:`, result);
          return result;
        } catch (error) {
          console.error(`❌ Failed to send message to pane ${paneId}:`, error);

          // Add error message to this specific pane
          const errorMessage = {
            id: `msg-${Date.now()}-error-${paneId}`,
            role: 'assistant' as const,
            content: `Error: Failed to send message. ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: new Date()
          };
          updatePaneMessages(paneId, errorMessage);
        }
      });

      // Wait for all chat requests to complete
      await Promise.all(chatPromises);
      console.log('✅ All messages sent to active panes');

    } catch (error) {
      console.error('❌ Broadcast to active panes failed:', error);

      // Add error messages to all panes if there was a general failure
      paneIds.forEach((paneId, index) => {
        const errorMessage = {
          id: `msg-${Date.now()}-${index}-error`,
          role: 'assistant' as const,
          content: `Error: Failed to broadcast message. ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date()
        };
        updatePaneMessages(paneId, errorMessage);
      });
    }
  };

  const handleArrangeWindows = () => {
    (window as any).arrangeWindows?.();
  };

  const handleMinimizeAll = () => {
    (window as any).minimizeAllWindows?.();
  };

  const handleCloseAll = () => {
    (window as any).closeAllWindows?.();
  };

  const availablePanes = Object.values(activePanes);

  // Debug logging for pane availability
  console.log('Workspace: activePanes keys:', Object.keys(activePanes));
  console.log('Workspace: availablePanes count:', availablePanes.length);
  console.log('Workspace: isComparing:', isComparing);
  console.log('Workspace: selectedPanes:', selectedPanes);

  // Create a stable reference for comparison to prevent panes from disappearing
  const panesForComparison = useMemo(() => {
    return availablePanes.length > 0 ? availablePanes : [];
  }, [availablePanes]);

  return (
    <div className="workspace">
      {/* Top Right Controls Group */}
      <div className="top-right-controls">
        {/* Session Metrics Toggle Button */}
        <button
          className="session-metrics-toggle"
          onClick={() => setSessionMetricsVisible(!sessionMetricsVisible)}
          title="Toggle Session Metrics"
        >
          📊
        </button>

        {/* Floating Toolbar (Settings) */}
        <FloatingToolbar
          activePanes={availablePanes}
          isComparing={isComparing}
          selectedPanes={selectedPanes}
          onCompareToggle={handleCompareToggle}
          onArrangeWindows={handleArrangeWindows}
          onMinimizeAll={handleMinimizeAll}
          onCloseAll={handleCloseAll}
          onBroadcastToActive={handleBroadcastToActive}
        />
      </div>

      {/* Floating Session Metrics */}
      <FloatingSessionMetrics
        isVisible={sessionMetricsVisible}
        onToggle={() => setSessionMetricsVisible(!sessionMetricsVisible)}
      />

      {/* Floating Model Selector */}
      <FloatingModelSelector
        availableModels={availableModels}
        onModelSelect={handleModelSelect}
        onMultiModelSelect={handleMultiModelSelect}
        isStreaming={isStreaming}
      />
      {/* Main Workspace Area */}
      <div className={`workspace-content ${isComparing ? 'comparison-active' : ''}`}>
        {/* Always show the PaneGrid */}
        <PaneGrid
          onPaneAction={handlePaneAction}
          onSendMessage={handleSendMessage}
          isCompareMode={isComparing}
          selectedPanes={selectedPanes}
          onArrangeWindows={handleArrangeWindows}
          onMinimizeAll={handleMinimizeAll}
          onCloseAll={handleCloseAll}
        />

        {/* Show DiffViewer overlay when comparing */}
        {isComparing && selectedPanes && selectedPanes.length >= 2 && (
          <DiffViewer
            panes={panesForComparison}
            selectedPanes={selectedPanes}

          />
        )}
      </div>



      {/* Send To Menu */}
      {sendToMenuVisible && sendToData && (
        <SendToMenu
          sourcePane={sendToData.sourcePane}
          selectedContent={sendToData.selectedContent}
          availableTargets={availablePanes}
          onSendTo={handleSendTo}
          onClose={handleCloseSendToMenu}
          isVisible={sendToMenuVisible}
        />
      )}
    </div>
  );
};