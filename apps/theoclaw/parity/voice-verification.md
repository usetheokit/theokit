# OC-102: voice-note replies (B-401)

Status: open. No real-platform/model recording was made in the implementation
sandbox. Offline tests are not shipping evidence. OC-100 (continuous talk) and
OC-101 (wake word) remain unchanged and belong to B-722 per the issue amendment.

The implementation assumes Telegram is the first supported voice platform.
Other chat platforms keep their existing behavior. Voice is opt-in: configure
`THEOCLAW_VOICE_OPENAI_API_KEY` separately from the normal chat model credentials.
The credential is included in TheoClaw's output and reply secret masks.

Audio uses OpenAI `gpt-4o-mini-transcribe` and `gpt-4o-mini-tts` (alloy, Ogg Opus).
The conversation still uses `THEOCLAW_MODEL` and its existing session, owner,
group-activation and broadcast rules. Only admitted messages reach transcription.
Voice transcripts are treated as ordinary chat text, including chat commands.
Notes and generated audio are held in memory, with a 20 MiB limit and 60 second
HTTP request deadlines. Normal session transcript retention still applies.

Transcription failures get a generic text response without running the chat
model. Speech failures and replies longer than 4096 characters fall back to the
masked text answer. Successful audio carries an AI-generated voice disclosure.
No audio retry is attempted; a timeout after upload can leave both audio and the
text fallback delivered.

## Offline proof

Run `pnpm --filter theoclaw test tests/voice-replies.test.ts` after building
workspace packages. The tests use a real gateway runner, parsed Telegram update,
owner hooks and the reply/session handler, with deterministic model and network
fakes. They check denied senders, audio upload, transcript prompts, masking,
thread routing, bounded downloads, failures and text fallback.

The audio requests follow the official OpenAI API references:
[transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
and [speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Outstanding recorded run

Use a real Telegram bot/account and paid model credentials outside the sandbox:

1. Build/start TheoClaw with a workspace, `THEOCLAW_TELEGRAM_TOKEN`, the owner
   allowlist, `THEOCLAW_MODEL` naming the exact real conversation model and its
   normal credential, plus `THEOCLAW_VOICE_OPENAI_API_KEY`.
2. Record the run (screen/audio) while the admitted owner sends a voice note in
   the bot's DM, asking a question with a recognizable answer. Play the returned
   voice note and verify it answers that question. Send a follow-up note and
   verify the conversation context remains available.
3. Record timestamp, exact chat model, transcription and speech models, platform,
   and recording location alongside the pass/fail result. Exclude credentials.
4. Only after a passing real run, attach that evidence to OC-102 in PIECE-12 and
   mark it shipped. A person must make any decision to declare the row out.
