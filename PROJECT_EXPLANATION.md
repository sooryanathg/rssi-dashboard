# Minnal Sense — Project Deep-Dive

> A presentation and review cheatsheet covering how every part of the system works, why each technology and method was chosen, and answers to likely reviewer questions.

---

## Table of Contents

1. [Problem Statement & Motivation](#1-problem-statement--motivation)
2. [System Architecture (End-to-End)](#2-system-architecture-end-to-end)
3. [Hardware Layer — ESP32](#3-hardware-layer--esp32)
4. [Communication Layer — MQTT](#4-communication-layer--mqtt)
5. [ML Pipeline — Python](#5-ml-pipeline--python)
6. [Frontend Dashboard — React](#6-frontend-dashboard--react)
7. [Persistence Layer — Firebase Firestore](#7-persistence-layer--firebase-firestore)
8. [Deployment](#8-deployment)
9. [Technology Choices — Why Each Was Picked](#9-technology-choices--why-each-was-picked)
10. [Key Design Decisions & Trade-offs](#10-key-design-decisions--trade-offs)
11. [Anticipated Reviewer Questions & Answers](#11-anticipated-reviewer-questions--answers)

---

## 1. Problem Statement & Motivation

**Goal:** Detect whether a room is empty, has a stationary person, or has someone actively moving — *without* cameras, wearables, or any device on the person.

**How:** Wi-Fi signals (RSSI) are affected by human presence and movement. An ESP32 continuously measures the signal strength from a fixed access point. When a person enters the room or moves, the RSSI values fluctuate. By collecting these fluctuations and applying machine learning, the system classifies the room state in real time.

**Why it matters:**
- Privacy-preserving — no cameras or microphones involved
- Device-free — the person being detected doesn't need to carry anything
- Low-cost — only an ESP32 module and existing Wi-Fi infrastructure
- Applications include smart homes, elderly care, occupancy monitoring, and energy management

---

## 2. System Architecture (End-to-End)

```
┌──────────┐     MQTT (raw RSSI)     ┌────────────────┐    MQTT (prediction)    ┌───────────────┐
│  ESP32   │ ──────────────────────▶  │  Python ML     │ ────────────────────▶   │  React        │
│  Sensor  │   esp32/rssi/data        │  Predictor     │  esp32/rssi/prediction  │  Dashboard    │
└──────────┘                          └────────────────┘                         └───────┬───────┘
                                                                                         │
                                                                                         │ Firestore write
                                                                                         ▼
                                                                                 ┌───────────────┐
                                                                                 │   Firebase     │
                                                                                 │   Firestore    │
                                                                                 └───────────────┘
```

**Data flow step-by-step:**

1. **ESP32** reads RSSI from the connected Wi-Fi access point and publishes `{ timestamp, rssi }` JSON to the MQTT topic `esp32/rssi/data` roughly once per second.
2. **Python predictor** (`live_predict.py`) subscribes to `esp32/rssi/data`, buffers incoming samples into a sliding window, extracts features, runs the Random Forest model, applies spike detection and temporal voting, then publishes `{ prediction, confidence, features }` to `esp32/rssi/prediction`.
3. **React dashboard** subscribes to *both* MQTT topics. Raw RSSI data drives the live chart. Prediction messages update the state card, confidence bar, metrics, and event log.
4. When the dashboard detects a transition *into* the MOVING state, it writes the event to **Firebase Firestore** for historical logging.
5. The `/logs` page reads from Firestore in real time using `onSnapshot`, giving a live-updating movement history.

---

## 3. Hardware Layer — ESP32

The ESP32 is a low-cost Wi-Fi + Bluetooth SoC. In this project it acts purely as a **sensor**:

- It connects to a nearby Wi-Fi access point.
- It reads `WiFi.RSSI()` — the received signal strength from the AP in dBm.
- It publishes each reading as a JSON payload `{ "timestamp": <millis>, "rssi": <dBm> }` to the MQTT broker over Wi-Fi.

**Why ESP32?**
- Built-in Wi-Fi — no external radio module needed.
- `WiFi.RSSI()` is a standard API call, no complex driver work.
- Ultra low-cost (~$3 per module), widely available, Arduino-compatible.
- Low power consumption — suitable for always-on sensing.

---

## 4. Communication Layer — MQTT

### Why MQTT?

MQTT (Message Queuing Telemetry Transport) was chosen for the communication backbone between all three components (ESP32, Python predictor, React dashboard).

| Requirement | How MQTT Meets It |
|---|---|
| Lightweight | MQTT has a minimal packet overhead (as low as 2 bytes header), perfect for a microcontroller with limited memory |
| Real-time | Publish/subscribe model delivers messages with very low latency (typically <100 ms) |
| Decoupled architecture | Publisher and subscriber don't need to know about each other — the ESP32 doesn't need to know if the predictor or dashboard is running |
| Web-compatible | MQTT over WebSockets allows the browser to connect directly to the same broker without a custom backend |
| Fan-out | Multiple subscribers can listen to the same topic — both the Python predictor and the dashboard receive raw RSSI data simultaneously |

### Topics

| Topic | Publisher | Subscriber(s) | Payload |
|---|---|---|---|
| `esp32/rssi/data` | ESP32 | Python predictor, Dashboard | `{ timestamp, rssi }` |
| `esp32/rssi/prediction` | Python predictor | Dashboard | `{ prediction, confidence, features }` |

### Broker

The project uses `broker.hivemq.com`, a free public MQTT broker. The dashboard connects via **WebSockets** (`wss://broker.hivemq.com:8884/mqtt`) while the Python predictor connects via standard **TCP** (port 1883).

**Why a public broker?** For prototyping and demonstration, a public broker eliminates the need to set up and maintain infrastructure. In production, a private broker (e.g., Mosquitto, EMQX, or HiveMQ Cloud) would be used with TLS and authentication.

---

## 5. ML Pipeline — Python

### 5.1 Data Collection

Raw RSSI data was captured using the Arduino Serial Monitor from the ESP32 under three controlled conditions:

| Class | Setup |
|---|---|
| **empty** | Room with no person present |
| **idle** | Person sitting/standing still in the room |
| **moving** | Person walking around the room |

Multiple capture sessions per class were recorded (e.g., `empty.txt`, `empty2.txt`, `moving 1.txt`, etc.). The `data_loader.py` module parses these files. Each line follows the Arduino serial format: `HH:MM:SS.mmm -> counter,RSSI`, which is parsed using a regular expression.

A `LABEL_MAP` dictionary maps flexible filenames to the three canonical labels (`empty`, `idle`, `moving`).

### 5.2 Feature Extraction

Raw RSSI is a noisy 1D time-series. To make it useful for classification, we extract statistical features over **sliding windows** (configurable size, default 5 samples with step size 2).

**19 features** are extracted per window:

| Category | Features | Why |
|---|---|---|
| **Basic statistics** | mean, std, min, max, range, median | Capture the central tendency and spread — moving causes wider spread; empty is typically more stable |
| **Distribution shape** | IQR, skewness, kurtosis | IQR is more robust to outliers than range; skewness/kurtosis capture asymmetry and tail behavior in the signal |
| **Rate-of-change** | mean abs diff, rate mean, rate std, rate max | Capture how *fast* the signal changes — movement causes rapid fluctuations |
| **Energy** | RSSI energy (sum of squares / n) | Summarizes overall signal power level |
| **Zero-crossing rate** | ZCR of mean-centered signal | How often the signal oscillates around its mean — higher for movement |
| **Sample count** | n_samples | Guards against edge-case windows with fewer samples |
| **Frequency domain** | FFT peak, FFT energy, FFT spectral entropy | Captures periodic patterns in the signal. Movement often produces specific frequency signatures that time-domain features miss |

**Why sliding windows?**
- A single RSSI reading is too noisy to classify reliably.
- A window of readings captures the *pattern* of change over time, not just a single snapshot.
- Overlapping windows (step < window size) increase the number of training samples and provide smoother transitions.

**Why these specific features?**
- **Std deviation / range / IQR** are the strongest discriminators: movement causes large RSSI swings, idle has moderate variance, and empty rooms show minimal variance.
- **Rate-of-change features** capture the *speed* of fluctuations, which is high during movement.
- **FFT features** capture rhythmic patterns (e.g., someone pacing back and forth creates a quasi-periodic signal) that purely time-domain features might miss.
- **Skewness and kurtosis** help distinguish between classes that have similar means but different signal *shapes*.

### 5.3 Model Training

Two models are trained and compared:

| Model | Why Included |
|---|---|
| **Logistic Regression** | Serves as a simple, interpretable baseline. Uses `solver='lbfgs'`, `class_weight='balanced'` to handle any class imbalance. |
| **Random Forest** (200 trees) | Ensemble method that handles non-linear feature interactions, is robust to noisy features, and provides feature importance. Uses `class_weight='balanced'`, `min_samples_split=3`. |

**Why Random Forest was chosen as the primary model:**
- Handles noisy, non-linear sensor data better than linear models.
- Inherently provides `predict_proba` for confidence scores — critical for the dashboard UI.
- Provides feature importance rankings that explain *which* signal characteristics matter most.
- Does not require extensive hyperparameter tuning — works well out of the box.
- Fast inference time — prediction takes <1 ms per window, well within real-time requirements.
- Robust to irrelevant features — the forest naturally down-weights uninformative ones.

**Cross-validation strategy:**
- **Leave-One-Group-Out (LOGO)** is the default when there are 3+ source files. Each fold holds out all data from one capture session. This tests generalization to *unseen* recording conditions rather than just unseen windows from the same session.
- Falls back to **Stratified K-Fold** (k=5) when there are fewer groups.
- Both **accuracy** and **weighted F1** are reported. The best model (by F1) is saved.

**Feature scaling:**
- `StandardScaler` normalizes all features to zero mean and unit variance before training. This is essential for Logistic Regression (which is sensitive to feature scale) and good practice for any model.

**Saved artifacts (4 files):**
- `model.joblib` — the trained Random Forest
- `scaler.joblib` — the fitted StandardScaler
- `label_encoder.joblib` — maps between string labels and integer indices
- `feature_columns.joblib` — ordered list of feature names (ensures consistent feature order at inference time)

### 5.4 Live Prediction (`live_predict.py`)

The live predictor is a **two-stage prediction system** with temporal smoothing:

```
                    ┌────────────┐
   RSSI sample ───▶ │ Spike      │──── spike? ────▶ override to MOVING
                    │ Detector   │
                    └────────────┘
                          │
                          ▼
                    ┌────────────┐     ┌────────────┐
    sliding window ─▶│ RF Model   │───▶ │ Temporal   │───▶ final prediction
                    │ predict()  │     │ Voter      │
                    └────────────┘     └────────────┘
```

**Stage 1 — Sliding-window ML classifier:**
- Buffers RSSI samples into a sliding window (default 10 samples).
- When the window is full and enough new samples have arrived (`step_size`), it extracts the 19 features.
- The trained Random Forest model predicts the activity class and provides probability estimates.

**Stage 2 — Spike detector:**
- Monitors consecutive RSSI samples for sudden jumps (default threshold: 8 dBm).
- If a spike is detected, it **overrides** the model's prediction to `MOVING` and holds that state for a configurable number of prediction cycles (holdoff = 3).
- **Why?** The sliding-window approach has inherent latency — it needs a full window to detect change. A sudden RSSI spike (caused by someone moving) happens *between two consecutive samples* and can be detected instantly. This provides faster reaction time for brief movements.

**Temporal voting:**
- Maintains a rolling window of the last N predictions (default 5).
- The final output is the majority vote across this window.
- **Exception:** `MOVING` predictions always pass through immediately (no voting delay), because false negatives for movement are worse than false positives.
- **Why?** The ML model sometimes flickers between `empty` and `idle` on borderline signals. Majority voting smooths these oscillations without adding perceptible delay.

**Why this two-stage architecture?**
- The Random Forest alone is good at classifying steady-state conditions but has a latency of one full window before detecting transitions.
- The spike detector provides instant response to sudden changes.
- The temporal voter prevents noisy flickering in stable conditions.
- Together, they balance responsiveness (fast detection) with stability (no jitter).

### 5.5 Visualization (`visualize.py`)

Generates 6 plots for analysis and presentation:

1. **Raw RSSI time-series** by file — shows how the signal looks under each condition
2. **RSSI distribution histograms** — overlaid density plots showing class separation
3. **Confusion matrices** — percentage-based heatmaps for both models
4. **Model comparison** — bar chart of accuracy and F1 scores
5. **Feature importance** — Random Forest Gini importance ranking
6. **Per-class precision/recall/F1** — bar chart for each model

These are generated during training for evaluation purposes and for including in reports/presentations.

---

## 6. Frontend Dashboard — React

### 6.1 Architecture

| File | Role |
|---|---|
| `main.tsx` | Entry point. Sets up `BrowserRouter` with routes `/` (dashboard) and `/logs` (activity log). Uses a `Layout` component that mounts both pages but toggles visibility, so the dashboard keeps its MQTT connection alive when viewing logs. |
| `App.tsx` | Main dashboard. Manages all real-time state: MQTT connection, RSSI history, predictions, features, event log, session stats. |
| `pages/ActivityLog.tsx` | Movement log page. Subscribes to Firestore for real-time updates. Responsive layout. |
| `lib/firebase.ts` | Firebase initialization. Conditionally initializes only when env vars are present. |
| `lib/activityLog.ts` | Firestore CRUD operations: `logActivityEvent`, `subscribeActivityLog`, `fetchActivityLog`. |

### 6.2 Why React?

- **Component-based** — each UI card (state, metrics, chart, log, signal quality, session stats) is an isolated component that re-renders independently.
- **State management with hooks** — `useState` and `useEffect` are sufficient for this application without needing Redux or Zustand. The MQTT connection is a single effect, and derived values use `useMemo`.
- **Ecosystem** — Recharts, Framer Motion, React Router, Firebase SDK all have first-class React support.
- **TypeScript** — catches type errors at compile time, especially important when handling dynamic MQTT JSON payloads.

### 6.3 MQTT in the Browser

The dashboard connects to the MQTT broker via **WebSockets** using `mqtt.js`:

```
wss://broker.hivemq.com:8884/mqtt
```

- Subscribes to both `esp32/rssi/data` (raw chart data) and `esp32/rssi/prediction` (ML results).
- Each message is parsed from JSON and updates React state.
- RSSI history is capped at 120 samples (sliding window) to prevent memory growth.
- A unique `clientId` is generated per session to avoid MQTT client conflicts.
- On `close` event, prediction resets to `WAITING` — this prevents stale predictions from showing if the connection drops.

### 6.4 Key UI Components

**State Card:**
- Large centered card showing current prediction (Empty / Idle / Moving / Waiting).
- Color-coded icon and label with animated transitions (Framer Motion spring animation on state change).
- Confidence bar below, animated from 0 to the confidence percentage.

**RSSI Signal Timeline:**
- Recharts `AreaChart` with gradient fill.
- Shows up to 120 data points with auto-scrolling time axis.
- Tooltip displays exact RSSI and timestamp on hover.
- Sample count badge in the corner.

**Metric Cards (2x2 grid):**
- Mean RSSI, Standard Deviation, Range, and Live RSSI.
- Values come from the ML backend when available, with fallback client-side calculation from the last 25 samples.

**Detection Event Log:**
- Shows the most recent 20 state transitions.
- Color-coded dots (red for moving, yellow for idle, gray for empty).

**Signal Quality Meter:**
- Maps RSSI range (-90 to -30 dBm) to a 0–100% quality score.
- Rendered as a semicircular SVG gauge with color tiers (red / yellow / blue).
- Shows live dBm and noise (std) underneath.

**Session Stats:**
- Uptime clock, total samples, peak and min RSSI.
- Prediction distribution breakdown as a stacked horizontal bar chart.

**MOVING Alert:**
- When state is MOVING: red ambient border glow around the entire viewport (CSS box-shadow + Framer Motion fade).
- Audio alert loops continuously until the state changes.
- Audio is stopped on `pagehide` and `beforeunload` to prevent ghost playback.

**Loading Screen:**
- A branded video plays once on app load.
- A blurred full-screen copy as background, and a circular crop in the center.
- Dashboard reveals only after the video ends (or after a fallback timeout).

### 6.5 Why These Libraries?

| Library | Why Chosen |
|---|---|
| **Vite** | Near-instant HMR during development, fast production builds, native ESM support. Much faster than webpack/CRA for iterative UI work. |
| **Recharts** | Declarative charting built for React. Handles real-time streaming data well with `isAnimationActive={false}` for smooth updates without lag. |
| **Framer Motion** | Production-grade animation library for React. Spring physics for state transitions, `AnimatePresence` for mount/unmount animations. Simpler API than raw CSS transitions for complex sequences. |
| **Tailwind CSS 4** | Utility-first CSS — rapid prototyping without context-switching to separate stylesheets. Dark theme implemented via inline style constants for consistency. |
| **Lucide React** | Modern, tree-shakeable icon set. Only the icons actually used are bundled (Activity, Radio, User, etc.). |
| **React Router DOM 7** | Client-side routing for the `/` and `/logs` pages without full page reloads. The `Layout` component pattern keeps the MQTT connection alive across route changes. |

---

## 7. Persistence Layer — Firebase Firestore

### Why Firebase/Firestore?

| Requirement | How Firestore Meets It |
|---|---|
| Real-time sync | `onSnapshot` provides instant updates when new documents are added — the `/logs` page updates without polling |
| No backend to maintain | Firestore is serverless — no API server or database to deploy and manage |
| Scales automatically | Handles concurrent reads/writes without manual scaling |
| Easy integration | Firebase JS SDK works directly from the browser |
| Free tier | Firestore's free tier (50K reads/day, 20K writes/day) is sufficient for this application |

### Data Model

**Collection:** `activity_log`

Each document represents one movement detection event:

```json
{
  "state": "MOVING",
  "time": "14:32:07",
  "confidence": 87,
  "createdAt": <server timestamp>
}
```

- Only `MOVING` transitions are logged (not every state change) — this keeps the log focused on actionable events and reduces write volume.
- `serverTimestamp()` ensures consistent ordering regardless of client clock drift.
- The query uses `orderBy('createdAt', 'desc')` with `limit(200)` for efficient pagination.

### Security Rules

```
allow read, write: if true;
```

Currently open for prototyping. In production, this would use Firebase Authentication and restrict writes to authenticated dashboard sessions.

### Conditional Initialization

Firebase only initializes when the env vars are present (`firebase.ts` checks for `projectId` and `apiKey`). This means the dashboard still works without Firebase — the activity log page shows an error message, but the main dashboard functions normally with MQTT alone.

---

## 8. Deployment

### Firebase Hosting

- Serves the `dist/` folder (Vite production build).
- SPA rewrite rule: all routes redirect to `index.html` for client-side routing.
- Configuration in `firebase.json`.

### Vercel

- Alternative deployment with `vercel.json` for SPA rewrites.
- Zero-config deployment — push to Git and Vercel builds automatically.

**Why two deployment options?** Firebase Hosting was the natural choice given Firestore is already used. Vercel was added as an alternative for faster iteration (instant deploys on push, preview URLs for branches).

---

## 9. Technology Choices — Why Each Was Picked

### Why RSSI and not CSI (Channel State Information)?

| Factor | RSSI | CSI |
|---|---|---|
| Hardware | Standard on any Wi-Fi device | Requires modified firmware or specialized hardware (Intel 5300, Atheros, Nexmon) |
| Complexity | Single scalar value per reading | Matrix of amplitude + phase per subcarrier |
| ESP32 support | Native `WiFi.RSSI()` API | Not officially supported, requires firmware hacks |
| Accuracy | Good for 3-class detection (empty/idle/moving) | Better for fine-grained activity recognition |
| Practicality | Works with stock hardware | Requires specialized setup |

RSSI was chosen for **simplicity and accessibility**. For a 3-class coarse-grained detection problem, RSSI provides sufficient discriminative power without specialized hardware.

### Why Random Forest over deep learning (LSTM, CNN)?

| Factor | Random Forest | Deep Learning |
|---|---|---|
| Training data needed | Works well with hundreds of samples | Needs thousands to tens of thousands |
| Feature engineering | Requires explicit feature extraction (which is interpretable) | Learns features automatically (black box) |
| Inference speed | <1 ms per prediction | Potentially higher latency, GPU may be needed |
| Interpretability | Feature importance ranking, decision paths | Hard to explain predictions |
| Deployment | Single `joblib` file, no GPU needed | Requires TensorFlow/PyTorch runtime |
| Overfitting risk | Controlled with `min_samples_split`, `class_weight` | Higher risk with small datasets |

With ~hundreds of labeled windows from controlled captures, a Random Forest with hand-crafted features outperforms a data-hungry deep model. The explicit feature engineering also makes the system more **explainable** ("RSSI standard deviation was high, indicating movement").

### Why Python for ML and not running ML in the browser?

- scikit-learn has a mature, well-tested Random Forest implementation.
- Feature extraction involves NumPy FFT, statistical functions, and array operations that are more natural and performant in Python.
- Running ML server-side keeps the browser lightweight.
- The Python predictor can run on any machine (Raspberry Pi, laptop, cloud server) without browser limitations.

### Why MQTT over WebSockets / HTTP polling / Server-Sent Events?

| Approach | Latency | Complexity | ESP32 Support |
|---|---|---|---|
| MQTT | Very low (~50 ms) | Low (pub/sub) | Excellent (PubSubClient library) |
| WebSockets (custom) | Low | High (need custom server) | Moderate (custom firmware) |
| HTTP polling | High (poll interval) | Low | Good but wastes bandwidth |
| SSE | Low | Moderate (need server) | Not standard on ESP32 |

MQTT is the de facto standard for IoT communication. It works natively on ESP32, and MQTT over WebSockets bridges to the browser seamlessly.

---

## 10. Key Design Decisions & Trade-offs

### Decision: Two-stage prediction (RF + spike detector)

**Problem:** The Random Forest operates on sliding windows, so it inherently lags behind sudden changes by one window length.

**Solution:** The spike detector monitors consecutive samples for sudden jumps (>8 dBm). When detected, it immediately overrides the prediction to MOVING for a holdoff period.

**Trade-off:** May produce brief false positives for MOVING if there's environmental RF noise. The holdoff parameter (3 cycles) controls this balance.

### Decision: Temporal voting

**Problem:** The model occasionally flickers between `empty` and `idle` on borderline signals.

**Solution:** Majority vote over the last 5 predictions smooths the output.

**Trade-off:** Adds up to ~5 seconds of latency for transitions between empty and idle. MOVING bypasses the voter for instant response.

### Decision: Only logging MOVING transitions to Firestore

**Problem:** Logging every state change would produce excessive writes and a noisy log.

**Solution:** Only transitions *into* MOVING are logged — these are the actionable security/monitoring events.

**Trade-off:** Empty-to-idle transitions aren't historically tracked. This could be changed if needed by modifying the condition in `App.tsx`.

### Decision: Layout component with visibility toggle (not unmount)

**Problem:** Navigating to `/logs` would unmount `App.tsx`, killing the MQTT connection. Returning to `/` would require reconnecting and lose accumulated state (chart history, session stats).

**Solution:** The `Layout` component always renders `App`, but hides it with `display: none` when on `/logs`. The MQTT connection stays alive.

**Trade-off:** Slightly higher memory usage since both pages are in the DOM simultaneously.

### Decision: Client-side feature fallback

**Problem:** The ML feature display (mean, std, range) shows blank if the Python predictor isn't running.

**Solution:** `App.tsx` has a fallback calculation: if `mlFeatures` is null, it computes basic stats from the last 25 RSSI samples client-side.

**Trade-off:** The fallback calculation is simpler (only 3 of the 19 features) and less accurate than the Python pipeline. But it keeps the dashboard useful even without the predictor.

---

## 11. Anticipated Reviewer Questions & Answers

### Q: How accurate is the model?

**A:** The model is evaluated using Leave-One-Group-Out cross-validation, which tests generalization to unseen recording sessions. The exact accuracy depends on the dataset size and quality, but Random Forest with these features typically achieves 85–95% weighted F1 on 3-class RSSI classification. The confusion matrices and per-class metrics (generated by `visualize.py`) show the breakdown.

### Q: What happens if the MQTT broker goes down?

**A:** The dashboard shows "Offline" in the connection badge and the state resets to "Awaiting signal...". The `mqtt.js` client has built-in reconnection logic. No data is lost in the ML pipeline — it simply stops receiving samples. Firestore logs persist independently.

### Q: Can this work with multiple people?

**A:** The current model is trained on single-person scenarios. Multiple people would likely be classified as "MOVING" due to higher signal variance. Extending to count people would require CSI or multiple ESP32 sensors at different positions.

### Q: How does the system handle environmental changes (furniture moved, new devices)?

**A:** Environmental changes shift the baseline RSSI. Since the features are relative (std, range, rate-of-change), moderate baseline shifts don't significantly affect classification. For major changes, retraining with new data from the changed environment is recommended.

### Q: Why not use the ESP32 to run the ML model directly (edge inference)?

**A:** While possible with TensorFlow Lite Micro, the ESP32 has limited RAM (~520 KB) and no FPU for fast float operations. Running NumPy-heavy feature extraction and a 200-tree Random Forest on the ESP32 would be very slow and memory-constrained. The current architecture offloads ML to a more capable device, which also makes model updates trivial (just replace the `.joblib` file).

### Q: Why Firestore instead of a simpler database (SQLite, PostgreSQL)?

**A:** Firestore offers real-time `onSnapshot` subscriptions out of the box — the log page updates instantly without building a WebSocket server or polling mechanism. It's also serverless (no database to host/maintain), has a generous free tier, and the Firebase JS SDK works directly from the browser without a backend API.

### Q: How do you prevent false alarms?

**A:** Three layers:
1. **Sliding window** — averaging over multiple samples filters single-sample noise.
2. **Temporal voting** — majority vote over 5 predictions prevents momentary flickers from becoming state changes.
3. **Spike holdoff** — the spike detector holds for 3 cycles, preventing a single noisy reading from triggering a long MOVING state.

### Q: What is the latency from a person moving to the dashboard showing MOVING?

**A:** Approximately 1–3 seconds. The sliding window needs the next `step_size` samples (at ~1 sample/sec from ESP32) to trigger a prediction. The spike detector can react within 1 sample (~1 second) for sudden movements. MQTT transit adds ~50–100 ms.

### Q: Can the system distinguish between different types of movement (walking, running, jumping)?

**A:** Not with the current 3-class model. However, the feature extraction framework supports it — different movement types produce distinct feature patterns (e.g., running has higher `rssi_rate_max` and `fft_energy` than walking). It would require collecting labeled data for each movement type and retraining.

### Q: Why 19 features? Isn't that a lot for a simple 3-class problem?

**A:** Random Forest is inherently robust to irrelevant features — it down-weights them via Gini importance. Including extra features (like FFT and kurtosis) costs almost nothing at inference time and can capture subtle patterns that improve accuracy. The `visualize.py` module generates feature importance charts showing which features actually contribute.

### Q: How would you take this to production?

**A:**
1. Replace the public MQTT broker with a private one (TLS + authentication).
2. Add Firebase Authentication and lock down Firestore rules.
3. Deploy the Python predictor as a systemd service or Docker container.
4. Add health monitoring (heartbeat checks, MQTT disconnect alerts).
5. Implement model versioning and A/B testing for new models.
6. Add HTTPS-only access to the dashboard.

---

## Quick Reference Card

| Component | Key File(s) | One-line Summary |
|---|---|---|
| Data collection | `data_loader.py` | Parses raw ESP32 serial logs into labeled DataFrames |
| Feature engineering | `feature_extraction.py` | 19 features per sliding window (stats + rates + FFT) |
| Model training | `model.py` | Logistic Regression + Random Forest, LOGO cross-validation |
| Live prediction | `live_predict.py` | Two-stage: RF classifier + spike detector + temporal voter |
| Dashboard | `App.tsx` | MQTT-driven React UI with charts, metrics, alerts |
| Activity log | `ActivityLog.tsx` + `activityLog.ts` | Firestore-backed movement history with CSV export |
| Firebase setup | `firebase.ts` | Conditional init from env vars |
| Visualization | `visualize.py` | 6 plots for analysis and reporting |
