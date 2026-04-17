# Omi — Deep Read
Source: https://github.com/BasedHardware/Omi (sparse clone at /tmp/research/Omi/)
Date: 2026-04-15
Stack: FastAPI (Python) + Flutter (Dart) + WebSocket audio streaming

---

## What It Is
Always-on AI wearable + app. Bluetooth device streams audio over WebSocket.
App transcribes continuously, builds conversation memory, runs integrations.

---

## WebSocket Audio Pipeline
File: `backend/routers/pusher.py`

### Endpoint
```python
@router.websocket("/v1/trigger/listen")
async def websocket_endpoint_trigger(websocket, uid, sample_rate=8000)
```

### Binary Frame Protocol
Each frame: `header(4 bytes little-endian uint32) | payload`

| header_type | meaning |
|-------------|---------|
| 100 | Heartbeat (keepalive, skip) |
| 101 | Audio bytes: `header(4) + timestamp(8 bytes double) + PCM data` |
| 102 | Transcript JSON: `{segments: [...], memory_id: str}` |
| 103 | Conversation ID switch: `UTF-8 string` |
| 104 | Process conversation request: `{conversation_id, language}` |
| 105 | Speaker sample extraction: `{person_id, conv_id, segment_ids}` |

### Concurrent Background Tasks (all run via asyncio.gather)
```python
receive_tasks()           # main WebSocket receive loop
process_speaker_sample_queue()  # 15s interval, min 120s age before extract
process_private_cloud_queue()   # 1s interval, batch by conv_id, flush at 60s
process_transcript_queue()      # 1s interval, batch realtime integrations
process_audio_bytes_queue()     # event-driven, wakes on audio_bytes_event
```

### Bounded Queues (deque with maxlen)
- `speaker_sample_queue`: maxlen=100
- `transcript_queue`: maxlen=50, flush every 1s
- `audio_bytes_queue`: maxlen=20, event-driven wake
- `private_cloud_queue`: UNBOUNDED (irreplaceable user audio)

### Audio Bytes Trigger Logic
```python
# App trigger: every 4 seconds of audio (sample_rate * 2 * 4 bytes)
if len(trigger_audiobuffer) > sample_rate * 4 * 2:
    audio_bytes_queue.append({'type': 'app', 'data': ...})
    audio_bytes_event.set()  # instant consumer wake

# Webhook trigger: configurable delay per user
if len(audiobuffer) > sample_rate * webhook_delay * 2:
    audio_bytes_queue.append({'type': 'webhook', 'data': ...})
```

### Private Cloud Sync
- Batch chunks by conversation_id
- Flush at: 60s of audio data OR 60s age OR WebSocket close
- 3 retry attempts before dropping

---

## Conversation Processing
File: `backend/routers/pusher.py:_process_conversation_task()`

```python
process_conversation(uid, language, conversation)  # blocking → thread pool
trigger_external_integrations(uid, conversation)   # blocking → thread pool
# Result sent back via binary frame type 201
```

---

## Speaker Identification
File: `backend/utils/speaker_identification.py`

- `extract_speaker_samples(uid, person_id, conversation_id, segment_ids, sample_rate)`
- Delayed: only processes requests where age ≥ 120 seconds
- Prevents noisy early audio from poisoning speaker models

---

## Key Patterns for BLADE

### 1. Binary Framing
Omi uses `struct.pack('<I', header_type)` for efficient binary WebSocket messages.
BLADE audio pipeline should use the same approach when streaming PCM over Tauri IPC.

### 2. Bounded Queue Pattern
Each consumer has its own `deque(maxlen=N)` — backpressure without unbounded growth.
Only irreplaceable data (raw audio cloud sync) gets unbounded queue.

### 3. Conversation Lifecycle
```
audio stream → conversation_id assignment (frame 103)
→ transcript accumulation (frame 102)
→ explicit process request (frame 104)
→ result returned via binary frame
```
BLADE equivalent: segment accumulation → question detection → LLM fire.

### 4. Speaker Diarization Delay
Queue speaker extraction but only process after 120s minimum age.
Prevents early noise from corrupting speaker embeddings.

### 5. Event-Driven vs Polling
- Audio bytes: event-driven (`asyncio.Event` + immediate set)
- Transcript: polling (1s interval batch)
- Speaker samples: slow polling (15s interval, 120s min age)
Match consumer interval to data freshness needs.

---

## What BLADE Can Take From Omi
- Binary frame protocol for efficient IPC (not JSON for hot audio path)
- Bounded deque per consumer (audio, transcript, processing)
- Delayed speaker sample extraction (noise gate via time)
- Conversation-anchored audio accumulation with flush-on-switch
- Private data gets unbounded queue; interruptible data gets bounded
