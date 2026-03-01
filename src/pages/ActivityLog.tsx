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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAGE_BG }}>

      {/* ── Page header ── */}
      <header
        className="w-full pb-6 flex items-center justify-between"
        style={{ paddingTop: 80, paddingLeft: 24, paddingRight: 24, maxWidth: 768, margin: '0 auto' }}
      >
        {/* Left: back button */}
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-80 shrink-0"
          style={{ color: ACCENT_LIGHT }}
        >
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">Back to dashboard</span>
        </Link>
        {/* Centre: title */}
        <h1 className="text-lg sm:text-2xl font-bold text-center flex-1" style={{ color: TEXT_LIGHT }}>
          Movement log
        </h1>
        {/* Right: spacer matching back button */}
        <span className="shrink-0" style={{ width: 18 }} aria-hidden />
      </header>

      <main
        className="w-full pb-10 flex-1 flex flex-col gap-4"
        style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 32, maxWidth: 768, margin: '0 auto' }}
      >

        {/* ── Empty state ── */}
        {entries.length === 0 && (
          <div
            className="rounded-2xl border flex flex-col items-center justify-center py-20 text-center"
            style={{ borderColor: CARD_BORDER, background: CARD_BG }}
          >
            <p className="text-sm" style={{ color: TEXT_MUTED }}>No movement events yet.</p>
            <p className="text-sm mt-1" style={{ color: TEXT_MUTED }}>
              Events appear when the dashboard detects movement.
            </p>
          </div>
        )}

        {entries.length > 0 && (
          <>
            {/* ── Mobile: card list (hidden on sm+) ── */}
            <div className="flex flex-col gap-3 sm:hidden">
              {entries.map((entry, index) => (
                <div
                  key={entry.id}
                  className="rounded-xl border py-4"
                  style={{ borderColor: CARD_BORDER, background: CARD_BG, paddingLeft: 10, paddingRight: 10 }}
                >
                  {/* Row 1: index + status badge */}
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs tabular-nums font-semibold" style={{ color: TEXT_MUTED }}>
                      #{index + 1}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                      style={{ color: MOVING_COLOR, background: `${MOVING_COLOR}20` }}
                    >
                      <Activity size={13} />
                      Moving
                    </span>
                  </div>
                  {/* Row 2: time + confidence */}
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: TEXT_MUTED }}>
                        Time
                      </p>
                      <p className="text-sm tabular-nums font-medium" style={{ color: TEXT_LIGHT }}>
                        {entry.time}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: TEXT_MUTED }}>
                        Recorded
                      </p>
                      <p className="text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                        {formatDate(entry.timestamp)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: TEXT_MUTED }}>
                        Confidence
                      </p>
                      <p className="text-sm tabular-nums font-semibold" style={{ color: TEXT_LIGHT }}>
                        {entry.confidence != null ? `${entry.confidence}%` : '--'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop: table (hidden on mobile) ── */}
            <div
              className="hidden sm:block rounded-2xl border overflow-hidden"
              style={{ borderColor: CARD_BORDER, background: CARD_BG }}
            >
              <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
                <table className="w-full text-left border-collapse" style={{ minWidth: '560px' }}>
                  <thead className="sticky top-0 z-10" style={{ background: TABLE_HEADER_BG }}>
                    <tr style={{ borderBottom: `2px solid ${CARD_BORDER}` }}>
                      {['#', 'Status', 'Time (local)', 'Recorded at', 'Confidence'].map((col, i) => (
                        <th
                          key={col}
                          className="py-4 px-5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                          style={{ color: TEXT_MUTED, paddingLeft: i === 0 ? 32 : undefined }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, index) => (
                      <tr
                        key={entry.id}
                        className="hover:opacity-90 transition-opacity"
                        style={{ borderBottom: `1px solid ${CARD_BORDER}` }}
                      >
                        <td className="py-4 px-5 text-sm tabular-nums whitespace-nowrap" style={{ color: TEXT_MUTED, paddingLeft: 32 }}>
                          {index + 1}
                        </td>
                        <td className="py-4 px-5 align-middle">
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
              </div>
            </div>
          </>
        )}

        {/* ── Footer action strip ── */}
        <div
          className="rounded-2xl border flex items-center justify-between gap-3 py-5"
          style={{ borderColor: CARD_BORDER, background: CARD_BG, paddingLeft: 40, paddingRight: 24 }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: TEXT_LIGHT }}>
              Movement events
            </p>
            <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
              Newest first · Logged when the dashboard detects movement
            </p>
          </div>
          <button
            type="button"
            onClick={() => exportToCsv(entries)}
            disabled={entries.length === 0}
            title="Export CSV"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 flex-shrink-0"
            style={{ color: '#fff', background: '#16a34a', border: '1px solid #15803d', minWidth: 80 }}
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>

      </main>
    </div>
  );
}
