# AI System Card (Lantern Study)

**Last updated:** June 13, 2026  
**Risk classification:** Limited-risk AI (transparency obligations)

## Intended purpose

Assist students with:

- Generating practice questions and flashcards from notes
- Explaining answers and tutoring
- In-app AI companion chat
- YouTube note summarization and audio transcription
- Marketplace listing assistance

## Not intended for

- Medical, legal, or financial advice
- High-stakes automated decisions without human review
- Minors without parental guidance

## Models & providers

Fallback chain: Groq (Llama 3.3 70B) → Google Gemini → Cloudflare Workers AI → Hugging Face. Provider selected server-side based on availability.

## Limitations

- Output may be factually wrong or incomplete
- Rate limits apply per user per 24 hours
- English-first; other languages not guaranteed

## Human oversight

Users review and edit generated content before saving. Users can report issues via support@lanternstudy.com.

## Data sent to providers

Content the user submits to an AI feature (notes, questions, chat, audio). Metadata logged locally (feature, provider, timestamp) — not full prompts in `ai_inference_log` by default.

## User transparency

In-app disclaimers on all AI surfaces. Privacy Policy § AI features.

## Contact

privacy@lanternstudy.com
