import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Activity, Download } from 'lucide-react';
import { firestore } from '../lib/firebase';
import { subscribeActivityLog, type ActivityLogEntry } from '../lib/activityLog';

const PAGE_BG = '#0b0f19';
const CARD_BG = '#111827';
const CARD_BORDER = '#1e293b';
const TABLE_HEADER_BG = '#1a2332';
const TEXT_LIGHT = '#e2e8f0';
const TEXT_MUTED = '#94a3b8';
const ACCENT_LIGHT = '#7dd3fc';
const MOVING_COLOR = '#ef4444';

function formatDate(ts: number): string {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  });
}

function exportToCsv(entries: ActivityLogEntry[]): void {
  const headers = ['#', 'Status', 'Time (local)', 'Recorded at', 'Confidence'];
  const rows = entries.map((e, i) => [
    i + 1,
    'Moving',
    e.time,
    formatDate(e.timestamp),
    e.confidence != null ? `${e.confidence}%` : '--',
  ]);
  const escape = (val: string | number) =>
    String(val).includes(',') || String(val).includes('"') || String(val).includes('\n')
      ? `"${String(val).replace(/"/g, '""')}"`
      : String(val);
  const csv = [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movement-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore) {
      setError('Firebase is not configured. Add env vars (see .env.example).');
      setLoading(false);
      return;
    }
    setLoading(false);
    const unsub = subscribeActivityLog(firestore, 200, (list) => {
      setEntries(list.filter((e) => e.state === 'MOVING'));
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAGE_BG }}>
        <p style={{ color: TEXT_MUTED }}>Loading activity log…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6" style={{ background: PAGE_BG }}>
        <p className="text-center" style={{ color: TEXT_MUTED }}>{error}</p>
        <Link to="/" className="text-sm font-medium" style={{ color: ACCENT_LIGHT }}>Back to dashboard</Link>
      </div>
    );
  }

  const containerPadding = { paddingLeft: 32, paddingRight: 24 };
  const tableCellPaddingLeft = 32;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAGE_BG }}>
      <header
        className="w-full max-w-5xl mx-auto py-6 flex items-center justify-between gap-4"
        style={{ ...containerPadding, paddingLeft: 40, paddingTop: 56 }}
      >
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-90 shrink-0"
          style={{ color: ACCENT_LIGHT }}
        >
          <ArrowLeft size={20} /> Back to dashboard
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold truncate" style={{ color: TEXT_LIGHT }}>
          Movement log
        </h1>
        <span className="w-[140px] shrink-0" aria-hidden />
      </header>

      <main className="w-full max-w-5xl mx-auto pb-12 flex-1 min-w-0" style={{ ...containerPadding, paddingLeft: 40, paddingTop: 48 }}>
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: CARD_BORDER, background: CARD_BG, marginTop: 40 }}
        >
          <div
            className="py-5 border-b flex flex-wrap items-start justify-between gap-3"
            style={{ borderColor: CARD_BORDER, paddingLeft: 40, paddingRight: 24 }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: TEXT_LIGHT }}>
                Movement events
              </p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                Newest first. Logged when the dashboard detects movement.
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportToCsv(entries)}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
              style={{ color: '#fff', background: '#16a34a', border: '1px solid #15803d' }}
            >
              <Download size={18} />
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] min-h-[200px]">
            {entries.length === 0 ? (
              <div className="py-16 text-center" style={{ color: TEXT_MUTED, paddingLeft: 40, paddingRight: 24 }}>
                <p className="text-sm">No movement events yet.</p>
                <p className="text-sm mt-1">Events appear when the dashboard detects movement.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse" style={{ minWidth: '640px' }}>
                <thead className="sticky top-0 z-10" style={{ background: TABLE_HEADER_BG }}>
                  <tr style={{ borderBottom: `2px solid ${CARD_BORDER}` }}>
                    <th className="py-4 pr-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT_MUTED, paddingLeft: tableCellPaddingLeft }}>
                      #
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                      Status
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                      Time (local)
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                      Recorded at
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                      Confidence
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr
                      key={entry.id}
                      className="hover:opacity-90 transition-opacity"
                      style={{ borderBottom: `1px solid ${CARD_BORDER}` }}
                    >
                      <td className="py-4 pr-5 text-sm tabular-nums whitespace-nowrap" style={{ color: TEXT_MUTED, paddingLeft: tableCellPaddingLeft }}>
                        {index + 1}
                      </td>
                      <td className="py-4 pr-5 align-middle">
                        <span
                          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap"
                          style={{ color: MOVING_COLOR, background: `${MOVING_COLOR}20` }}
                        >
                          <Activity size={16} />
                          Moving
                        </span>
                      </td>
                      <td className="py-4 px-5 text-sm tabular-nums whitespace-nowrap" style={{ color: TEXT_LIGHT }}>
                        {entry.time}
                      </td>
                      <td className="py-4 px-5 text-sm tabular-nums whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                        {formatDate(entry.timestamp)}
                      </td>
                      <td className="py-4 px-5 text-sm tabular-nums whitespace-nowrap" style={{ color: TEXT_LIGHT }}>
                        {entry.confidence != null ? `${entry.confidence}%` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
