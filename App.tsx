
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Map as MapLibreMap, NavigationControl, AttributionControl, Marker, Popup, LngLatBounds } from 'maplibre-gl';
import { db } from './firebase';
import { Company, Order, Tour, PickupTask, BoxStatus, Area, Driver } from './types';
import { calculateTours, getMissingBoxTasks } from './services/routing';
import { DRIVERS } from './constants';

const DRIVER_COLORS: Record<string, { bg: string, border: string, hex: string }> = {
  'samir': { bg: 'bg-amber-500', border: 'border-amber-500', hex: '#f59e0b' },
  'ali2': { bg: 'bg-emerald-500', border: 'border-emerald-500', hex: '#10b981' },
  'josef': { bg: 'bg-indigo-500', border: 'border-indigo-500', hex: '#6366f1' },
  'ali1': { bg: 'bg-pink-500', border: 'border-pink-500', hex: '#ec4899' },
  'ankush': { bg: 'bg-blue-500', border: 'border-blue-500', hex: '#3b82f6' },
  'harsh': { bg: 'bg-violet-500', border: 'border-violet-500', hex: '#8b5cf6' },
  'default': { bg: 'bg-slate-500', border: 'border-slate-500', hex: '#64748b' }
};

const OpenMap = ({ tours, onGeocodeUpdate }: { tours: Tour[], onGeocodeUpdate: (id: string, lat: number, lng: number) => void }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const processingRef = useRef(new Set<string>());

  // Initialize MapLibre
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new MapLibreMap({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/bright', // Using OpenFreeMap Bright style
      center: [13.405, 52.52], // Berlin
      zoom: 11,
      attributionControl: false
    });

    map.current.addControl(new NavigationControl(), 'top-right');
    map.current.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Geocoding Queue (Nominatim)
  useEffect(() => {
    if (tours.length === 0) return;

    const queue = tours.flatMap(t => t.orders.filter(o => !o.lat && !processingRef.current.has(o.orderId)));
    if (queue.length === 0) return;

    const processQueue = async () => {
      const order = queue[0];
      if (!order) return;

      processingRef.current.add(order.orderId);
      const query = `${order.address}, ${order.postCode} Berlin, Germany`;

      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
          headers: { 'User-Agent': 'BellaBona-IntelliRoute/1.0' }
        });
        const data = await response.json();
        if (data && data.length > 0) {
          onGeocodeUpdate(order.orderId, parseFloat(data[0].lat), parseFloat(data[0].lon));
        }
      } catch (e) {
        console.warn('Geocoding failed for', query);
      }

      // Throttle for Nominatim (Max 1 req/sec)
      setTimeout(() => processQueue(), 1200);
    };

    processQueue();
  }, [tours]);

  // Render Markers and Lines
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // 1. Prepare Data for Lines
    const geojsonFeatures: any[] = [];
    const bounds = new LngLatBounds();
    let hasPoints = false;

    tours.forEach(tour => {
      const color = DRIVER_COLORS[tour.driverId] || DRIVER_COLORS['default'];
      const coordinates: [number, number][] = [];

      tour.orders.forEach((order, idx) => {
        if (order.lat && order.lng) {
          const lngLat: [number, number] = [order.lng, order.lat];
          coordinates.push(lngLat);
          bounds.extend(lngLat);
          hasPoints = true;

          // Create Custom DOM Marker
          const el = document.createElement('div');
          el.className = 'custom-marker';
          el.innerHTML = `
            <div style="background-color: ${color.hex}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #1e293b; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
              <span style="color: white; font-size: 10px; font-weight: 900; font-family: 'Inter', sans-serif;">${idx + 1}</span>
            </div>
            <div style="width: 2px; height: 8px; background-color: ${color.hex}; margin: 0 auto;"></div>
          `;

          const marker = new Marker({ element: el, anchor: 'bottom' })
            .setLngLat(lngLat)
            .setPopup(new Popup({ offset: 25 }).setText(`${idx + 1}. ${order.name}`))
            .addTo(m);

          markersRef.current.push(marker);
        }
      });

      if (coordinates.length > 1) {
        geojsonFeatures.push({
          type: 'Feature',
          properties: { color: color.hex },
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        });
      }
    });

    // 2. Add/Update Lines Layer
    const sourceId = 'routes-source';
    if (m.getSource(sourceId)) {
      (m.getSource(sourceId) as any).setData({
        type: 'FeatureCollection',
        features: geojsonFeatures
      });
    } else {
      // Wait for style load if adding for first time (usually map load handles this, but for updates safety)
      if (m.isStyleLoaded()) {
        addRouteLayers(m, geojsonFeatures, sourceId);
      } else {
        m.on('load', () => addRouteLayers(m, geojsonFeatures, sourceId));
      }
    }

    // 3. Fit Bounds
    if (hasPoints) {
      m.fitBounds(bounds, { padding: 50, maxZoom: 15 });
    }

  }, [tours]);

  const addRouteLayers = (m: MapLibreMap, features: any[], sourceId: string) => {
    if (m.getSource(sourceId)) return;
    m.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: features }
    });
    m.addLayer({
      id: 'routes-layer',
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.8
      }
    });
  };

  return <div ref={mapContainer} className="w-full h-full map-dark-mode" />;
};

const getWeekInfo = (dateString: string) => {
  const date = new Date(dateString);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setUTCDate(diff));
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const weekNo = Math.ceil((((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7);
  return {
    id: `${monday.getUTCFullYear()}-W${weekNo}`,
    range: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    isBusinessDay: day >= 1 && day <= 5
  };
};

const CalendarStrip: React.FC<{ selected: string; onChange: (d: string) => void }> = ({ selected, onChange }) => {
  const dates = useMemo(() => {
    const arr = [];
    const today = new Date();
    for (let i = -7; i < 14; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      arr.push(d.toISOString().split('T')[0]);
    }
    return arr;
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
      {dates.map(date => {
        const d = new Date(date);
        const isSelected = selected === date;
        const isToday = new Date().toISOString().split('T')[0] === date;
        return (
          <button
            key={date}
            onClick={() => onChange(date)}
            className={`flex flex-col items-center min-w-[70px] p-4 rounded-2xl border transition-all duration-300 relative ${isSelected
              ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl scale-105 z-10'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'
              }`}
          >
            <span className={`text-[10px] font-black uppercase mb-1 ${isSelected ? 'opacity-80' : 'opacity-50'}`}>
              {d.toLocaleDateString('en-US', { weekday: 'short' })}
            </span>
            <span className="text-xl font-black">{d.getDate()}</span>
            {isToday && !isSelected && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2"></div>}
          </button>
        );
      })}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [fleet, setFleet] = useState<Driver[]>(DRIVERS);
  const [tours, setTours] = useState<Tour[]>([]);
  const [unassigned, setUnassigned] = useState<Order[]>([]);
  const [pickupTasks, setPickupTasks] = useState<PickupTask[]>([]);
  const [jsonInput, setJsonInput] = useState('');
  const [masterInput, setMasterInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const weekInfo = getWeekInfo(selectedDate);

  useEffect(() => {
    const unsubComp = onSnapshot(collection(db, 'companies'), (snap) => {
      setCompanies(snap.docs
        .map(d => ({ ...d.data(), companyId: d.id } as Company))
        .filter(c => (c.postCode || '').startsWith('1'))
      );
    });
    const unsubPickups = onSnapshot(collection(db, 'pickups'), (snap) => {
      setPickupTasks(snap.docs.map(d => d.data() as PickupTask));
    });
    const unsubFleet = onSnapshot(collection(db, 'fleet'), (snap) => {
      if (!snap.empty) {
        const remote = snap.docs.reduce((acc, d) => ({ ...acc, [d.id]: d.data().isActive }), {} as any);
        setFleet(prev => prev.map(d => ({ ...d, isActive: remote[d.id] ?? d.isActive })));
      }
    });
    return () => { unsubComp(); unsubPickups(); unsubFleet(); };
  }, [weekInfo.id]);

  const handleCalculate = async () => {
    if (!jsonInput.trim()) return;
    setIsBusy(true);
    setStatusMsg("CALCULATING FEASIBLE NEIGHBORHOOD TOURS...");
    try {
      const orders = JSON.parse(jsonInput);
      const activeDrivers = fleet.filter(d => d.isActive);
      const initialResult = calculateTours(orders, companies, activeDrivers);

      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_API_KEY || '');

      let optimized = initialResult.tours;
      try {
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash'
        });

        const prompt = `TASK: Validate and refine delivery sequences.
              CONTEXT: Drivers leave Potsdam at 10:00 AM. They MUST finish by 12:30 PM.
              CRITICAL: Verify if Adecco, Lovehoney, Mektek, and Getraenke are geographically clusterable. 
              If they are in different areas (e.g. one in Mitte, one in Schöneberg), they MUST be split if the travel time exceeds 2.5 hours total.
              HIERARCHY: Same Sector > Same PLZ > Same Street. 
              Input Data: ${JSON.stringify(initialResult.tours.map(t => ({ d: t.driverName, s: t.orders.map(o => ({ n: o.name, a: o.address, p: o.postCode, ar: o.area })) })))}
              Output ONLY JSON: [{"d": "DriverName", "s": [{"n": "CompanyName"}]}]`;

        const res = await model.generateContent(prompt);
        const responseText = res.response.text();
        const parsed = JSON.parse(responseText || '[]');
        if (parsed.length > 0) {
          optimized = initialResult.tours.map(t => {
            const match = parsed.find((p: any) => p.d === t.driverName);
            if (match && match.s) {
              const reordered = match.s.map((ms: any) => t.orders.find(to => to.name === ms.n)).filter(Boolean);
              const missing = t.orders.filter(orig => !reordered.find(r => r.orderId === orig.orderId));
              return { ...t, orders: [...reordered, ...missing] };
            }
            return t;
          });
        }
      } catch (err) {
        console.warn("AI Optimization Fallback", err);
      }

      setTours(optimized);
      setUnassigned(initialResult.unassigned);

      const batch = writeBatch(db);
      const currentOrderIds = new Set(optimized.flatMap(t => t.orders.map(o => o.companyId)));

      currentOrderIds.forEach(id => {
        batch.set(doc(db, 'companies', id), { boxStatus: BoxStatus.PENDING }, { merge: true });
        batch.delete(doc(db, 'pickups', id));
      });

      const recoveryTasks = getMissingBoxTasks(optimized.flatMap(t => t.orders), companies);
      const oldPickups = await getDocs(collection(db, 'pickups'));
      oldPickups.docs.forEach(d => batch.delete(d.ref));
      recoveryTasks.forEach(task => batch.set(doc(db, 'pickups', task.companyId), task));

      await batch.commit();
      setJsonInput('');
    } catch (e) {
      alert("Invalid JSON format");
    } finally {
      setIsBusy(false);
      setStatusMsg("");
    }
  };

  const handleGeocodeUpdate = (orderId: string, lat: number, lng: number) => {
    setTours(prev => prev.map(t => ({
      ...t,
      orders: t.orders.map(o => o.orderId === orderId ? { ...o, lat, lng } : o)
    })));
  };

  const toggleCompanyStatus = async (company: Company) => {
    const newStatus = company.boxStatus === BoxStatus.PENDING ? BoxStatus.COLLECTED : BoxStatus.PENDING;
    setIsBusy(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'companies', company.companyId), { boxStatus: newStatus }, { merge: true });
      if (newStatus === BoxStatus.COLLECTED) batch.delete(doc(db, 'pickups', company.companyId));
      else {
        batch.set(doc(db, 'pickups', company.companyId), {
          companyId: company.companyId,
          companyName: company.name,
          address: company.address,
          postCode: company.postCode || '',
          area: company.area,
          status: 'Pending'
        });
      }
      await batch.commit();
    } catch (e) { console.error(e); } finally { setIsBusy(false); }
  };

  const handleSyncMasterData = async () => {
    if (!masterInput.trim()) return;
    setIsBusy(true);
    try {
      const data = JSON.parse(masterInput);
      const entries = Array.isArray(data) ? data : [data];
      const batch = writeBatch(db);
      let count = 0;
      entries.forEach((item: any) => {
        const pCode = String(item.postCode || '');
        if (!pCode.startsWith('1')) return;

        const id = item.companyId || item.id || Math.random().toString(36).substr(2, 9);
        batch.set(doc(db, 'companies', id), {
          companyId: id,
          name: item.name || 'Unknown',
          address: item.address || '',
          postCode: pCode,
          area: item.area || Area.OTHER,
          fixedDeliveryTime: item.fixedDeliveryTime || "11:30",
          boxStatus: item.boxStatus || BoxStatus.COLLECTED,
          lat: item.lat,
          lng: item.lng
        }, { merge: true });
        count++;
      });
      await batch.commit();
      setMasterInput('');
      alert(`Sync Complete: ${count} entries.`);
    } catch (e) { alert("Invalid Registry JSON"); } finally { setIsBusy(false); }
  };

  const handlePurgeInvalidCompanies = async () => {
    if (!confirm("Clear Non-Berlin?")) return;
    setIsBusy(true);
    try {
      const snap = await getDocs(collection(db, 'companies'));
      const batch = writeBatch(db);
      snap.docs.forEach(d => {
        if (!String(d.data().postCode || '').startsWith('1')) batch.delete(d.ref);
      });
      await batch.commit();
    } catch (e) { console.error(e); } finally { setIsBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-inter">
      <header className="bg-slate-900 border-b border-white/5 h-16 flex items-center px-8 sticky top-0 z-50 shadow-2xl">
        <h1 className="text-lg font-black uppercase tracking-tighter flex-1">BellaBona <span className="text-indigo-500">IntelliRoute</span></h1>
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('dashboard')} className={`text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-white'}`}>Logistics Hub</button>
          <button onClick={() => setActiveTab('settings')} className={`text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-white'}`}>Registry</button>
        </div>
      </header>

      <main className="flex-1 p-8 max-w-[1750px] mx-auto w-full">
        {statusMsg && <div className="fixed bottom-12 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-10 py-5 rounded-full font-black text-xs uppercase shadow-2xl animate-pulse z-[100] border-2 border-indigo-400/50 backdrop-blur-xl">{statusMsg}</div>}

        {activeTab === 'dashboard' ? (
          <div className="space-y-8 animate-in fade-in duration-700">
            <CalendarStrip selected={selectedDate} onChange={setSelectedDate} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xs font-black uppercase text-slate-500 flex items-center gap-2">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                    Strategic Routing Engine
                  </h3>
                  <div className="text-[10px] font-bold text-emerald-400 uppercase bg-emerald-500/5 px-4 py-1.5 rounded-full border border-emerald-500/20">10:00 AM START &rarr; 12:30 PM DEADLINE</div>
                </div>
                <textarea value={jsonInput} onChange={e => setJsonInput(e.target.value)} placeholder="Paste daily JSON data..." className="w-full h-44 bg-slate-950 border border-slate-800 rounded-3xl p-5 font-mono text-xs focus:border-indigo-500 outline-none mb-6 text-slate-300 transition-all" />
                <button onClick={handleCalculate} disabled={isBusy} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-5 rounded-3xl font-black uppercase text-xs tracking-[0.2em] shadow-xl transition-all active:scale-[0.98]">Process Strategic Routes</button>
              </div>

              <div className="lg:col-span-4 bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 flex flex-col justify-center shadow-2xl relative overflow-hidden group">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl"></div>
                <h3 className="text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Rolling Recovery</h3>
                <div className="text-6xl font-black text-white leading-none tracking-tighter mb-4">
                  {pickupTasks.length} <span className="text-xl text-emerald-500 uppercase">Tasks</span>
                </div>
                <p className="text-[10px] text-slate-500 font-black uppercase leading-relaxed max-w-[200px]">Active Box Pickups required in Berlin</p>
                <div className="mt-8 p-4 bg-slate-950 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                  <span className="text-[10px] font-black uppercase text-slate-400">Spatial Sync Active</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-4">
              {fleet.map(d => {
                const tour = tours.find(t => t.driverId === d.id);
                const stopCount = tour?.orders.length || 0;
                const color = DRIVER_COLORS[d.id] || DRIVER_COLORS['default'];
                return (
                  <button key={d.id} onClick={() => setDoc(doc(db, 'fleet', d.id), { isActive: !d.isActive }, { merge: true })} className={`p-5 rounded-3xl border transition-all hover:scale-[1.03] active:scale-95 flex flex-col items-center gap-3 relative group ${d.isActive ? `border-${color.border.split('-')[1]}-500/40 ${color.bg.replace('bg-', 'bg-')}/5 text-${color.bg.split('-')[1]}-400` : 'border-slate-800 bg-slate-900/40 text-slate-700 opacity-60'}`}>
                    <span className="text-[9px] font-black uppercase text-center truncate w-full tracking-tighter">{d.name}</span>
                    <span className="text-2xl font-black leading-none">{stopCount}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${d.isActive ? color.bg : 'bg-slate-800'}`}></div>
                  </button>
                );
              })}
            </div>

            {tours.length > 0 && (
              <div className="h-[500px] w-full rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl relative">
                <OpenMap tours={tours} onGeocodeUpdate={handleGeocodeUpdate} />
                <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 shadow-lg z-10">
                  <span className="text-[10px] font-black uppercase text-white flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    OpenFreeMap Live
                  </span>
                </div>
                <div className="absolute bottom-4 left-4 text-[9px] text-slate-500 font-bold bg-slate-900/80 px-2 py-1 rounded">
                  © OpenFreeMap, OpenStreetMap, MapLibre
                </div>
              </div>
            )}

            {unassigned.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 p-6 rounded-[2rem] animate-pulse flex items-center justify-between">
                <div>
                  <h4 className="text-[10px] font-black uppercase text-red-500 mb-1 tracking-widest">⚠️ Unassigned Stops (Feasibility Cap)</h4>
                  <p className="text-[8px] text-red-400/60 font-bold uppercase">Stops omitted to guarantee 12:30 PM deadline based on Potsdam travel time.</p>
                </div>
                <div className="flex flex-wrap gap-2 max-w-[60%] justify-end">
                  {unassigned.map(o => (
                    <span key={o.orderId} className="bg-red-500/10 text-red-400 px-3 py-1 rounded-full text-[8px] font-black uppercase">{o.name}</span>
                  ))}
                </div>
              </div>
            )}

            {tours.length > 0 && (
              <div className="overflow-x-auto rounded-[3rem] border border-white/5 bg-slate-900 shadow-2xl pb-4">
                <table className="w-full table-fixed min-w-[1500px] border-collapse">
                  <thead>
                    <tr className="bg-slate-950/40">
                      {tours.map(t => <th key={t.driverId} className="p-7 text-[10px] font-black uppercase border-b border-white/5 text-indigo-400 text-center tracking-[0.2em]">{t.driverName}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(Math.max(...tours.map(t => t.orders.length), 15))].map((_, rIdx) => (
                      <tr key={rIdx} className="h-14 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                        {tours.map(t => {
                          const order = t.orders[rIdx];
                          const company = order ? companies.find(c => c.companyId === order.companyId) : null;
                          const isNewStreet = rIdx > 0 && t.orders[rIdx - 1]?.address !== order?.address;

                          return (
                            <td key={t.driverId} className={`px-4 py-2 border-r border-white/5 text-[10px] text-center font-bold relative ${isNewStreet ? 'border-t-2 border-indigo-500/10' : ''}`}>
                              {order && (
                                <div className="flex items-center justify-center gap-3 group cursor-pointer" onClick={() => company && toggleCompanyStatus(company)}>
                                  <span className={`w-3 h-3 rounded-full flex-shrink-0 transition-all group-hover:scale-125 ${company?.boxStatus === BoxStatus.PENDING ? 'bg-amber-500 shadow-lg shadow-amber-500/20' : 'bg-emerald-500 shadow-lg shadow-emerald-500/20'}`}></span>
                                  <div className="flex flex-col items-center">
                                    <span className="truncate uppercase tracking-tighter text-slate-100 group-hover:text-indigo-400 transition-colors leading-none mb-1">{order.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[7px] text-slate-500 font-mono bg-slate-800 px-1.5 rounded-sm">{order.postCode}</span>
                                      <span className="text-[7px] text-slate-600 truncate max-w-[80px]">{order.address?.split(',')[0]}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
              <h2 className="text-xl font-black uppercase text-indigo-400 tracking-tighter flex items-center gap-3 mb-8">
                Neighborhood Recovery <span className="text-[10px] text-slate-500 font-bold bg-slate-950 px-4 py-1.5 rounded-full border border-white/5 uppercase">Pending Box Pickups</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {pickupTasks.length === 0 ? (
                  <div className="col-span-full py-24 text-center text-slate-700 font-black uppercase tracking-[0.5em] text-[10px] border-4 border-dashed border-white/5 rounded-[3rem] bg-slate-950/20">All Boxes Recovered</div>
                ) : pickupTasks.map(task => (
                  <div key={task.companyId} className="bg-slate-950 p-7 rounded-[2.5rem] border border-white/5 hover:border-indigo-500/30 transition-all group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 text-[7px] font-black text-slate-800 uppercase tracking-widest">{task.postCode}</div>
                    <div className="text-[9px] font-black uppercase text-indigo-500 mb-2 tracking-widest">{task.area}</div>
                    <div className="font-black text-sm mb-1 truncate text-white uppercase">{task.companyName}</div>
                    <div className="text-[10px] text-slate-500 truncate mb-6 font-medium">{task.address}</div>
                    <button onClick={async () => {
                      const batch = writeBatch(db);
                      batch.delete(doc(db, 'pickups', task.companyId));
                      batch.set(doc(db, 'companies', task.companyId), { boxStatus: BoxStatus.COLLECTED }, { merge: true });
                      await batch.commit();
                    }} className="w-full bg-slate-900 hover:bg-emerald-600 hover:text-white border border-white/5 py-4 rounded-2xl text-[10px] font-black uppercase transition-all shadow-xl active:scale-95">Verify Collection</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-700">
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Master Registry</h2>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">System Geography Control</p>
                </div>
                <div className="flex gap-4">
                  <button onClick={handlePurgeInvalidCompanies} className="bg-red-500/10 hover:bg-red-500/20 text-red-500 px-7 py-3.5 rounded-2xl text-[10px] font-black uppercase border border-red-500/20 transition-all">Purge Non-Berlin</button>
                  <button onClick={() => setMasterInput(JSON.stringify(companies, null, 2))} className="bg-slate-800 hover:bg-slate-700 text-indigo-400 px-7 py-3.5 rounded-2xl text-[10px] font-black uppercase border border-indigo-500/10 transition-all">Export JSON</button>
                </div>
              </div>
              <textarea value={masterInput} onChange={e => setMasterInput(e.target.value)} placeholder="Sync Master Data..." className="w-full h-56 bg-slate-950 border border-slate-800 rounded-[2rem] p-6 font-mono text-xs outline-none text-slate-300 mb-6 focus:border-indigo-500 transition-all" />
              <button onClick={handleSyncMasterData} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-6 rounded-2xl font-black uppercase text-[11px] tracking-[0.2em] shadow-2xl active:scale-[0.99] transition-all">Update Database Ecosystem</button>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl overflow-hidden">
              <h3 className="text-xs font-black uppercase text-slate-500 mb-8 tracking-widest flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full"></span>
                Active Service Territory ({companies.length} Hubs)
              </h3>
              <div className="overflow-x-auto max-h-[700px] scrollbar-hide">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400">Company</th>
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400">Sector</th>
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400">Address</th>
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400">Postcode</th>
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400">Debt</th>
                      <th className="pb-5 text-[9px] font-black uppercase text-slate-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {[...companies].sort((a, b) => (a.area || '').localeCompare(b.area || '')).map(c => (
                      <tr key={c.companyId} className="group hover:bg-white/5 transition-colors">
                        <td className="py-5 font-black text-xs uppercase text-slate-100">{c.name}</td>
                        <td className="py-5 text-[10px] font-bold text-slate-500">{c.area}</td>
                        <td className="py-5 text-[10px] text-slate-400 truncate max-w-[220px]">{c.address}</td>
                        <td className="py-5 text-[10px] font-mono text-indigo-400">{c.postCode}</td>
                        <td className="py-5">
                          <span className={`text-[8px] font-black uppercase px-3 py-1.5 rounded-full border ${c.boxStatus === BoxStatus.PENDING ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'}`}>
                            {c.boxStatus}
                          </span>
                        </td>
                        <td className="py-5 text-right">
                          <button onClick={() => toggleCompanyStatus(c)} className="text-[10px] font-black uppercase text-slate-600 hover:text-white transition-colors">Toggle Box</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
