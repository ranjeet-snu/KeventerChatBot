import google.generativeai as genai

genai.configure(api_key="AIzaSyCIxEbfSAbIBnDfaR3e4-VhtL51czhsFgg")
model = genai.GenerativeModel("gemini-1.5-flash")

text = "আমি বাংলায় কথা বলছি"  # Bengali text

response = model.generate_content(
    f"Translate this to English and summarize:\n{text}"
)
print(response.text)