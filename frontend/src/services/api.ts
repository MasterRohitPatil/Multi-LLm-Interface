import {
  BroadcastRequest,
  BroadcastResponse,
  ModelInfo,
  TransferContent,
  PipelineTemplate
} from '../types';

class ApiService {
  private baseUrl: string;

  constructor() {
    // Use relative path to leverage Vite proxy and avoid CORS
    this.baseUrl = '/api';

    console.log('🔗 API Service configured:', this.baseUrl);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health');
  }

  // Get available models
  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.request('/models');
  }

  // Create broadcast
  async createBroadcast(request: BroadcastRequest): Promise<BroadcastResponse> {
    return this.request('/broadcast', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Send content to pane
  async sendToPane(request: {
    sourceId: string;
    targetId: string;
    content: TransferContent;
    sessionId: string;
    transferMode?: 'append' | 'replace' | 'summarize';
    additionalContext?: string;
    preserveRoles?: boolean;
    summaryInstructions?: string;
    selectedMessageIds?: string[]; // Add this to pass original message IDs
  }): Promise<{ success: boolean; transferred_count: number; target_pane_id: string }> {
    // Use selectedMessageIds if provided, otherwise extract from content
    let messageIds: string[];

    if (request.selectedMessageIds) {
      messageIds = request.selectedMessageIds;
    } else {
      // Extract original message IDs by removing the transfer suffix
      messageIds = request.content.messages
        .map(msg => {
          // Remove the -transfer-timestamp suffix to get original ID
          const match = msg.id.match(/^(.+)-transfer-\d+$/);
          return match ? match[1] : msg.id;
        })
        .filter(id => !id.startsWith('context-')); // Filter out context messages
    }

    // Transform frontend request to match backend expectations
    const backendRequest = {
      source_pane_id: request.sourceId,
      target_pane_id: request.targetId,
      message_ids: messageIds,
      session_id: request.sessionId,
      transfer_mode: request.transferMode || 'append',
      additional_context: request.additionalContext || null,
      preserve_roles: request.preserveRoles !== false, // Default to true
      summary_instructions: request.summaryInstructions || null
    };

    return this.request('/send-to', {
      method: 'POST',
      body: JSON.stringify(backendRequest),
    });
  }

  // Generate summary
  async generateSummary(request: {
    paneIds: string[];
    format: 'executive' | 'technical' | 'bullet';
    sessionId: string;
  }): Promise<{ summary: string; paneId: string }> {
    return this.request('/summarize', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Get session details
  async getSession(sessionId: string): Promise<any> {
    return this.request(`/sessions/${sessionId}`);
  }

  // Get session history
  async getSessionHistory(sessionId: string): Promise<{
    session: any;
    messages: any[];
  }> {
    return this.request(`/sessions/${sessionId}/history`);
  }

  // Pipeline templates
  async createPipelineTemplate(template: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usageCount'>): Promise<PipelineTemplate> {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    });
  }

  async getPipelineTemplates(): Promise<PipelineTemplate[]> {
    return this.request('/templates');
  }

  async deletePipelineTemplate(templateId: string): Promise<{ success: boolean }> {
    return this.request(`/templates/${templateId}`, {
      method: 'DELETE',
    });
  }

  async executePipelineTemplate(templateId: string, sessionId: string): Promise<BroadcastResponse> {
    return this.request(`/templates/${templateId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  // Send chat message (follow-up)
  async sendChatMessage(paneId: string, sessionId: string, message: string): Promise<any> {
    console.log(`📤 sending chat message to pane ${paneId} via ApiService`);
    return this.request(`/chat/${paneId}`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        message: message
      }),
    });
  }
}

export const apiService = new ApiService();