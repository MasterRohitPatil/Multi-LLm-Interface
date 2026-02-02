"""
Google Data Studio Adapter for direct API integration
Provides direct access to Google's AI models
"""

import json
import httpx
from datetime import datetime
from typing import AsyncGenerator, List, Dict, Any, Optional

from .base import LLMAdapter
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Message, ModelInfo, StreamEvent, TokenData, FinalData, MeterData, ErrorData, StatusData
from error_handler import error_handler


class GoogleDataStudioAdapter(LLMAdapter):
    """
    Adapter for direct Google Data Studio API integration.
    
    Provides access to Google's AI models including Gemini Pro
    through direct API calls.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.api_key = self.config.get("api_key")
        self.base_url = self.config.get("base_url", "https://generativelanguage.googleapis.com/v1beta")
        # Enhanced timeout configuration for Google API
        timeout_config = httpx.Timeout(
            connect=15.0,  # Connection timeout
            read=90.0,     # Read timeout (Google can be slower)
            write=10.0,    # Write timeout
            pool=5.0       # Pool timeout
        )
        self.client = httpx.AsyncClient(timeout=timeout_config)
    
    @property
    def provider_name(self) -> str:
        return "google"
    
    async def stream(
        self, 
        messages: List[Message], 
        model: str,
        pane_id: str,
        **kwargs
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream responses from Google Data Studio API.
        """
        if not self.api_key:
            yield StreamEvent(
                type="error",
                pane_id=pane_id,
                data=ErrorData(
                    message="Google API key not configured",
                    code="auth_error",
                    retryable=False
                )
            )
            return
        
        print(f"🚀 GOOGLE STREAM START: model={model}, pane_id={pane_id}")
        for m in messages:
            print(f"  - [{m.role}] {m.content[:50]}")
        
        try:
            # Emit status event
            yield StreamEvent(
                type="status",
                pane_id=pane_id,
                data=StatusData(status="connecting", message=f"Connecting to Google {model}")
            )
            
            # Clean model ID
            if model.startswith("google:"):
                model = model.split(":", 1)[1]
            
            # Convert messages to Google format
            formatted_messages = self._format_messages(messages)
            
            # Prepare request payload
            payload = {
                "contents": formatted_messages,
                "generationConfig": {
                    "temperature": kwargs.get("temperature", 0.7),
                    "maxOutputTokens": kwargs.get("max_tokens", 1000),
                    "candidateCount": 1
                }
            }
            
            # Use streaming endpoint
            url = f"{self.base_url}/models/{model}:streamGenerateContent"
            params = {"key": self.api_key}
            headers = {"Content-Type": "application/json"}
            
            start_time = datetime.now()
            token_count = 0
            full_content = ""
            
            async with self.client.stream(
                "POST",
                url,
                json=payload,
                params=params,
                headers=headers
            ) as response:
                
                if response.status_code != 200:
                    error_text = await response.aread()
                    error_content = error_text.decode()
                    
                    # Print detailed error information
                    print(f"🔴 GOOGLE API ERROR - Status Code: {response.status_code}")
                    print(f"🔴 Model: {model}")
                    print(f"🔴 Response Headers: {dict(response.headers)}")
                    print(f"🔴 Error Content: {error_content[:1000]}")
                    
                
                    print(f"🔵 Google Headers: {dict(response.headers)}")
                    
                    error_handler._log_structured(
                        "error",
                        f"Google API error: {response.status_code}",
                        pane_id=pane_id,
                        model=model,
                        status_code=response.status_code,
                        error_text=error_content[:500]
                    )
                    
                    # Handle specific error codes
                    if response.status_code == 429:
                        retry_after = response.headers.get("retry-after", "unknown")
                        error_msg = f"Google Rate Limited (429) - Retry after: {retry_after}s"
                    elif response.status_code == 403:
                        error_msg = f"Google Forbidden (403) - Check API key permissions"
                    elif response.status_code == 404:
                        error_msg = f"Google Not Found (404) - Model '{model}' may not exist"
                    else:
                        error_msg = f"Google API Error ({response.status_code})"
                    
                    yield StreamEvent(
                        type="error",
                        pane_id=pane_id,
                        data=ErrorData(
                            message=error_msg,
                            code=f"http_{response.status_code}",
                            retryable=response.status_code >= 500 or response.status_code == 429
                        )
                    )
                    return
                
                print(f"🔍 Starting to process Google streaming response for pane: {pane_id}")
                
                # Read the entire response and parse as JSON
                response_text = await response.aread()
                response_str = response_text.decode('utf-8')
                print(f"📦 Google Raw Response: {response_str[:500]}...") # DEBUG PRINT

                print(f"📥 Complete response from Google: {response_str[:200]}...")
                
                try:
                    # Parse the complete JSON response
                    data = json.loads(response_str)
                    print(f"📊 Parsed complete JSON data: {data}")
                    
                    # Handle array of responses (Google returns array of streaming chunks)
                    if isinstance(data, list):
                        for response_obj in data:
                            if "candidates" in response_obj and len(response_obj["candidates"]) > 0:
                                candidate = response_obj["candidates"][0]
                                
                                if "content" in candidate and "parts" in candidate["content"]:
                                    for part in candidate["content"]["parts"]:
                                        if "text" in part:
                                            token = part["text"]
                                            if token:
                                                print(f"🎯 Yielding token: '{token}' for pane: {pane_id}")
                                                full_content += token
                                                token_count += len(token.split())
                                                
                                                yield StreamEvent(
                                                    type="token",
                                                    pane_id=pane_id,
                                                    data=TokenData(token=token, position=token_count)
                                                )
                                
                                # Check for finish reason
                                if "finishReason" in candidate:
                                    end_time = datetime.now()
                                    latency = int((end_time - start_time).total_seconds() * 1000)
                                    
                                    # Emit final content
                                    yield StreamEvent(
                                        type="final",
                                        pane_id=pane_id,
                                        data=FinalData(
                                            content=full_content,
                                            finish_reason=candidate["finishReason"]
                                        )
                                    )
                                    
                                    # Emit metrics
                                    estimated_cost = self._estimate_cost(model, token_count)
                                    yield StreamEvent(
                                        type="meter",
                                        pane_id=pane_id,
                                        data=MeterData(
                                            tokens_used=token_count,
                                            cost=estimated_cost,
                                            latency=latency
                                        )
                                    )
                                    break
                    elif "candidates" in data and len(data["candidates"]) > 0:
                        # This is handled above in the array processing
                        pass
                    
                except json.JSONDecodeError:
                    print(f"❌ Failed to parse JSON response from Google")
                    pass  # Skip malformed JSON
                
        except httpx.TimeoutException as e:
            error_handler._log_structured(
                "warning",
                "Google API request timeout",
                pane_id=pane_id,
                model=model,
                timeout_type=type(e).__name__
            )
            
            yield StreamEvent(
                type="error",
                pane_id=pane_id,
                data=ErrorData(
                    message="Request timeout - Google service may be busy",
                    code="timeout",
                    retryable=True
                )
            )
        except httpx.ConnectError as e:
            error_handler._log_structured(
                "error",
                "Google API connection error",
                pane_id=pane_id,
                model=model,
                error=str(e)
            )
            
            yield StreamEvent(
                type="error",
                pane_id=pane_id,
                data=ErrorData(
                    message="Unable to connect to Google service",
                    code="network_error",
                    retryable=True
                )
            )
        except Exception as e:
            error_handler._log_structured(
                "error",
                "Unexpected Google API error",
                pane_id=pane_id,
                model=model,
                error=str(e),
                error_type=type(e).__name__
            )
            
            yield StreamEvent(
                type="error",
                pane_id=pane_id,
                data=ErrorData(
                    message=f"Unexpected error: {str(e)}",
                    code="unknown",
                    retryable=False
                )
            )
    
    async def get_models(self) -> List[ModelInfo]:
        """
        Get available Google models - return hardcoded models to avoid API rate limits.
        """
        if not self.api_key:
            print("❌ Google API key not configured")
            return []
        
        # Always return fallback models to avoid rate limiting and API calls
        print("✅ Returning Google fallback models")
        return self._get_fallback_models()
    
    def _get_fallback_models(self) -> List[ModelInfo]:
        """Return hardcoded working Google models - 3 core models"""
        return [
            ModelInfo(
                id="gemini-3-flash-preview",
                name="Gemini 3 Flash (Preview)",
                provider="google",
                max_tokens=1048576,
                cost_per_1k_tokens=0.0007,
                supports_streaming=True
            )
        ]
    
    def _format_messages(self, messages: List[Message]) -> List[Dict[str, Any]]:
        """
        Convert messages to Google format.
        """
        formatted = []
        
        for msg in messages:
            # Google uses 'user' and 'model' roles
            role = "user" if msg.role == "user" else "model"
            
            formatted.append({
                "role": role,
                "parts": [{"text": msg.content}]
            })
        
        return formatted
    
    def _estimate_cost(self, model: str, tokens: int) -> float:
        """
        Estimate cost based on model and token count.
        """
        cost_per_1k = self._get_cost_per_1k(model)
        return (tokens / 1000.0) * cost_per_1k
    
    def _get_cost_per_1k(self, model: str) -> float:
        """
        Get cost per 1K tokens for Google models.
        """
        # Google Gemini pricing (simplified)
        cost_map = {
            "gemini-pro": 0.001,
            "gemini-pro-vision": 0.002,
            "gemini-1.5-pro": 0.0035,
            "gemini-1.5-flash": 0.0007
        }
        
        return cost_map.get(model, 0.001)  # Default cost
    
    def _get_max_tokens(self, model: str) -> int:
        """
        Get maximum tokens for Google models.
        """
        # Google model token limits
        token_map = {
            "gemini-pro": 32768,
            "gemini-pro-vision": 16384,
            "gemini-1.5-pro": 1048576,
            "gemini-1.5-flash": 1048576
        }
        
        return token_map.get(model, 32768)  # Default limit
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()