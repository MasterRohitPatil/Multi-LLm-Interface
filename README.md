# Multi-LLM Interface

A powerful web-based interface for interacting with multiple Large Language Models (LLMs) simultaneously. Test, compare, and analyze responses from various AI providers including Google Gemini, Groq, and others through a unified platform.

## 🚀 Features

- **Multi-Model Support**: Integrate with multiple LLM providers (Google Gemini, Groq, LiteLLM)
- **Broadcast Mode**: Send the same prompt to multiple models simultaneously
- **Real-time Streaming**: Get instant responses with streaming support
- **Modern UI**: Clean, responsive interface built with React and TypeScript
- **Flexible Backend**: FastAPI-powered backend with custom adapters for each provider
- **Conversation Management**: Track and manage multiple chat sessions
- **Markdown Rendering**: Rich text rendering for formatted responses

## 🛠️ Tech Stack

### Frontend
- **React** with TypeScript
- **Vite** for blazing-fast builds
- **Modern UI Components** with responsive design

### Backend
- **FastAPI** - Modern Python web framework
- **Custom LLM Adapters** - Unified interface for multiple providers
- **Async/Await** - Non-blocking request handling
- **LiteLLM** - Multi-provider LLM integration

## 📋 Prerequisites

- **Node.js** (v16 or higher)
- **Python** (3.8 or higher)
- **npm** or **yarn**
- API keys for the LLM providers you want to use:
  - Google AI API key
  - Groq API key
  - Other providers as needed

## 🔧 Installation

### 1. Clone the Repository
```bash
git clone https://github.com/MasterRohitPatil/Multi-LLm-Interface.git
cd Multi-LLm-Interface
```

### 2. Backend Setup
```bash
# Create a virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with your API keys
cp backend/.env.example backend/.env
# Edit backend/.env and add your API keys
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

## 🔑 Configuration

Create a `backend/.env` file with your API keys:

```env
GOOGLE_API_KEY=your_google_api_key_here
GROQ_API_KEY=your_groq_api_key_here
# Add other API keys as needed
```

Configure available models in `litellm_config.yaml`:

```yaml
model_list:
  - model_name: gemini-2.0-flash-exp
    litellm_params:
      model: gemini/gemini-2.0-flash-exp
      api_key: os.environ/GOOGLE_API_KEY
  
  - model_name: groq-llama
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY
```

## 🚀 Running the Application

### Start Backend Server
```bash
# From the project root
python start_server.py
```
The backend will run on `http://localhost:8000`

### Start Frontend Development Server
```bash
cd frontend
npm run dev
```
The frontend will run on `http://localhost:5173`

## 📖 Usage

1. **Open the application** in your browser at `http://localhost:5173`
2. **Select models** you want to use from the available providers
3. **Enter your prompt** in the chat interface
4. **Choose mode**:
   - **Single Model**: Query one model at a time
   - **Broadcast**: Send to multiple models simultaneously
5. **View responses** in real-time with streaming support

## 🏗️ Project Structure

```
Multi-LLm-Interface/
├── backend/
│   ├── adapters/          # Custom adapters for each LLM provider
│   │   ├── google_adapter.py
│   │   ├── groq_adapter.py
│   │   └── litellm_adapter.py
│   ├── main.py            # FastAPI application
│   └── broadcast_orchestrator.py
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── services/      # API services
│   │   ├── types/         # TypeScript types
│   │   └── pages/         # Application pages
│   └── vite.config.ts
├── litellm_config.yaml    # LLM model configuration
└── README.md
```

## 🧪 Testing

### Test Backend Endpoints
```bash
python test_broadcast_endpoint.py
python test_custom_adapters.py
```

### Check Available Models
```bash
python check_available_models.py
python list_available_models.py
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Built with FastAPI, React, and TypeScript
- LLM integration powered by LiteLLM
- Supports Google Gemini, Groq, and other providers

## 📧 Contact

**Rohit Patil** - [@MasterRohitPatil](https://github.com/MasterRohitPatil)

Project Link: [https://github.com/MasterRohitPatil/Multi-LLm-Interface](https://github.com/MasterRohitPatil/Multi-LLm-Interface)

---

⭐ If you find this project useful, please consider giving it a star!
