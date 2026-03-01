import pandas as pd
import re

def parse_serial_log(file_path, label):
    data = []
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # Match patterns like:  2963448,-65
            # or: 15:05:57.765 -> 2963448,-65
            # We capture the millis and RSSI numbers
            match = re.search(r'(\d+),(-?\d+)', line)
            if match:
                millis = int(match.group(1))
                rssi   = int(match.group(2))
                data.append({'millis': millis, 'rssi': rssi, 'label': label})
    
    if not data:
        print(f"Warning: No valid data found in {file_path}")
        return pd.DataFrame()
    
    df = pd.DataFrame(data)
    print(f"Parsed {len(df)} samples from {file_path} ({label})")
    return df

# === Change these paths to match where your files are saved ===
files = {
    'empty':  './empty.txt',
    'idle':   './idle.txt',
    'moving': './moving.txt'
}

# Parse all three
dfs = []
for label, path in files.items():
    df_part = parse_serial_log(path, label)
    if not df_part.empty:
        dfs.append(df_part)

if not dfs:
    print("No data was parsed from any file. Check file paths and content.")
else:
    # Combine into one DataFrame
    df_all = pd.concat(dfs, ignore_index=True)
    
    # Optional: sort by time (in case logs were appended out of order)
    df_all = df_all.sort_values('millis')
    
    # Save to CSV
    output_file = 'all_rssi_labeled.csv'
    df_all.to_csv(output_file, index=False)
    print(f"\nSaved combined data to: {output_file}")
    print(f"Total samples: {len(df_all)}")
    print("\nSamples per class:")
    print(df_all['label'].value_counts())
    print("\nFirst few rows:")
    print(df_all.head(10))
    print("\nBasic stats:")
    print(df_all.groupby('label')['rssi'].describe())