# RSSI Activity Detection Dashboard

A real-time dashboard that visualizes Wi-Fi RSSI (Received Signal Strength Indicator) data from an ESP32 and uses a machine learning model to classify human activity as **Empty**, **Idle**, or **Moving**.

## Features

- **Live RSSI Monitoring** — Real-time RSSI values streamed from an ESP32 via MQTT
- **Activity Prediction** — Random Forest classifier detects room occupancy and movement
- **Interactive Charts** — RSSI signal plotted over time using Recharts
- **ML Feature Display** — Shows extracted features (mean, std, min, max, range, spike count, spike rate)
- **Confidence Score** — Displays prediction confidence percentage
- **Dark Theme UI** — Modern dark-themed interface with smooth animations

## Tech Stack

### Frontend (Dashboard)

| Technology | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite | Build tool & dev server |
| Recharts | RSSI signal charts |
| MQTT.js | Real-time data via WebSockets |
| Framer Motion | Animations |
| Lucide React | Icons |
| Tailwind CSS | Styling |

### Backend (ML Pipeline)

| Technology | Purpose |
|---|---|
| Python 3 | ML scripts |
| scikit-learn | Random Forest classifier |
| pandas / NumPy | Data processing |
| joblib | Model serialization |
| paho-mqtt | MQTT client for live predictions |
| matplotlib / seaborn | Data visualization |

## Project Structure

```
rssi-dashboard/
├── src/
│   ├── App.tsx                          # Main dashboard component
│   ├── App.css                          # App styles
│   ├── index.css                        # Global styles
│   ├── main.tsx                         # Entry point
│   ├── assets/                          # Static assets (loading animation, etc.)
│   └── data/                            # ML model & training pipeline
│       ├── live_activity_predictor.py   # Live prediction script (MQTT → Model → Dashboard)
│       ├── activity_classifier_rf.joblib # Trained Random Forest model
│       ├── rssi_feature_scaler.joblib   # Feature scaler for normalization
│       ├── train_activity_classifier.py # Model training script
│       ├── parse_rssi_logs.py           # Raw log parser → CSV
│       ├── plot_rssi.py                 # Data visualization script
│       ├── all_rssi_labeled.csv         # Combined labeled dataset
│       ├── empty.txt                    # Raw RSSI log — empty room
│       ├── idle.txt                     # Raw RSSI log — person idle
│       └── moving.txt                   # Raw RSSI log — person moving
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
└── eslint.config.js
```

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Python 3.8+** with pip
- **ESP32** flashing RSSI data to MQTT

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Install Python Dependencies

```bash
pip install paho-mqtt numpy pandas scikit-learn joblib matplotlib seaborn
```

### 3. Start the Dashboard

```bash
npm run dev
```

The dashboard will open at `http://localhost:5173`.

### 4. Start the Live Predictor

```bash
cd src/data
python live_activity_predictor.py
```

This connects to the MQTT broker, listens for RSSI data from the ESP32, runs predictions using the trained model, and publishes results back to the dashboard.

## MQTT Topics

| Topic | Direction | Description |
|---|---|---|
| `esp32/rssi/data` | ESP32 → Predictor | Raw RSSI readings (`{ timestamp, rssi }`) |
| `esp32/rssi/prediction` | Predictor → Dashboard | Activity prediction (`{ prediction, confidence, features }`) |

**Broker:** `broker.hivemq.com` (public, no auth required)

## ML Model

### Algorithm

Random Forest Classifier with 200 estimators, trained on sliding window features extracted from RSSI data.

### Features Extracted (per 8-second window)

| Feature | Description |
|---|---|
| `mean_rssi` | Average RSSI in the window |
| `std_rssi` | Standard deviation |
| `min_rssi` | Minimum RSSI value |
| `max_rssi` | Maximum RSSI value |
| `range_rssi` | Max − Min |
| `spike_count` | Number of values deviating > 5 dBm from mean |
| `spike_rate` | Percentage of spikes in the window |

### Activity Classes

| Class | Description |
|---|---|
| **Empty** | No person in the room |
| **Idle** | Person present but stationary |
| **Moving** | Person actively moving |

## Retraining the Model

If you collect more RSSI data and want to improve the model:

1. **Collect raw serial logs** from the ESP32 for each activity and save them as `.txt` files (e.g., `empty.txt`, `idle.txt`, `moving.txt`).

2. **Parse the logs** into a labeled CSV:
   ```bash
   cd src/data
   python parse_rssi_logs.py
   ```

3. **Train a new model:**
   ```bash
   python train_activity_classifier.py
   ```
   This will output updated `activity_classifier_rf.joblib` and `rssi_feature_scaler.joblib` files, along with a confusion matrix image.

4. **Restart the live predictor** to use the new model:
   ```bash
   python live_activity_predictor.py
   ```
