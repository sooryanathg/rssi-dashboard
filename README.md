# Minnal Sense — RSSI Activity Detection Dashboard

A real-time dashboard that visualizes Wi-Fi RSSI (Received Signal Strength Indicator) data from an ESP32 and uses a machine learning model to classify human activity as **Empty**, **Idle**, or **Moving**. Activity events are logged to Firebase Firestore for historical review.

## Features

- **Live RSSI Monitoring** — Real-time RSSI values streamed from an ESP32 via MQTT
- **Activity Prediction** — Random Forest classifier with spike detection and temporal voting
- **Interactive Charts** — RSSI signal plotted over time using Recharts
- **ML Feature Display** — Shows extracted features (mean, std, min, max, range, spike count, spike rate)
- **Confidence Score** — Displays prediction confidence percentage
- **Activity Log** — Movement events persisted to Firebase Firestore with a dedicated `/logs` page
- **Audio Alerts** — Audible alert when movement is detected
- **Signal Quality Meter** — RSSI mapped to a 0–100% quality gauge
- **Session Stats** — Uptime, peak/min RSSI, and prediction distribution
- **Responsive Design** — Mobile card view and desktop table layout for the activity log
- **Dark Theme UI** — Modern dark-themed interface with smooth Framer Motion animations
- **Animated Loading Screen** — Video-based loading screen during dashboard initialization

## Tech Stack

### Frontend (Dashboard)

| Technology | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite 8 | Build tool & dev server |
| React Router DOM 7 | Client-side routing (`/` and `/logs`) |
| Recharts 3 | RSSI signal charts |
| Firebase / Firestore | Activity log persistence |
| MQTT.js | Real-time data via WebSockets |
| Framer Motion | Animations |
| Lucide React | Icons |
| Tailwind CSS 4 | Styling |

### Backend (ML Pipeline)

| Technology | Purpose |
|---|---|
| Python 3 | ML scripts |
| scikit-learn | Random Forest classifier |
| pandas / NumPy | Data processing |
| joblib | Model serialization |
| paho-mqtt | MQTT client for live predictions |

## Project Structure

```
rssi-dashboard/
├── src/
│   ├── main.tsx                         # Entry point with routing (/ and /logs)
│   ├── App.tsx                          # Main dashboard component
│   ├── App.css                          # App styles
│   ├── index.css                        # Global styles
│   ├── custom.d.ts                      # Asset type declarations
│   ├── live_predict.py                  # Live prediction script (MQTT → Model → Dashboard)
│   ├── assets/                          # Static assets (loading video, alert audio, logo)
│   ├── lib/
│   │   ├── firebase.ts                  # Firebase initialization & Firestore instance
│   │   └── activityLog.ts               # Firestore CRUD & real-time subscription
│   ├── pages/
│   │   └── ActivityLog.tsx              # Movement log page (/logs)
│   └── model/
│       ├── __init__.py
│       ├── model.py                     # Model loading & inference
│       ├── feature_extraction.py        # Sliding-window feature extraction
│       ├── data_loader.py               # Dataset loading utilities
│       ├── visualize.py                 # Data visualization helpers
│       ├── model.joblib                 # Trained Random Forest model
│       ├── scaler.joblib                # Feature scaler
│       ├── label_encoder.joblib         # Label encoder
│       └── feature_columns.joblib       # Feature column definitions
├── public/
│   └── favicon.webp
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.js
├── firebase.json                        # Firebase Hosting config
├── firestore.rules                      # Firestore security rules
├── vercel.json                          # Vercel SPA rewrite config
└── .env.example                         # Environment variable template
```

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Python 3.8+** with pip
- **ESP32** flashing RSSI data to MQTT
- **Firebase project** with Firestore enabled

### 1. Clone & Configure Environment

```bash
cp .env.example .env
```

Fill in your Firebase credentials in `.env`:

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
pip install paho-mqtt numpy scikit-learn joblib
```

### 4. Start the Dashboard

```bash
npm run dev
```

The dashboard will open at `http://localhost:5173`.

### 5. Start the Live Predictor

```bash
cd src
python train.py --cv-mode stratified 
python live_predict.py
```

This connects to the MQTT broker, listens for RSSI data from the ESP32, runs the two-stage prediction pipeline (ML classifier + spike detector + temporal voting), and publishes results back to the dashboard.

## MQTT Topics

| Topic | Direction | Description |
|---|---|---|
| `esp32/rssi/data` | ESP32 → Predictor | Raw RSSI readings (`{ timestamp, rssi }`) |
| `esp32/rssi/prediction` | Predictor → Dashboard | Activity prediction (`{ prediction, confidence, features }`) |

**Broker:** `broker.hivemq.com` (public, no auth required)

## ML Model

### Algorithm

Random Forest Classifier trained on sliding-window features extracted from RSSI data, enhanced with a two-stage prediction system:

1. **Stage 1** — Sliding-window ML classifier (Random Forest)
2. **Stage 2** — Spike detector for brief RSSI disturbances between consecutive samples
3. **Temporal voting** — Stabilizes predictions (especially empty vs idle) over a configurable vote window

### Features Extracted (per sliding window)

| Feature | Description |
|---|---|
| `mean_rssi` | Average RSSI in the window |
| `std_rssi` | Standard deviation |
| `min_rssi` | Minimum RSSI value |
| `max_rssi` | Maximum RSSI value |
| `range_rssi` | Max − Min |
| `spike_count` | Number of values deviating significantly from mean |
| `spike_rate` | Percentage of spikes in the window |

### Activity Classes

| Class | Description |
|---|---|
| **Empty** | No person in the room |
| **Idle** | Person present but stationary |
| **Moving** | Person actively moving |

## Deployment

### Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

### Vercel

The project includes a `vercel.json` with SPA rewrites. Push to a connected Git repository or use the Vercel CLI:

```bash
npm run build
vercel --prod
```
