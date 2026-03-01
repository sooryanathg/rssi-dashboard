import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ACTIVITY_LOG_COLLECTION } from './firebase';

export type ActivityState = 'EMPTY' | 'IDLE' | 'MOVING' | 'WAITING';

export interface ActivityLogEntry {
  id: string;
  state: ActivityState;
  time: string;
  timestamp: number;
  confidence?: number;
}

export interface ActivityLogInput {
  state: ActivityState;
  time: string;
  confidence?: number;
}

export async function logActivityEvent(
  db: Firestore,
  input: ActivityLogInput
): Promise<void> {
  const col = collection(db, ACTIVITY_LOG_COLLECTION);
  await addDoc(col, {
    state: input.state,
    time: input.time,
    confidence: input.confidence ?? null,
    createdAt: serverTimestamp(),
  });
}

export function subscribeActivityLog(
  db: Firestore,
  maxEntries: number,
  onUpdate: (entries: ActivityLogEntry[]) => void
): () => void {
  const col = collection(db, ACTIVITY_LOG_COLLECTION);
  const q = query(
    col,
    orderBy('createdAt', 'desc'),
    limit(maxEntries)
  );
  const unsub = onSnapshot(q, (snapshot) => {
    const entries: ActivityLogEntry[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt as Timestamp | undefined;
      return {
        id: doc.id,
        state: (d.state as ActivityState) ?? 'WAITING',
        time: d.time ?? '--',
        timestamp: createdAt?.toMillis?.() ?? 0,
        confidence: d.confidence ?? undefined,
      };
    });
    onUpdate(entries);
  });
  return unsub;
}

export async function fetchActivityLog(
  db: Firestore,
  maxEntries: number
): Promise<ActivityLogEntry[]> {
  const col = collection(db, ACTIVITY_LOG_COLLECTION);
  const q = query(
    col,
    orderBy('createdAt', 'desc'),
    limit(maxEntries)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const d = doc.data();
    const createdAt = d.createdAt as Timestamp | undefined;
    return {
      id: doc.id,
      state: (d.state as ActivityState) ?? 'WAITING',
      time: d.time ?? '--',
      timestamp: createdAt?.toMillis?.() ?? 0,
      confidence: d.confidence ?? undefined,
    };
  });
}
