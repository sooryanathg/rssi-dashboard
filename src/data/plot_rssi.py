import pandas as pd
import matplotlib.pyplot as plt

try:
    df = pd.read_csv('all_rssi_labeled.csv')
except FileNotFoundError:
    print("Error: 'all_rssi_labeled.csv' not found.")
    exit(1)

# Relative time in seconds per class
df['time_s'] = (df['millis'] - df.groupby('label')['millis'].transform('min')) / 1000.0

# Plot 1: Raw RSSI
plt.figure(figsize=(14, 6))
for label, group in df.groupby('label'):
    plt.plot(group['time_s'], group['rssi'], label=label, alpha=0.7, linewidth=1.2)

plt.title('Raw RSSI over Time – Empty vs Idle vs Moving')
plt.xlabel('Time since start of each session (seconds)')
plt.ylabel('RSSI (dBm)')
plt.legend()
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('rssi_raw_plot.png', dpi=150)
print("Saved: rssi_raw_plot.png")

# Plot 2: Rolling std dev
window_sec = 5
scan_hz = 1.0
window_samples = int(window_sec * scan_hz) + 1  # ≈6

df_sorted = df.sort_values(['label', 'millis']).copy()
df_sorted['rssi_std'] = df_sorted.groupby('label')['rssi'].transform(
    lambda x: x.rolling(window=window_samples, min_periods=3).std()
)

plt.figure(figsize=(14, 6))
for label, group in df_sorted.groupby('label'):
    plt.plot(group['time_s'], group['rssi_std'], label=label, alpha=0.8)

plt.title(f'Rolling Std Dev of RSSI ({window_sec}s window)')
plt.xlabel('Time (seconds)')
plt.ylabel('Std Dev (dBm)')
plt.legend()
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('rssi_std_plot.png', dpi=150)
print("Saved: rssi_std_plot.png")

# Stats on rolling std
print("\nRolling std dev statistics per class:")
print(df_sorted.groupby('label')['rssi_std'].describe())

# Simple threshold example
threshold_idle   = 2.5   # adjust after seeing plot
threshold_moving = 4.5

df_sorted['simple_pred'] = 'empty'
df_sorted.loc[df_sorted['rssi_std'] > threshold_idle,   'simple_pred'] = 'idle'
df_sorted.loc[df_sorted['rssi_std'] > threshold_moving, 'simple_pred'] = 'moving'

print("\nSimple threshold confusion matrix:")
print(pd.crosstab(df_sorted['label'], df_sorted['simple_pred'], margins=True))