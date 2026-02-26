import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options=types.HttpOptions(timeout=300_000),
)

response = client.models.generate_content(
    model="gemini-3.1-pro-preview",
    contents="Hello, world! Tell me something interesting.",
)
print(response.text)
