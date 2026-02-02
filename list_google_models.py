import httpx
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

async def list_google_models():
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("MISSING GOOGLE_API_KEY")
        return

    url = "https://generativelanguage.googleapis.com/v1beta/models"
    params = {"key": api_key}
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                models = response.json().get("models", [])
                print(f"Found {len(models)} models:")
                for m in models:
                    name = m.get("name", "").split("/")[-1]
                    if "gemini" in name:
                        print(f" - {name}")
            else:
                print(f"Error {response.status_code}: {response.text}")
        except Exception as e:
            print(f"Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(list_google_models())
