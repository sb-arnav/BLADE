# OpenClaw — Deep Read
Source: https://github.com/openclaw/openclaw (cloned /tmp/research/openclaw/)
Date: 2026-04-15

## What It Is
Self-hosted personal AI assistant — TypeScript + Swift. Runs as a local Gateway daemon, connects to any messaging channel (WhatsApp, Telegram, Slack, Discord, iMessage). 358k GitHub stars, MIT license.

---

## Phase State Machine
File: `apps/macos/Sources/OpenClaw/TalkModeTypes.swift`

```swift
enum TalkModePhase: String {
    case idle      // Not active
    case listening // User speaking, capturing audio
    case thinking  // Processing/generating response
    case speaking  // AI is speaking output
}
```

---

## TalkOverlay Model
File: `apps/macos/Sources/OpenClaw/TalkOverlay.swift`

```swift
struct Model {
    var isVisible: Bool = false
    var phase: TalkModePhase = .idle
    var isPaused: Bool = false
    var level: Double = 0  // 0.0 - 1.0, normalized audio level
}
static let overlaySize: CGFloat = 440
static let orbSize: CGFloat = 96
```

---

## Animation Math (Exact Values)
File: `apps/macos/Sources/OpenClaw/TalkOverlayView.swift`

### Orb scaling:
- Listening: `1 + (level * 0.12)` — breathes with voice
- Speaking: `1 + 0.06 * sin(t * 6)` — 6Hz sine pulse (oscillates 0.94–1.06)
- Idle/thinking: 1.0

### 3 staggered expanding rings (each idx 0,1,2):
```
speed    = speaking:1.4 | listening:0.9 | idle/thinking:0.6
progress = (time * speed + idx * 0.28) % 1   // staggered by 0.28 cycle
amplitude= speaking:0.95 | listening:(0.5 + level*0.7) | idle:0.35
alpha    = speaking:0.72 | listening:(0.58 + level*0.28) | idle:0.4

scale    = 0.75 + progress*amplitude + (listening ? level*0.15 : 0)
opacity  = alpha - progress*0.6
stroke   = accent.opacity(alpha - progress*0.3), lineWidth=1.6
```

### Thinking arcs (only when thinking):
```
arc1: trim(0.08, 0.26), stroke white 0.88 opacity, rotation = +t*42°/s
arc2: trim(0.62, 0.86), stroke white 0.70 opacity, rotation = -t*35°/s
```

---

## Orb Gradient:
```swift
RadialGradient(colors: [Color.white, accent], center: .topLeading, startRadius: 4, endRadius: 52)
```

---

## iOS Version (TalkOrbOverlay.swift)
Simpler — good reference for React port:
- Ring 1: 1.3s easeOut repeat, scale 0.96→1.15, opacity 1→0
- Ring 2: 1.9s + 0.2s delay, scale 1.02→1.45
- Core orb: `scale = 1.0 + (0.12 * mic)`, gradient opacity `0.75 + (0.20 * mic)`
- Mic level bar: `width = max(18, 180 * mic)`, animated easeOut 0.12s

---

## Audio Level Capture
File: `apps/macos/Sources/OpenClaw/MicLevelMonitor.swift`

### RMS normalization:
```swift
rms = sqrt(sum(sample²) / frameCount + 1e-12)
db = 20 * log10(rms)
level = clamp((db + 50) / 50, 0, 1)
```

### Exponential smoothing:
```swift
smoothedLevel = (smoothedLevel * 0.45) + (level * 0.55)
```

### Adaptive noise floor (TalkModeRuntime.swift):
```
alpha = rms < noiseFloor ? 0.08 : 0.01
noiseFloor = noiseFloor + (rms - noiseFloor) * alpha
threshold = max(1e-3, noiseFloor * 6.0)   // 6x boost
clamped = clamp(rms / threshold, 0, 1)
```

### Timing:
- RMS sampled every 50ms (20Hz)
- UI updates throttled to 12fps (83ms)

---

## Voice Wake Overlay Model
File: `apps/macos/Sources/OpenClaw/VoiceWakeOverlay.swift`

```swift
struct Model {
    var text: String = ""         // Live transcript
    var isFinal: Bool = false
    var isVisible: Bool = false
    var forwardEnabled: Bool = false
    var isSending: Bool = false
    var isEditing: Bool = false
    var isOverflowing: Bool = false
    var level: Double = 0         // 0..1 speech level
}
// Width=360pt, minHeight=48pt, maxHeight=400pt
// levelUpdateInterval = 1/12 = 83ms throttle
```

Send button fill: `width * level`, animated easeOut 0.08s
Spring on send: `spring(response: 0.35, dampingFraction: 0.78)`

---

## Window Management
File: `apps/macos/Sources/OpenClaw/OverlayPanelFactory.swift`

```swift
// NSPanel config:
styleMask: [.nonactivatingPanel, .borderless]
isOpaque: false
backgroundColor: .clear
collectionBehavior: [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
hidesOnDeactivate: false
isFloatingPanel: true
becomesKeyOnlyIfNeeded: true

// Window level:
NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue - 4)

// Present: 180ms easeOut fade-in
// Dismiss: 160ms easeOut + 6px offset slide
```

### Tauri equivalent:
```json
{ "decorations": false, "alwaysOnTop": true, "skipTaskbar": true, "focus": false, "transparent": true }
```

---

## Agent Event Store
File: `apps/macos/Sources/OpenClaw/AgentEventStore.swift`

```swift
// Rolling buffer of 400 events
private let maxEvents = 400
// Observable pattern — @Observable final class
```

---

## Interaction (Orb)
- Single click: pause/resume
- Double click: stop speaking
- Drag: reposition window
- Hover: reveal close button (120ms easeOut fade-in)
- HoverHUD: appears 180ms after menu bar hover, dismisses after 250ms
