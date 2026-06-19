"""Gemini Live voice proxy for Momo.

Relays audio between a browser WebSocket and a Gemini Live (Vertex) session.

Momo is a general voice assistant. Rather than a mid-conversation tool call
(Gemini Live currently returns no audio after a function response — a known
upstream bug), we inject Rupa's full Konkani recipe book into the session's
system instruction at connect time. The book is small, so the model always has
the real recipes on hand and stays grounded without a tool round-trip.
"""

import asyncio
import contextlib
import json

from google.genai import types

from . import config, momo_guardrails, recipes

PERSONA = """
You are Momo, a warm, friendly voice assistant for Rupa & Ruchi's Kitchen.
You are only allowed to help with cooking, recipes, ingredients, food, drinks,
kitchen techniques, substitutions, timing, servings, and step-by-step cooking
guidance.

If the user asks about anything outside cooking or kitchen help (for example
sports, politics, or coding), do not answer the off-topic question. Briefly say:
"I can help with cooking, recipes, ingredients, and kitchen steps only." Then
stop. A dish or recipe that simply isn't in the book is NOT off-topic — never
use this refusal for a cooking question; help with it as described below.

When the user asks about food, a dish, ingredients, cooking steps, substitutions,
timing, servings, or "what should I cook", always check the recipe book below
FIRST and prefer it. If the dish is in the book, use that version and follow its
ingredients and measurements faithfully.

If the dish is not in the book, do NOT refuse. Help anyway: use the Google Search
tool to find a real, reliable recipe, then share it. Briefly mention it's not one
of our website recipes. Feel free to adjust ingredients, quantities, or steps to
fit the user's needs (servings, dietary restrictions, what they have on hand).
Never make up implausible measurements — ground outside recipes in what you find.

You can scale recipes to any batch size. If the user asks for a large quantity
(for example 30 to 50 people, or a specific number of servings), figure out the
recipe's base servings and multiply every ingredient by the right factor. Give
the scaled amounts in clear, practical units (cups, grams, kilograms, liters,
dozens) and round to sensible cooking measures. State the factor and the serving
count you scaled to so the user can double-check.

For step-by-step recipe guidance, answer with the next relevant step from the
recipe and stop. Do not end by asking the user what the next step is. If helpful,
end with "Tell me when you're ready for the next step."

Keep answers brief enough to be comfortable to listen to.
""".strip()


def recipe_book_text():
    book = recipes.search_recipes("", limit=200)  # all recipes, compact form
    return json.dumps(book, ensure_ascii=False)


def build_system_instruction(memory=""):
    parts = [PERSONA, "", "Rupa's Konkani recipe book (JSON):", recipe_book_text()]
    if memory:
        parts += ["", "What you remember from earlier conversations with this user:", memory]
    return "\n".join(parts)


def build_config(memory=""):
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        tools=[types.Tool(google_search=types.GoogleSearch())],
        system_instruction=types.Content(parts=[types.Part(text=build_system_instruction(memory))]),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True),
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            turn_coverage=types.TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
        ),
    )


def format_memory(messages):
    """Turn stored (role, content) rows into a short recap for the system prompt."""
    if not messages:
        return ""
    label = {"user": "User", "momo": "Momo"}
    return "\n".join(f"{label.get(role, role)}: {content}" for role, content in messages)


async def _browser_to_live(websocket, session, save_message=None):
    """Forward microphone PCM (and control frames) from the browser to Gemini."""
    if save_message is None:
        def save_message(role, text):
            return None

    while True:
        message = await websocket.receive()
        if message.get("type") == "websocket.disconnect":
            return
        data = message.get("bytes")
        if data is not None:
            await session.send_realtime_input(
                audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000")
            )
            continue
        text = message.get("text")
        if text == "end":
            return
        if text:
            try:
                event = json.loads(text)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "activity_start":
                await session.send_realtime_input(activity_start=types.ActivityStart())
            elif event.get("type") == "activity_end":
                await session.send_realtime_input(activity_end=types.ActivityEnd())
            elif event.get("type") == "text_prompt":
                prompt = (event.get("text") or "").strip()
                if prompt:
                    is_valid, refusal = momo_guardrails.validate_text(prompt)
                    if not is_valid:
                        await websocket.send_json(
                            {"type": "guardrail_blocked", "detail": refusal}
                        )
                        return
                    save_message("user", prompt)
                    await session.send_realtime_input(activity_start=types.ActivityStart())
                    await session.send_realtime_input(text=prompt)
                    await session.send_realtime_input(activity_end=types.ActivityEnd())


async def _live_to_browser(websocket, session, save_message):
    """Forward Gemini audio + transcripts back to the browser, persisting turns.

    Transcriptions arrive in fragments; we buffer them per role and save the
    full utterance when the turn completes, so memory holds clean sentences.
    """
    async def emit(event):
        await websocket.send_json(event)

    buffers = {"user": "", "momo": ""}

    def flush():
        for role in ("user", "momo"):
            text = buffers[role].strip()
            if text:
                save_message(role, text)
            buffers[role] = ""

    async for message in session.receive():
        if message.data:
            await websocket.send_bytes(message.data)

        server_content = message.server_content
        if server_content:
            it = server_content.input_transcription
            if it and it.text:
                buffers["user"] += it.text
                await emit({"type": "user_transcript", "text": it.text})
            ot = server_content.output_transcription
            if ot and ot.text:
                buffers["momo"] += ot.text
                await emit({"type": "momo_transcript", "text": ot.text})
            if server_content.interrupted:
                await emit({"type": "interrupted"})
            if server_content.turn_complete:
                flush()
                await emit({"type": "turn_complete"})

        if message.go_away:
            await emit({"type": "go_away"})


async def run_session(websocket, user, memory="", save_message=None):
    """Open a Live session and relay until the browser disconnects."""
    if save_message is None:
        def save_message(role, text):
            return None

    client = config.make_genai_client()
    live_config = build_config(memory)

    async with client.aio.live.connect(model=config.MOMO_LIVE_MODEL, config=live_config) as session:
        await websocket.send_json({"type": "ready"})
        sender = asyncio.create_task(_browser_to_live(websocket, session, save_message))
        receiver = asyncio.create_task(_live_to_browser(websocket, session, save_message))
        tasks = {sender, receiver}
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

        for task in done:
            exc = task.exception()
            if exc:
                raise exc
