import { useEffect, useState } from 'react';
import mqtt from 'mqtt';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC = 'esp32/rssi/data';

type Prediction = 'EMPTY' | 'IDLE' | 'MOVING' | 'WAITING';

interface DataPoint {
  time: string;
  rssi: number;
  prediction?: Prediction;
}

function App() {
  const [client, setClient] = useState<mqtt.MqttClient | null>(null);
  const [rssiHistory, setRssiHistory] = useState<DataPoint[]>([]);
  const [latestRssi, setLatestRssi] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<Prediction>('WAITING');
  const [confidence, setConfidence] = useState<number>(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const mqttClient = mqtt.connect(MQTT_BROKER, {
      protocol: 'wss',
      clientId: `web_${Math.random().toString(16).slice(3)}`,
      clean: true,
    });

    mqttClient.on('connect', () => {
      setConnected(true);
      mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (!err) console.log('Subscribed to', MQTT_TOPIC);
      });
    });

    mqttClient.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        const rssi = data.rssi ?? -100;
        const now = new Date().toLocaleTimeString();

        setLatestRssi(rssi);
        setRssiHistory(prev => [
          ...prev.slice(-299),
          { time: now, rssi }
        ]);

        const mockPred = rssi > -60 ? 'MOVING' : rssi > -70 ? 'IDLE' : 'EMPTY';
        setPrediction(mockPred);
        setConfidence(Math.floor(Math.random() * 30) + 70);

      } catch (e) {
        console.error('Invalid message:', e);
      }
    });

    mqttClient.on('error', (err) => console.error('MQTT error:', err));

    setClient(mqttClient);

    return () => {
      mqttClient.end();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl">
          {/* Header */}
          <header className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-semibold text-gray-800 mb-2">
              Activity Monitor
            </h1>
            <p className="text-gray-600 text-base">
              Real-time Wi-Fi signal analysis & presence detection
            </p>
            <div className="mt-4">
              <span className={`inline-block px-3 py-1 text-xs rounded-full ${
                connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>{connected ? 'Live' : 'Offline'}</span>
            </div>
          </header>

          {/* Main Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Signal Strength Card */}
<div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition text-center">
              <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Signal Strength</p>
              <div className="text-3xl font-semibold text-gray-800">
                {latestRssi !== null ? latestRssi : '—'}
              </div>
              <p className="text-gray-400 text-xs mt-1">dBm</p>
            </div>

            {/* Activity Status Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition text-center">
              <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Activity Status</p>
              <div className="text-3xl font-semibold text-gray-800">
                {prediction}
              </div>
              {confidence > 0 && (
                <div className="mt-4">
                  <p className="text-gray-500 text-xs">Confidence: {Math.round(confidence)}%</p>
                  <div className="w-full h-1 bg-gray-200 rounded-full mt-1">
                    <div 
                      className="h-full bg-gray-800 rounded-full transition-all"
                      style={{ width: `${confidence}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>

            {/* Data Points Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition text-center">
              <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Data Points</p>
              <div className="text-3xl font-semibold text-gray-800">
                {rssiHistory.length}
              </div>
              <p className="text-gray-500 text-xs mt-1">samples</p>
            </div>
          </div>

          {/* Chart Section */}
          <div className="group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-cyan-600/10 rounded-xl blur opacity-30 group-hover:opacity-50 transition duration-500"></div>
            <div className="relative bg-gray-900/60 border border-gray-700/50 rounded-xl p-8 backdrop-blur-xl hover:border-gray-600/80 transition-all">
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <h2 className="text-2xl font-bold text-white">Signal Timeline</h2>
                </div>
                <p className="text-gray-400 text-sm">5-minute rolling window of RSSI measurements</p>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rssiHistory}>
                    <defs>
                      <linearGradient id="colorRssi" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                    <XAxis dataKey="time" stroke="rgba(255, 255, 255, 0.2)" style={{ fontSize: '11px' }} />
                    <YAxis stroke="rgba(255, 255, 255, 0.2)" style={{ fontSize: '11px' }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(17, 24, 39, 0.95)', 
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '8px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                      }}
                      labelStyle={{ color: '#e0f2fe', fontSize: '12px' }}
                      itemStyle={{ color: '#60a5fa', fontWeight: 'bold' }}
                    />
                    <Line 
                      type="natural"
                      dataKey="rssi" 
                      stroke="#3b82f6" 
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 6, fill: '#0891b2' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-12">
            <p className="text-gray-500 text-xs">
              Last updated: {new Date().toLocaleTimeString()} • ESP32 • MQTT • Machine Learning
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
