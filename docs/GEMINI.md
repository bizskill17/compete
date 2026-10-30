# Gemini judging on Hostinger

Set the following in the Compete website's Hostinger environment variables:

- `GEMINI_API_KEY`: a private Gemini API key.
- `GEMINI_MODEL`: optional; defaults to `gemini-3.8-flash`.

Save and redeploy. No database migration is required. Both the participant and admin AI configuration indicators recognize Gemini. They indicate configuration presence rather than successful connectivity.

When a Gemini key exists, it takes precedence over OpenAI. If only `OPENAI_API_KEY` exists, the existing OpenAI integration remains active. Failed Gemini requests do not automatically fall back to OpenAI or incur a second provider charge. No secrets are returned to the browser.

Use Admin → Entries & judging → Review → Run AI judging to assess a pending image entry. The image and competition title/theme are sent to the selected provider. The same 100-point rubric applies: creativity 30, composition 25, craftsmanship 25, theme 20. Scorecards record the provider and model. Existing scorecards are reused; changing a key or provider does not rescore them.

Invalid, incomplete or blocked responses leave entries pending. Errors explain unavailable models, denied access and quota/rate limits without exposing raw provider error bodies or API keys. Check API project permissions, model access, quota and billing if a request fails. Rejected entries remain blocked from judging.

This integration supports image assessment only; it does not add code execution, quiz marking, video/audio judging or proof of originality. Admin review of winners remains necessary.

Official references:
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash

Validation uses mocked provider responses. Live account credentials, quota, model access and target-host network connectivity must be verified after deployment.
