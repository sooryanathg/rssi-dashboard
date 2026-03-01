import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report
import matplotlib.pyplot as plt
import seaborn as sns
import joblib

# ────────────────────────────────────────────────
# CONFIGURATION
# ────────────────────────────────────────────────
CSV_FILE = 'all_rssi_labeled.csv'

WINDOW_SEC = 8.0          # longer window helps idle detection
STEP_SEC   = 2.0          # step size (overlap = WINDOW_SEC - STEP_SEC)
SCAN_HZ    = 1.0          # your scan interval is 1000 ms → 1 Hz

# ────────────────────────────────────────────────
# FEATURE EXTRACTION FUNCTION
# ────────────────────────────────────────────────
def extract_features(window):
    if len(window) < 3:
        return None
    
    rssi = window['rssi']
    
    features = {
        'mean_rssi':   rssi.mean(),
        'std_rssi':    rssi.std(),
        'min_rssi':    rssi.min(),
        'max_rssi':    rssi.max(),
        'range_rssi':  rssi.max() - rssi.min(),
        'spike_count': (abs(rssi - rssi.mean()) > 5).sum(),          # big deviations
        'spike_rate':  (abs(rssi - rssi.mean()) > 5).mean() * 100,   # % of points that are spikes
    }
    return features

# ────────────────────────────────────────────────
# MAIN PROCESSING
# ────────────────────────────────────────────────
print("Loading data...")
df = pd.read_csv(CSV_FILE)

# Create sliding windows
X = []  # list of feature dictionaries → will become array
y = []  # labels

WINDOW_SAMPLES = int(WINDOW_SEC * SCAN_HZ)
STEP_SAMPLES   = int(STEP_SEC * SCAN_HZ)

print(f"Window: {WINDOW_SEC}s ({WINDOW_SAMPLES} samples), Step: {STEP_SEC}s ({STEP_SAMPLES} samples)")

for label, group in df.groupby('label'):
    group = group.sort_values('millis').reset_index(drop=True)
    
    for start in range(0, len(group) - WINDOW_SAMPLES + 1, STEP_SAMPLES):
        window = group.iloc[start : start + WINDOW_SAMPLES]
        feats = extract_features(window)
        if feats is not None:
            X.append(list(feats.values()))
            y.append(label)

X = np.array(X)
feature_names = list(feats.keys())  # ['mean_rssi', 'std_rssi', ...]

print(f"\nTotal windows created: {len(X)}")
print("Class distribution:")
print(pd.Series(y).value_counts())

# ────────────────────────────────────────────────
# NORMALIZE FEATURES
# ────────────────────────────────────────────────
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# ────────────────────────────────────────────────
# TRAIN / TEST SPLIT
# ────────────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X_scaled, y,
    test_size=0.30,
    random_state=42,
    stratify=y
)

print(f"\nTraining set: {len(X_train)} windows")
print(f"Test set:     {len(X_test)} windows")

# ────────────────────────────────────────────────
# TRAIN RANDOM FOREST
# ────────────────────────────────────────────────
clf = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    class_weight='balanced',      # helps with class imbalance & recall
    random_state=42,
    n_jobs=-1
)

print("\nTraining model...")
clf.fit(X_train, y_train)

# ────────────────────────────────────────────────
# EVALUATE
# ────────────────────────────────────────────────
y_pred = clf.predict(X_test)

accuracy = accuracy_score(y_test, y_pred)
print(f"\nAccuracy: {accuracy:.3f} ({accuracy*100:.1f}%)")

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

# Confusion Matrix
labels = ['empty', 'idle', 'moving']
cm = confusion_matrix(y_test, y_pred, labels=labels)

plt.figure(figsize=(7, 6))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=labels, yticklabels=labels)
plt.title('Confusion Matrix (Test Set)')
plt.xlabel('Predicted')
plt.ylabel('True')
plt.tight_layout()
plt.savefig('confusion_matrix_updated.png', dpi=150)
print("Saved: confusion_matrix_updated.png")

# ────────────────────────────────────────────────
# SAVE MODEL & SCALER FOR FUTURE USE
# ────────────────────────────────────────────────
joblib.dump(clf, 'activity_classifier_rf.joblib')
joblib.dump(scaler, 'rssi_feature_scaler.joblib')
print("\nModel and scaler saved:")
print(" - activity_classifier_rf.joblib")
print(" - rssi_feature_scaler.joblib")

print("\nDone! You can now use this model for live predictions.")