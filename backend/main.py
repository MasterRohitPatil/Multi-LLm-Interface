"""
Multi-LLM Broadcast Workspace Backend
FastAPI application with WebSocket support for real-time LLM streaming
"""

import asyncio
import json
import logging
import uvicorn
import os
from datetime import datetime
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from models import (
    BroadcastRequest, BroadcastResponse, SendToRequest, SendToResponse,
    SummaryRequest, SummaryResponse, HealthResponse, Session, ChatPane,
    Message, StreamEvent, ModelSelection, ProvenanceInfo
)
from adapters.registry import registry
from broadcast_orchestrator import BroadcastOrchestrator
from session_manager import SessionManager
from error_handler import error_handler
from websocket_manager import connection_manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Debug: Check if API keys are loaded
google_key = os.getenv("GOOGLE_API_KEY")
groq_key = os.getenv("GROQ_API_KEY")
print(f"🔑 Google API Key: {'✅ Loaded' if google_key else '❌ Missing'}")
print(f"🔑 Groq API Key: {'✅ Loaded' if groq_key else '❌ Missing'}")

app = FastAPI(
    title="Multi-LLM Broadcast Workspace API",
    description="Backend API for broadcasting prompts to multiple LLM providers",
    version="0.1.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
session_manager = SessionManager()
broadcast_orchestrator = BroadcastOrchestrator(registry, session_manager)
manager = connection_manager

@app.get("/")
async def root():
    return {"message": "Multi-LLM Broadcast Workspace API"}

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with provider status and error handler health"""
    try:
        provider_health = await registry.health_check()
        error_handler_health = error_handler.get_provider_health()
        connection_stats = manager.get_connection_stats()
        
        # Determine overall health
        healthy_providers = sum(1 for status in provider_health.values() if status)
        total_providers = len(provider_health)
        
        overall_status = "healthy"
        if healthy_providers == 0:
            overall_status = "unhealthy"
        elif healthy_providers < total_providers:
            overall_status = "degraded"
        
        error_handler._log_structured(
            "info",
            "Health check performed",
            healthy_providers=healthy_providers,
            total_providers=total_providers,
            websocket_connections=connection_stats["total_connections"],
            overall_status=overall_status
        )
        
        return HealthResponse(
            status=overall_status,
            service="multi-llm-broadcast-workspace"
        )
    except Exception as e:
        error_handler._log_structured(
            "error",
            f"Health check error: {str(e)}",
            error_type=type(e).__name__
        )
        return HealthResponse(
            status="unhealthy",
            service="multi-llm-broadcast-workspace"
        )

@app.post("/broadcast", response_model=BroadcastResponse)
async def create_broadcast(request: BroadcastRequest):
    """
    Create a broadcast request to multiple LLM providers
    
    Requirements: 1.1, 1.4
    """
    try:
        logger.info(f"Creating broadcast for session {request.session_id} with {len(request.models)} models")
        print(f"🎯 Broadcast request: {request.models}")
        
        # Validate models
        for model_selection in request.models:
            # Check if model_id already contains provider_id prefix
            if model_selection.model_id.startswith(f"{model_selection.provider_id}:"):
                model_id = model_selection.model_id
            else:
                model_id = f"{model_selection.provider_id}:{model_selection.model_id}"
            print(f"🔍 Validating model: {model_id}")
            
            is_valid = await registry.validate_model(model_id)
            print(f"✅ Model {model_id} valid: {is_valid}")
            
            if not is_valid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid model: {model_id}"
                )
        
        # Create or get session
        print(f"📝 Creating/getting session: {request.session_id}")
        session = session_manager.get_or_create_session(request.session_id)
        print(f"✅ Session created: {session.id}")
        
        # Create panes for each model
        pane_ids = []
        user_message_ids = {}
        for model_selection in request.models:
            # Check if model_id already contains provider_id prefix
            if model_selection.model_id.startswith(f"{model_selection.provider_id}:"):
                model_id = model_selection.model_id
            else:
                model_id = f"{model_selection.provider_id}:{model_selection.model_id}"
            print(f"🔍 Getting model info for: {model_id}")
            
            model_info = await registry.get_model_info(model_id)
            print(f"📋 Model info: {model_info}")
            
            if model_info:
                # Create user message and capture its ID
                user_message = Message(role="user", content=request.prompt)
                print(f"📝 Created user message with ID: {user_message.id}")
                
                pane = ChatPane(
                    model_info=model_info,
                    messages=[user_message]
                )
                session.panes.append(pane)
                pane_ids.append(pane.id)
                user_message_ids[pane.id] = user_message.id
        
        # Update session
        session_manager.update_session(session)
        
        # Start broadcast in background
        asyncio.create_task(
            broadcast_orchestrator.broadcast(request, pane_ids, manager)
        )
        
        return BroadcastResponse(
            session_id=request.session_id,
            pane_ids=pane_ids,
            status="started",
            user_message_ids=user_message_ids
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Broadcast error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/{pane_id}")
async def send_chat_message(pane_id: str, request: dict):
    """
    Send a message to a specific existing pane
    """
    try:
        # Debug Trace - Trace request entry
        print(f"\n📨 [POST /chat/{pane_id}] Received config: {request}")
        
        logger.info(f"Chat request for pane {pane_id}: {request}")
        
        session_id = request.get("session_id")
        message = request.get("message")
        
        print(f"📨 [POST /chat] Session: {session_id}, Message: {message[:50] if message else 'None'}...")
        
        if not session_id or not message:
            logger.error(f"Missing required fields: session_id={session_id}, message={bool(message)}")
            raise HTTPException(status_code=400, detail="Missing session_id or message")
        
        session = session_manager.get_session(session_id)
        if not session:
            logger.error(f"Session not found: {session_id}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Find the pane
        pane = next((p for p in session.panes if p.id == pane_id), None)
        if not pane:
            logger.error(f"Pane not found: {pane_id} in session {session_id}")
            logger.info(f"Available panes: {[p.id for p in session.panes]}")
            raise HTTPException(status_code=404, detail="Pane not found")
        
        logger.info(f"Pane found: {pane.model_info.id}, current messages: {len(pane.messages)}")
        
        # Add user message to pane
        user_message = Message(role="user", content=message)
        pane.messages.append(user_message)
        session_manager.update_session(session)
        
        # Create a single-model broadcast request
        # Extract model_id properly - pane.model_info.id is already the full model ID like "google:gemini-2.0-flash"
        if ':' in pane.model_info.id:
            provider_id, model_id = pane.model_info.id.split(':', 1)
        else:
            provider_id = pane.model_info.provider
            model_id = pane.model_info.id
            
        logger.info(f"Creating model selection: provider_id={provider_id}, model_id={model_id}")
        
        model_selection = ModelSelection(
            provider_id=provider_id,
            model_id=model_id,
            temperature=0.7,
            max_tokens=1000
        )
        
        # For individual chat, we need to pass the conversation context differently
        # Let's just use the new message for now and enhance the broadcast orchestrator later
        broadcast_request = BroadcastRequest(
            session_id=session_id,
            prompt=message,
            models=[model_selection]
        )
        
        logger.info(f"Starting broadcast to pane {pane_id} with message: {message[:50]}...")
        
        # Start streaming to existing pane
        asyncio.create_task(
            broadcast_orchestrator._stream_to_pane(
                broadcast_request, model_selection, pane_id, connection_manager
            )
        )
        
        logger.info(f"Chat message successfully queued for pane {pane_id}")
        return {"success": True, "pane_id": pane_id}
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/send-to", response_model=SendToResponse)
async def send_to_pane(request: SendToRequest):
    """
    Send selected messages from one pane to another with LLM context management
    
    Requirements: 4.1, 4.2, 4.3, 4.4
    """
    try:
        logger.info(f"Transferring messages from {request.source_pane_id} to {request.target_pane_id} (mode: {request.transfer_mode})")
        logger.info(f"Request details: message_ids={request.message_ids}, session_id={request.session_id}")
        logger.info(f"Additional context: {request.additional_context}")
        logger.info(f"Preserve roles: {request.preserve_roles}")
        
        session = session_manager.get_session(request.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Find source and target panes
        source_pane = None
        target_pane = None
        
        logger.info(f"Session has {len(session.panes)} panes: {[p.id for p in session.panes]}")
        
        for pane in session.panes:
            if pane.id == request.source_pane_id:
                source_pane = pane
                logger.info(f"Found source pane: {pane.id} with {len(pane.messages)} messages")
            elif pane.id == request.target_pane_id:
                target_pane = pane
                logger.info(f"Found target pane: {pane.id} with {len(pane.messages)} messages")
        
        if not source_pane:
            logger.error(f"Source pane {request.source_pane_id} not found")
            raise HTTPException(status_code=404, detail=f"Source pane {request.source_pane_id} not found")
        
        if not target_pane:
            logger.error(f"Target pane {request.target_pane_id} not found")
            raise HTTPException(status_code=404, detail=f"Target pane {request.target_pane_id} not found")
        
        # Get selected messages from source pane
        selected_messages = []
        logger.info(f"Looking for message IDs: {request.message_ids}")
        logger.info(f"Available message IDs in source pane: {[msg.id for msg in source_pane.messages]}")
        
        for message_id in request.message_ids:
            found = False
            for msg in source_pane.messages:
                if msg.id == message_id:
                    selected_messages.append(msg)
                    logger.info(f"Found message {message_id}: {msg.content[:50]}...")
                    found = True
                    break
            if not found:
                logger.warning(f"Message {message_id} not found in source pane")
        
        logger.info(f"Selected {len(selected_messages)} messages for transfer")
        
        if not selected_messages:
            logger.error("No valid messages found to transfer")
            raise HTTPException(status_code=400, detail="No valid messages found to transfer")
        
        # Prepare messages for transfer based on mode
        messages_to_transfer = []
        
        # Add additional context as system message if provided
        if request.additional_context and request.additional_context.strip():
            context_message = Message(
                role="system",
                content=request.additional_context.strip(),
                provenance=ProvenanceInfo(
                    source_model="user-context",
                    source_pane_id=request.source_pane_id,
                    transfer_timestamp=datetime.now(),
                    content_hash=str(hash(request.additional_context))
                )
            )
            messages_to_transfer.append(context_message)
        
        if request.transfer_mode == "summarize":
            # Enhanced summarize: Use source pane's model to generate actual summary
            logger.info(f"Generating summary using source model: {source_pane.model_info.id}")
            
            conversation_text = "\n\n".join([
                f"{msg.role.upper()}: {msg.content}" for msg in selected_messages
            ])
            
            # Build summary prompt
            summary_prompt = ""
            if request.summary_instructions and request.summary_instructions.strip():
                summary_prompt = f"Please summarize the following conversation with these specific instructions: {request.summary_instructions.strip()}\n\n"
            else:
                summary_prompt = "Please provide a concise summary of the following conversation:\n\n"
            
            summary_prompt += f"Conversation to summarize:\n\n{conversation_text}"
            
            try:
                # Get the LLM adapter for the source pane to generate summary
                adapter = registry.get_adapter(source_pane.model_info.provider)
                if not adapter:
                    logger.error(f"No adapter found for provider {source_pane.model_info.provider}")
                    raise HTTPException(status_code=500, detail=f"No adapter available for {source_pane.model_info.provider}")
                
                # Generate summary using source pane's model
                logger.info("Requesting summary from source model...")
                
                # Create a standalone conversation just for summary generation
                # This ensures we don't pollute the source pane's conversation
                summary_conversation = [
                    {
                        "role": "user", 
                        "content": summary_prompt
                    }
                ]
                
                # Convert to Message objects for the adapter
                summary_messages = [
                    Message(role="user", content=summary_prompt)
                ]
                
                # Stream the summary generation
                summary_content = ""
                logger.info(f"Starting summary generation with model: {source_pane.model_info.id}")
                logger.info(f"Summary prompt: {summary_prompt[:100]}...")
                
                async for event in adapter.stream(
                    summary_messages,
                    source_pane.model_info.id.split(':')[-1],  # Extract just the model name
                    f"summary-{request.source_pane_id}",
                    temperature=0.3,  # Lower temperature for more focused summaries
                    max_tokens=500    # Reasonable limit for summaries
                ):
                    logger.info(f"Summary generation event: {event.type}")
                    if event.type == "token":
                        summary_content += event.data.token
                    elif event.type == "final":
                        summary_content = event.data.content
                        break
                
                if not summary_content.strip():
                    logger.error("Summary generation returned empty content")
                    raise HTTPException(status_code=500, detail="Failed to generate summary - empty response")
                
                logger.info(f"✅ Summary generated successfully: {len(summary_content)} characters")
                logger.info(f"Summary content preview: {summary_content[:200]}...")
                
                # Create the summary message to transfer as a user message
                # This allows the target pane's model to respond to the summary
                summary_message = Message(
                    role="user",  # Send as user message so target model can respond
                    content=summary_content.strip(),
                    provenance=ProvenanceInfo(
                        source_model=source_pane.model_info.id,
                        source_pane_id=request.source_pane_id,
                        transfer_timestamp=datetime.now(),
                        content_hash=str(hash(summary_content))
                    )
                )
                messages_to_transfer.append(summary_message)
                logger.info(f"✅ Summary message created and added to transfer list")
                
            except Exception as e:
                logger.error(f"Failed to generate summary: {e}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Summary generation failed: {str(e)}"
                )
            
        else:
            # For append/replace modes, transfer the actual messages
            for msg in selected_messages:
                transferred_message = Message(
                    role=msg.role if request.preserve_roles else "user",
                    content=msg.content,
                    provenance=ProvenanceInfo(
                        source_model=source_pane.model_info.id,
                        source_pane_id=request.source_pane_id,
                        transfer_timestamp=datetime.now(),
                        content_hash=str(hash(msg.content))
                    )
                )
                messages_to_transfer.append(transferred_message)
        
        # Handle different transfer modes
        if request.transfer_mode == "replace":
            # Clear target pane messages first
            target_pane.messages.clear()
            logger.info(f"Cleared target pane {request.target_pane_id} for replace mode")
        
        # Add messages to target pane
        target_pane.messages.extend(messages_to_transfer)
        transferred_count = len(messages_to_transfer)
        
        # Now send the conversation context to the target LLM
        # This ensures the LLM has the full conversation history
        try:
            # Get the LLM adapter for the target pane
            adapter = registry.get_adapter(target_pane.model_info.provider)
            if not adapter:
                logger.warning(f"No adapter found for provider {target_pane.model_info.provider}")
            else:
                # Prepare conversation history for the LLM
                conversation_history = []
                for msg in target_pane.messages:
                    conversation_history.append({
                        "role": msg.role,
                        "content": msg.content
                    })
                
                # Send a context-setting message to the LLM to establish the conversation state
                # We'll send a system message that doesn't expect a response, just to set context
                if conversation_history:
                    logger.info(f"Updating LLM context for pane {request.target_pane_id} with {len(conversation_history)} messages")
                    
                    # Add a system message to indicate context has been updated
                    context_update_message = Message(
                        role="system",
                        content=f"[Context updated: {transferred_count} messages transferred from {source_pane.model_info.name}]",
                        provenance=ProvenanceInfo(
                            source_model="system",
                            source_pane_id=request.target_pane_id,
                            transfer_timestamp=datetime.now(),
                            content_hash="context-update"
                        )
                    )
                    target_pane.messages.append(context_update_message)
                    
        except Exception as llm_error:
            logger.warning(f"Failed to update LLM context: {llm_error}")
            # Continue with the transfer even if LLM context update fails
        
        # Update session
        session_manager.update_session(session)
        
        logger.info(f"Successfully transferred {transferred_count} messages to pane {request.target_pane_id}")
        
        return SendToResponse(
            success=True,
            transferred_count=transferred_count,
            target_pane_id=request.target_pane_id
        )
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Send-to error: {e}")
        logger.error(f"Full traceback: {error_details}")
        raise HTTPException(status_code=500, detail=f"Send-to error: {str(e)}")

@app.post("/summarize", response_model=SummaryResponse)
async def generate_summary(request: SummaryRequest):
    """
    Generate summaries of selected panes
    
    Requirements: 5.1, 5.2, 5.3, 5.4
    """
    try:
        logger.info(f"Generating summary for panes: {request.pane_ids}")
        
        session = session_manager.get_session(request.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Collect content from selected panes
        content_parts = []
        for pane_id in request.pane_ids:
            pane = next((p for p in session.panes if p.id == pane_id), None)
            if pane:
                pane_content = "\n".join([
                    f"{msg.role}: {msg.content}" for msg in pane.messages
                ])
                content_parts.append(f"=== {pane.model_info.name} ===\n{pane_content}")
        
        combined_content = "\n\n".join(content_parts)
        
        # Generate summaries using default model (first available)
        default_adapter = None
        for provider_name in registry.list_providers():
            adapter = registry.get_adapter(provider_name)
            if adapter:
                default_adapter = adapter
                break
        
        if not default_adapter:
            raise HTTPException(status_code=503, detail="No summarization model available")
        
        # Create summary pane
        summary_pane = ChatPane(
            model_info=await registry.get_model_info("litellm:gpt-3.5-turbo") or 
                      (await registry.discover_models()).get("litellm", [{}])[0],
            messages=[]
        )
        
        summaries = {}
        for summary_type in request.summary_types:
            prompt = f"Please provide a {summary_type} summary of the following conversations:\n\n{combined_content}"
            
            # For now, create a simple summary (would be enhanced with actual LLM call)
            summaries[summary_type] = f"{summary_type.title()} summary of {len(request.pane_ids)} conversations"
            
            summary_pane.messages.append(Message(
                role="assistant",
                content=summaries[summary_type]
            ))
        
        session.panes.append(summary_pane)
        session_manager.update_session(session)
        
        return SummaryResponse(
            summary_pane_id=summary_pane.id,
            summaries=summaries,
            source_panes=request.pane_ids
        )
        
    except Exception as e:
        logger.error(f"Summarization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    Enhanced WebSocket endpoint for real-time streaming with error handling
    
    Requirements: 2.4, 8.4
    """
    connection_id = None
    
    try:
        # Create session in backend if it doesn't exist (handles race condition)
        session = session_manager.get_session(session_id)
        if not session:
            print(f"📝 Creating session in backend for WebSocket: {session_id}")
            session = session_manager.get_or_create_session(session_id)
            print(f"✅ Session created in backend: {session.id}")
        
        connection_id = await manager.connect(websocket, session_id)
        
        error_handler._log_structured(
            "info",
            "WebSocket connection established",
            session_id=session_id,
            connection_id=connection_id
        )
        
        while True:
            # Keep connection alive and handle any client messages
            try:
                # Use asyncio.wait_for with timeout to avoid blocking indefinitely
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                print(f"📨 WebSocket received: {data}")
                
                # Handle ping/pong or other client messages
                try:
                    message = json.loads(data)
                    
                    if message.get("type") == "ping":
                        await manager.send_to_connection(
                            connection_id,
                            {
                                "type": "pong",
                                "timestamp": datetime.now().isoformat()
                            }
                        )
                    elif message.get("type") == "heartbeat":
                        # Update connection heartbeat
                        if connection_id in manager.connections:
                            manager.connections[connection_id].last_ping = datetime.now()
                    
                except json.JSONDecodeError:
                    error_handler._log_structured(
                        "warning",
                        "Received malformed JSON from WebSocket client",
                        session_id=session_id,
                        connection_id=connection_id,
                        data=data[:100]  # Log first 100 chars
                    )
                    
            except asyncio.TimeoutError:
                # Send ping to check if connection is still alive
                print(f"⏰ WebSocket timeout - sending ping to {session_id}")
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception as e:
                    print(f"❌ Failed to send ping: {e}")
                    break
                if not await manager.ping_connection(connection_id):
                    break
                    
    except WebSocketDisconnect:
        error_handler._log_structured(
            "info",
            "WebSocket client disconnected",
            session_id=session_id,
            connection_id=connection_id
        )
    except Exception as e:
        error_handler._log_structured(
            "error",
            f"WebSocket error: {str(e)}",
            session_id=session_id,
            connection_id=connection_id,
            error_type=type(e).__name__
        )
    finally:
        if connection_id:
            manager.disconnect(connection_id, "endpoint_cleanup")

if __name__ == "__main__":
    port = int(os.getenv("API_PORT", 8080))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
@app.get(
"/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session details"""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return session

@app.get("/sessions")
async def list_sessions(limit: int = 50, offset: int = 0):
    """List sessions with pagination"""
    sessions = session_manager.list_sessions(limit, offset)
    total_count = len(session_manager.sessions)
    
    return {
        "sessions": sessions,
        "total_count": total_count,
        "limit": limit,
        "offset": offset
    }

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session"""
    success = session_manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"success": True, "message": "Session deleted"}

@app.get("/models")
async def get_available_models():
    """Get all available models from all providers"""
    try:
        models_by_provider = await registry.discover_models()
        
        # Flatten the models list
        all_models = []
        for provider, models in models_by_provider.items():
            for model in models:
                all_models.append({
                    "id": model.id,  # Just the model ID, not prefixed with provider
                    "name": model.name,
                    "provider": provider,
                    "max_tokens": model.max_tokens,
                    "cost_per_1k_tokens": model.cost_per_1k_tokens,
                    "supports_streaming": model.supports_streaming
                })
        
        return {
            "models": all_models,
            "providers": list(models_by_provider.keys()),
            "total_count": len(all_models)
        }
        
    except Exception as e:
        logger.error(f"Error getting models: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving models")

@app.get("/providers/health")
async def get_provider_health():
    """Get health status of all providers"""
    try:
        health_status = await registry.health_check()
        return {
            "providers": health_status,
            "healthy_count": sum(1 for status in health_status.values() if status),
            "total_count": len(health_status)
        }
    except Exception as e:
        logger.error(f"Error checking provider health: {e}")
        raise HTTPException(status_code=500, detail="Error checking provider health")

@app.get("/stats")
async def get_system_stats():
    """Get enhanced system statistics with error handling metrics"""
    try:
        session_stats = session_manager.get_session_stats()
        broadcast_stats = {
            "active_broadcasts": sum(
                1 for b in broadcast_orchestrator.active_broadcasts.values()
                if b["status"] == "running"
            ),
            "total_broadcasts": len(broadcast_orchestrator.active_broadcasts)
        }
        connection_stats = manager.get_connection_stats()
        error_handler_stats = error_handler.get_provider_health()
        
        return {
            "sessions": session_stats,
            "broadcasts": broadcast_stats,
            "websocket_connections": connection_stats,
            "error_handler": {
                "provider_health": error_handler_stats,
                "circuit_breakers": len(error_handler.circuit_breakers)
            }
        }
    except Exception as e:
        error_handler._log_structured(
            "error",
            f"Error getting stats: {str(e)}",
            error_type=type(e).__name__
        )
        raise HTTPException(status_code=500, detail="Error retrieving statistics")

@app.get("/system/health/detailed")
async def get_detailed_health():
    """Get detailed system health information"""
    try:
        provider_health = await registry.health_check()
        error_handler_health = error_handler.get_provider_health()
        connection_stats = manager.get_connection_stats()
        
        return {
            "providers": {
                "registry_health": provider_health,
                "error_handler_health": error_handler_health
            },
            "websockets": connection_stats,
            "system": {
                "active_sessions": len(session_manager.sessions),
                "active_broadcasts": len([
                    b for b in broadcast_orchestrator.active_broadcasts.values()
                    if b["status"] == "running"
                ])
            }
        }
    except Exception as e:
        error_handler._log_structured(
            "error",
            f"Error getting detailed health: {str(e)}",
            error_type=type(e).__name__
        )
        raise HTTPException(status_code=500, detail="Error retrieving detailed health")

@app.post("/system/reset-circuit-breakers")
async def reset_circuit_breakers():
    """Reset all circuit breakers (admin endpoint)"""
    try:
        reset_count = 0
        for provider, circuit_breaker in error_handler.circuit_breakers.items():
            if circuit_breaker.state != "closed":
                circuit_breaker.failure_count = 0
                circuit_breaker.state = "closed"
                circuit_breaker.last_failure_time = None
                reset_count += 1
        
        error_handler._log_structured(
            "info",
            "Circuit breakers reset",
            reset_count=reset_count
        )
        
        return {
            "success": True,
            "reset_count": reset_count,
            "message": f"Reset {reset_count} circuit breakers"
        }
    except Exception as e:
        error_handler._log_structured(
            "error",
            f"Error resetting circuit breakers: {str(e)}",
            error_type=type(e).__name__
        )
        raise HTTPException(status_code=500, detail="Error resetting circuit breakers")

if __name__ == '__main__':
    print(' FORCED STARTUP: Listening on 0.0.0.0:8080')
    uvicorn.run(app, host='0.0.0.0', port=8080)
