import { useEffect, useState, useMemo, useRef } from 'react';
import mqtt from 'mqtt';

// loading animation video
import loadingVideo from './assets/ezgif-2ecdceead6642438.webm';
import whiskIcon from './assets/Whisk_ef3f542bf74d368bb0341359db051933dr.webp';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Radio, User, UserX,
  BarChart3, Zap, ShieldCheck, TrendingUp
} from 'lucide-react';

/* ─── Constants ─── */
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC_DATA = 'esp32/rssi/data';
const MQTT_TOPIC_PREDICTION = 'esp32/rssi/prediction';

type Prediction = 'EMPTY' | 'IDLE' | 'MOVING' | 'WAITING';

interface DataPoint {
  time: string;
  rssi: number;
  timestamp: number;
}

interface MLFeatures {
  mean: string;
  std: string;
  min: string;
  max: string;
  range: string;
  spikeCount: number;
  spikeRate: string;
}

/* ─── Palette ─── */
const GREEN = '#16a34a';   // primary green-600
const GREEN_LIGHT = '#22c55e'; // green-500
const GREEN_BG = '#f0fdf4'; // green-50
const GREEN_RING = 'rgba(22,163,74,0.15)';

/* ─── Reusable Card ─── */
function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${className}`}
      style={{ borderColor: '#e2e8f0' }}
    >
      {children}
    </div>
  );
}

/* ─── Metric Mini-Card ─── */
function MetricCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit: string;
}) {
  return (
    <Card className="py-5 pr-5 hover:shadow-md transition-shadow duration-300">
      <div style={{ paddingLeft: '2rem' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg" style={{ background: GREEN_BG }}>
            {icon}
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-slate-800 tabular-nums">{value}</span>
          <span className="text-xs text-slate-400 font-medium">{unit}</span>
        </div>
      </div>
    </Card>
  );
}

/* ─── Main App ─── */
export default function App() {
  const [rssiHistory, setRssiHistory] = useState<DataPoint[]>([]);
  const [latestRssi, setLatestRssi] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<Prediction>('WAITING');
  const [confidence, setConfidence] = useState(0);
  const [connected, setConnected] = useState(false);
  const [mlFeatures, setMlFeatures] = useState<MLFeatures | null>(null);
  const [eventLog, setEventLog] = useState<{ state: string; time: string }[]>([]);
  const [predDistribution, setPredDistribution] = useState({ moving: 0, idle: 0, empty: 0, total: 0 });
  const [sessionStart] = useState(() => Date.now());
  const [sessionUptime, setSessionUptime] = useState('00:00');

  // show loading screen until dashboard is ready
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEnded, setVideoEnded] = useState(false);

  /* ── MQTT ── */
  useEffect(() => {
    const client = mqtt.connect(MQTT_BROKER, {
      protocol: 'wss',
      clientId: `web_${Math.random().toString(16).slice(3)}`,
      clean: true,
    });

    client.on('connect', () => {
      setConnected(true);
      client.subscribe(MQTT_TOPIC_DATA);
      client.subscribe(MQTT_TOPIC_PREDICTION);
    });

    client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());

        if (topic === MQTT_TOPIC_DATA) {
          // Raw RSSI data from ESP32 — feed chart
          const rssi = data.rssi ?? -100;
          const now = new Date();
          setLatestRssi(rssi);
          setRssiHistory(prev => {
            const next = [...prev, {
              time: now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              rssi,
              timestamp: now.getTime(),
            }];
            return next.length > 120 ? next.slice(-120) : next;
          });
        }

        if (topic === MQTT_TOPIC_PREDICTION) {
          // Real ML prediction from live_activity_predictor.py
          const pred = (data.prediction ?? 'WAITING').toUpperCase() as Prediction;
          setPrediction(pred);
          setConfidence(data.confidence ?? 0);

          if (data.features) {
            setMlFeatures({
              mean: String(data.features.mean_rssi ?? '--'),
              std: String(data.features.std_rssi ?? '--'),
              min: String(data.features.min_rssi ?? '--'),
              max: String(data.features.max_rssi ?? '--'),
              range: String(data.features.range_rssi ?? '--'),
              spikeCount: data.features.spike_count ?? 0,
              spikeRate: String(data.features.spike_rate ?? '--'),
            });
          }
        }
      } catch { /* ignore malformed */ }
    });

    client.on('error', console.error);
    client.on('close', () => setConnected(false));

    return () => { client.end(); };
  }, []);

  /* Features to display — from ML backend, or fallback client-side calc */
  const displayFeatures = useMemo(() => {
    if (mlFeatures) {
      return { mean: mlFeatures.mean, std: mlFeatures.std, range: mlFeatures.range };
    }
    // Fallback: basic client-side calculation when ML backend is not running
    if (rssiHistory.length < 3) return { mean: '--', std: '--', range: '--' };
    const win = rssiHistory.slice(-25).map(d => d.rssi);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const std = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    const range = Math.max(...win) - Math.min(...win);
    return { mean: mean.toFixed(1), std: std.toFixed(2), range: range.toFixed(1) };
  }, [rssiHistory, mlFeatures]);

  /* Uptime clock */
  useEffect(() => {
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - sessionStart) / 1000);
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = (secs % 60).toString().padStart(2, '0');
      setSessionUptime(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStart]);

  /*
   * The dashboard will remain hidden until the video plays to completion.
   * We track via a `videoEnded` flag and only clear `loading` when it is true.
   * If the video fails to load or play within a reasonable time we fall back
   * by removing the overlay after 5 seconds so the app doesn't hang forever.
   */
  useEffect(() => {
    if (videoEnded) {
      setLoading(false);
    }
  }, [videoEnded]);

  /*
   * Fallback timer: wait for the video's duration (once known) before forcing
   * removal of the loader. This handles the case where the `onEnded` event
   * never fires due to decode issues, while still giving the animation time to
   * complete. The timer is reset whenever the duration changes.
   */
  const [fallbackDelay, setFallbackDelay] = useState(5000);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handleMetadata = () => {
      const dur = vid.duration || 0;
      // add a small buffer in case there is any trailing blank
      setFallbackDelay((dur + 0.5) * 1000);
    };

    vid.addEventListener('loadedmetadata', handleMetadata);
    return () => {
      vid.removeEventListener('loadedmetadata', handleMetadata);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!videoEnded) {
        setLoading(false);
      }
    }, fallbackDelay);
    return () => clearTimeout(timer);
  }, [fallbackDelay, videoEnded]);

  /* Track prediction changes → event log + distribution */
  const prevPredRef = useRef<string>('');
  useEffect(() => {
    if (prediction === 'WAITING') return;
    if (prediction !== prevPredRef.current) {
      prevPredRef.current = prediction;
      const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setEventLog(prev => [...prev.slice(-19), { state: prediction, time }]);
      setPredDistribution(prev => ({
        moving: prev.moving + (prediction === 'MOVING' ? 1 : 0),
        idle: prev.idle + (prediction === 'IDLE' ? 1 : 0),
        empty: prev.empty + (prediction === 'EMPTY' ? 1 : 0),
        total: prev.total + 1,
      }));
    }
  }, [prediction]);

  /* Signal quality: map RSSI range -90...-30 → 0...100% */
  const signalQuality = useMemo(() => {
    if (latestRssi === null) return 0;
    return Math.max(0, Math.min(100, Math.round((latestRssi + 90) / 60 * 100)));
  }, [latestRssi]);

  /* ── State appearance ── */
  const stateMap: Record<Prediction, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    EMPTY: { color: '#64748b', bg: '#f1f5f9', icon: <UserX size={40} color="#64748b" />, label: 'Space Empty' },
    IDLE: { color: '#ca8a04', bg: '#fefce8', icon: <User size={40} color="#ca8a04" />, label: 'Occupied · Idle' },
    MOVING: { color: GREEN, bg: GREEN_BG, icon: <Activity size={40} color={GREEN} />, label: 'Occupied · Moving' },
    WAITING: { color: '#94a3b8', bg: '#f8fafc', icon: <Radio size={40} color="#94a3b8" className="animate-pulse" />, label: 'Awaiting signal…' },
  };
  const state = stateMap[prediction];

  const isAlert = prediction === 'MOVING';

  /* ─── Render ─── */
  return (
    <div className="min-h-screen flex flex-col items-center relative" style={{ background: '#f8faf9' }}>
      {/* loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
          <div className="w-[60vw] max-w-xs aspect-square rounded-full overflow-hidden shadow-lg">
            <video
              ref={videoRef}
              src={loadingVideo}
              autoPlay
              muted
              onEnded={() => setVideoEnded(true)}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Red ambient alert border when MOVING */}
      <AnimatePresence>
        {isAlert && (
          <motion.div
            key="alert-border"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none fixed inset-0 z-50"
            style={{
              boxShadow: 'inset 0 0 80px rgba(239,68,68,0.35), inset 0 0 200px rgba(239,68,68,0.15)',
              border: '2px solid rgba(239,68,68,0.4)',
              borderRadius: '0',
              animation: 'alert-pulse 2s ease-in-out infinite',
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[1400px] mx-auto px-6 pb-2 flex items-center justify-between"
        style={{ paddingTop: '2.5rem' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden" style={{ background: GREEN_BG, border: `1px solid ${GREEN_RING}` }}>
            <img
              src={whiskIcon}
              alt="icon"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none" style={{ color: '#0f172a' }}>
              <span style={{ color: '#FFD700' }}>Minnal</span>{' '}
              <span className="text-slate-800">Sense</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mt-0.5 flex items-center gap-1" style={{ color: '#94a3b8' }}>
              <ShieldCheck size={10} color={GREEN} /> Device-free Wi-Fi sensing
            </p>
          </div>
        </div>

        {/* Connection badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: 500, background: '#fff', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
          <span style={{ position: 'relative', display: 'flex', height: '10px', width: '10px' }}>
            {connected && <span className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '9999px', background: GREEN_LIGHT, opacity: 0.75 }} />}
            <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '9999px', height: '10px', width: '10px', background: connected ? GREEN_LIGHT : '#ef4444' }} />
          </span>
          <span style={{ color: '#475569' }}>{connected ? 'Live' : 'Offline'}</span>
        </div>
      </motion.header>

      {/* ── Main Grid ── */}
      <main className="w-full max-w-[1400px] mx-auto px-6 pb-6 grid gap-5 grid-cols-1 lg:grid-cols-12 auto-rows-min items-start" style={{ marginTop: '2.5rem' }}>

        {/* ── LEFT ── */}
        <div className="lg:col-span-4 flex flex-col gap-5">

          {/* State Card */}
          <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.05 }}>
            <Card className="p-8 flex flex-col items-center text-center min-h-[280px] justify-center relative overflow-hidden">
              {/* subtle glow behind icon */}
              <div className="absolute w-40 h-40 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ background: state.bg }} />

              <AnimatePresence mode="wait">
                <motion.div
                  key={prediction}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="mb-5 relative z-10"
                >
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: state.bg, border: `1px solid ${state.color}20` }}
                  >
                    {state.icon}
                  </div>
                </motion.div>
              </AnimatePresence>

              <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-slate-400 mb-1 relative z-10">
                Current State
              </p>
              <h2 className="text-2xl font-bold relative z-10" style={{ color: state.color }}>
                {state.label}
              </h2>

              {confidence > 0 && prediction !== 'WAITING' && (
                <div className="w-full mt-6 px-2 relative z-10">
                  <div className="flex justify-between text-[10px] font-semibold mb-1.5">
                    <span className="text-slate-400">Confidence</span>
                    <span className="text-slate-600">{confidence}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${confidence}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full rounded-full"
                      style={{ background: state.color }}
                    />
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Metrics 2×2 */}
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="grid grid-cols-2 gap-3 w-full"
          >
            <MetricCard
              icon={<BarChart3 size={14} color={GREEN} />}
              label="Mean RSSI"
              value={displayFeatures.mean}
              unit="dBm"
            />
            <MetricCard
              icon={<Activity size={14} color={GREEN} />}
              label="Std Dev"
              value={displayFeatures.std}
              unit="σ"
            />
            <MetricCard
              icon={<Zap size={14} color={GREEN} />}
              label="Range"
              value={displayFeatures.range}
              unit="dB"
            />
            <MetricCard
              icon={<TrendingUp size={14} color={GREEN} />}
              label="Live RSSI"
              value={latestRssi ?? '--'}
              unit="dBm"
            />
          </motion.div>
        </div>

        {/* ── RIGHT — Chart ── */}
        <motion.div
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-8"
        >
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col" style={{ padding: '2rem', borderColor: '#e2e8f0' }}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-base font-semibold text-slate-800 mb-0.5">RSSI Signal Timeline</h3>
                <p className="text-xs text-slate-400">Real-time sliding-window visualization</p>
              </div>
              <span className="text-[10px] font-semibold text-slate-400 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-100">
                {rssiHistory.length} samples
              </span>
            </div>

            <div style={{ width: '100%', height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rssiHistory} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GREEN} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickMargin={8}
                    minTickGap={40}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickCount={6}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                      padding: '10px 14px',
                    }}
                    labelStyle={{ color: '#64748b', fontSize: '11px', marginBottom: 4 }}
                    itemStyle={{ color: GREEN, fontWeight: 600, fontSize: '13px' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rssi"
                    stroke={GREEN}
                    strokeWidth={2}
                    fill="url(#grad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>
      </main>

      {/* ── Bottom Row ── */}
      <motion.section
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="w-full max-w-[1400px] mx-auto px-6 pb-8 grid grid-cols-1 lg:grid-cols-3 gap-6"
        style={{ marginTop: '2.5rem' }}
      >
        {/* Detection Event Log */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ padding: '2rem', borderColor: '#e2e8f0' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-0.5">Detection Log</h4>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Recent activity events</p>
            </div>
            <div className="p-1.5 rounded-lg" style={{ background: GREEN_BG }}>
              <Activity size={14} color={GREEN} />
            </div>
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {eventLog.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Awaiting events…</p>
            ) : (
              [...eventLog].reverse().map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                      background: entry.state === 'MOVING' ? '#ef4444' : entry.state === 'IDLE' ? '#ca8a04' : '#64748b'
                    }} />
                    <span className="text-xs font-medium text-slate-700">{entry.state}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 tabular-nums">{entry.time}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Signal Quality Meter */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ padding: '2rem', borderColor: '#e2e8f0' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-0.5">Signal Quality</h4>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Real-time RSSI strength</p>
            </div>
            <div className="p-1.5 rounded-lg" style={{ background: GREEN_BG }}>
              <Radio size={14} color={GREEN} />
            </div>
          </div>
          <div className="flex flex-col items-center">
            {/* Semicircular gauge */}
            <div className="relative w-40 h-20 mb-3">
              <svg viewBox="0 0 120 65" className="w-full h-full">
                <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#f1f5f9" strokeWidth="10" strokeLinecap="round" />
                <path
                  d="M 10 60 A 50 50 0 0 1 110 60"
                  fill="none"
                  stroke={signalQuality > 66 ? GREEN : signalQuality > 33 ? '#ca8a04' : '#ef4444'}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${signalQuality * 1.57} 200`}
                />
                <text x="60" y="58" textAnchor="middle" fontSize="16" fontWeight="700" fill="#1e293b">{signalQuality}%</text>
              </svg>
            </div>
            <div className="flex justify-between w-full text-[10px] text-slate-400 px-4 mb-4">
              <span>Poor</span><span>Fair</span><span>Good</span>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              <div className="rounded-xl py-2.5 text-center" style={{ background: '#f8fafc' }}>
                <div className="text-lg font-bold text-slate-800">{latestRssi ?? '--'}</div>
                <div className="text-[10px] text-slate-400">dBm live</div>
              </div>
              <div className="rounded-xl py-2.5 text-center" style={{ background: '#f8fafc' }}>
                <div className="text-lg font-bold text-slate-800">{displayFeatures.std}</div>
                <div className="text-[10px] text-slate-400">σ noise</div>
              </div>
            </div>
          </div>
        </div>

        {/* Session Stats */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ padding: '2rem', borderColor: '#e2e8f0' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-0.5">Session Stats</h4>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Since dashboard load</p>
            </div>
            <div className="p-1.5 rounded-lg" style={{ background: GREEN_BG }}>
              <BarChart3 size={14} color={GREEN} />
            </div>
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Uptime', value: sessionUptime },
              { label: 'Total Samples', value: rssiHistory.length.toString() },
              { label: 'Peak RSSI', value: rssiHistory.length ? `${Math.max(...rssiHistory.map(d => d.rssi))} dBm` : '--' },
              { label: 'Min RSSI', value: rssiHistory.length ? `${Math.min(...rssiHistory.map(d => d.rssi))} dBm` : '--' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-xs font-semibold text-slate-800 tabular-nums">{value}</span>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Prediction breakdown</p>
              {predDistribution.total > 0 ? (
                <>
                  <div className="flex rounded-full overflow-hidden h-3 w-full">
                    {predDistribution.moving > 0 && <div style={{ width: `${predDistribution.moving / predDistribution.total * 100}%`, background: '#ef4444' }} />}
                    {predDistribution.idle > 0 && <div style={{ width: `${predDistribution.idle / predDistribution.total * 100}%`, background: '#ca8a04' }} />}
                    {predDistribution.empty > 0 && <div style={{ width: `${predDistribution.empty / predDistribution.total * 100}%`, background: '#94a3b8' }} />}
                  </div>
                  <div className="flex justify-between mt-1.5 text-[9px] text-slate-400">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Moving {Math.round(predDistribution.moving / predDistribution.total * 100)}%</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-600 inline-block" />Idle {Math.round(predDistribution.idle / predDistribution.total * 100)}%</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />Empty {Math.round(predDistribution.empty / predDistribution.total * 100)}%</span>
                  </div>
                </>
              ) : (
                <div className="h-3 w-full rounded-full bg-slate-100" />
              )}
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
