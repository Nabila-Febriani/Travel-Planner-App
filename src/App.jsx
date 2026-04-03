import { useState, useEffect, useCallback, useRef } from "react";
import { saveTrip, getTrip, listenTrip } from "./firebase";

// ============ UTILS ============
const genId = () => Math.random().toString(36).slice(2, 8);
const genCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const fmt = (n) => "Rp " + (n || 0).toLocaleString("id-ID");
const CATS = ["Food", "Transport – Local", "Transport – Intercity", "Accommodation", "Activities", "Souvenirs", "Visa / Admin", "Emergency"];
const CAT_EMOJI = { Food: "🍜", "Transport – Local": "🚕", "Transport – Intercity": "✈️", Accommodation: "🏨", Activities: "🎡", Souvenirs: "🎁", "Visa / Admin": "🛂", Emergency: "🧯" };
const CAT_COLORS = { Food: "#f97316", "Transport – Local": "#3b82f6", "Transport – Intercity": "#0ea5e9", Accommodation: "#8b5cf6", Activities: "#ec4899", Souvenirs: "#10b981", "Visa / Admin": "#eab308", Emergency: "#ef4444" };

const getDates = (s, e) => {
  if (!s || !e) return [];
  const d = [], st = new Date(s + "T00:00:00"), en = new Date(e + "T00:00:00");
  let c = new Date(st);
  while (c <= en) { d.push(new Date(c)); c = new Date(c.getTime() + 864e5); }
  return d;
};
const fmtD = (d) => {
  if (!d) return "";
  if (typeof d === "string") d = new Date(d + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
};
const isoD = (d) => d.toISOString().slice(0, 10);

const TRIP_TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "setup", label: "Setup", icon: "⚙️" },
  { id: "itinerary", label: "Itinerary", icon: "🗓️" },
  { id: "expenses", label: "Expenses", icon: "💸" },
  { id: "debts", label: "Debts", icon: "🤝" },
  { id: "packing", label: "Packing", icon: "🎒" },
];

const defaultTrip = () => ({
  setup: { tripName: "", startDate: "2026-04-16", endDate: "2026-04-20", members: [{ id: genId(), name: "", budget: 2000000 }] },
  itinerary: [],
  expenses: [],
  packing: [
    { id: genId(), cat: "Documents", items: [{ id: genId(), name: "Passport / KTP" }, { id: genId(), name: "Booking Confirmation" }] },
    { id: genId(), cat: "Clothing", items: [{ id: genId(), name: "Shirts" }, { id: genId(), name: "Pants" }, { id: genId(), name: "Underwear" }, { id: genId(), name: "Jacket" }] },
    { id: genId(), cat: "Toiletries", items: [{ id: genId(), name: "Toothbrush" }, { id: genId(), name: "Sunscreen" }] },
    { id: genId(), cat: "Electronics", items: [{ id: genId(), name: "Charger" }, { id: genId(), name: "Power Bank" }] },
    { id: genId(), cat: "Medicine", items: [{ id: genId(), name: "Personal Meds" }, { id: genId(), name: "First Aid Kit" }] },
  ],
  packChecks: {},
});

// ============ LOCAL STORAGE (trip list only — personal per device) ============
const getMyTrips = () => { try { return JSON.parse(localStorage.getItem("my-trips") || "[]"); } catch { return []; } };
const saveMyTrips = (t) => localStorage.setItem("my-trips", JSON.stringify(t));

// ============ UI COMPONENTS ============
const Card = ({ children, className = "", onClick }) => <div onClick={onClick} className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>;
const Pill = ({ active, onClick, children }) => <button onClick={onClick} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${active ? "bg-gray-900 text-white shadow-md scale-105" : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"}`}>{children}</button>;
const Sel = ({ value, onChange, children, className = "" }) => <select value={value} onChange={onChange} className={`bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 appearance-none ${className}`}>{children}</select>;
const Inp = ({ className = "", ...p }) => <input {...p} className={`bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ${className}`} />;
const NumInp = ({ value, onChange, className = "", ...p }) => {
  const display = (value || value === 0) && value !== "" ? Number(value).toLocaleString("id-ID") : "";
  const handle = (e) => { const raw = e.target.value.replace(/\D/g, ""); onChange(Number(raw) || 0); };
  return <input {...p} type="text" inputMode="numeric" value={display} onChange={handle} className={`bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ${className}`} />;
};
const BtnDark = ({ children, className = "", ...p }) => <button {...p} className={`text-sm font-medium px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50 ${className}`}>{children}</button>;

// ============ DEBT CALC ============
function calcDebts(names, expenses) {
  const bal = {}, tp = {};
  names.forEach(n => { bal[n] = 0; tp[n] = 0; });
  (expenses || []).forEach(e => {
    if (!e.paidBy || !e.amount || !e.splitAmong?.length) return;
    if (tp[e.paidBy] !== undefined) tp[e.paidBy] += e.amount;
    const sh = e.amount / e.splitAmong.length;
    if (bal[e.paidBy] !== undefined) bal[e.paidBy] += e.amount;
    e.splitAmong.forEach(n => { if (bal[n] !== undefined) bal[n] -= sh; });
  });
  const dbt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([n, v]) => ({ name: n, amt: Math.abs(v) })).sort((a, b) => b.amt - a.amt);
  const crd = Object.entries(bal).filter(([, v]) => v > 0.5).map(([n, v]) => ({ name: n, amt: v })).sort((a, b) => b.amt - a.amt);
  const sett = [];
  const dc = dbt.map(d => ({ ...d })), cc = crd.map(c => ({ ...c }));
  let di = 0, ci = 0;
  while (di < dc.length && ci < cc.length) {
    const t = Math.min(dc[di].amt, cc[ci].amt);
    if (t > 0.5) sett.push({ from: dc[di].name, to: cc[ci].name, amt: Math.round(t) });
    dc[di].amt -= t; cc[ci].amt -= t;
    if (dc[di].amt < 0.5) di++;
    if (cc[ci].amt < 0.5) ci++;
  }
  return { bal, totalPaid: tp, settlements: sett };
}

// ============ EXCEL EXPORT ============
async function doExport(setup, itinerary, expenses) {
  if (!window.XLSX) {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    document.head.appendChild(s);
    await new Promise(r => (s.onload = r));
  }
  const X = window.XLSX, wb = X.utils.book_new();
  const names = (setup.members || []).map(m => m.name).filter(Boolean);

  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ["SETUP — " + setup.tripName], [],
    ["Trip", setup.tripName], ["Start", setup.startDate], ["End", setup.endDate], [],
    ["MEMBERS"], ["Name", "Budget"],
    ...setup.members.map(m => [m.name, m.budget || 0])
  ]), "Setup");

  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ["ITINERARY"], [],
    ["Date", "Start", "End", "Activity", "Location", "Maps Link", "Who", "Notes"],
    ...(itinerary || []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map(r => [r.date, r.time, r.endTime || "", r.activity, r.location, r.locationUrl || "", r.assignedTo?.join(", "), r.notes])
  ]), "Itinerary");

  const er = [["EXPENSES"], [], ["Date", "Desc", "Category", "Amount", "Paid By", ...names.map(n => n + " share")]];
  (expenses || []).forEach(e => er.push([e.date, e.description, e.category, e.amount, e.paidBy,
    ...names.map(n => e.splitAmong?.includes(n) && e.splitAmong.length > 0 ? Math.round(e.amount / e.splitAmong.length) : 0)]));
  er.push(["", "", "TOTAL", (expenses || []).reduce((s, e) => s + (e.amount || 0), 0)]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(er), "Expenses");

  const { bal, totalPaid: tp, settlements } = calcDebts(names, expenses);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ["DEBT TRACKER"], [],
    ["Name", "Paid", "Owed", "Balance"],
    ...names.map(n => [n, Math.round(tp[n] || 0), Math.round((tp[n] || 0) - (bal[n] || 0)), Math.round(bal[n] || 0)]),
    [], ["SETTLEMENTS"], ["From", "To", "Amount"],
    ...settlements.map(s => [s.from, s.to, s.amt])
  ]), "Debts");

  X.writeFile(wb, (setup.tripName || "trip") + ".xlsx");
}

// ============ HOME ============
function Home({ onOpen }) {
  const [trips, setTrips] = useState(getMyTrips());
  const [joinCode, setJoinCode] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const [busy, setBusy] = useState(false);

  const createTrip = async () => {
    const pin = prompt("Enter admin PIN to create a new trip:");
    if (pin !== "5552") { alert("Wrong PIN!"); return; }
    setBusy(true);
    const code = genCode();
    const trip = defaultTrip();
    trip.setup.tripName = "New Trip";
    const ok = await saveTrip(code, trip);
    if (!ok) { setBusy(false); alert("Failed to create trip. Check your internet connection."); return; }
    const nt = [...trips, { code, name: "New Trip", created: Date.now() }];
    saveMyTrips(nt);
    setTrips(nt);
    setBusy(false);
    onOpen(code);
  };

  const joinTrip = async () => {
    setJoinErr("");
    const c = joinCode.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    const data = await getTrip(c);
    if (!data) { setJoinErr("Trip not found — double check the code!"); setBusy(false); return; }
    if (!trips.find(t => t.code === c)) {
      const nt = [...trips, { code: c, name: data.setup?.tripName || "Joined Trip", created: Date.now(), joined: true }];
      saveMyTrips(nt);
      setTrips(nt);
    }
    setBusy(false);
    onOpen(c);
  };

  const removeTrip = (code, e) => {
    e.stopPropagation();
    const nt = trips.filter(t => t.code !== code);
    saveMyTrips(nt);
    setTrips(nt);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">✈️</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Travel Planner</h1>
          <p className="text-gray-400 text-sm">Plan trips together with friends — no account needed</p>
        </div>

        <Card className="p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">🔗 Join a trip</h3>
          <div className="flex gap-2">
            <Inp value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Enter trip code..." className="flex-1 uppercase tracking-widest text-center font-mono text-lg" onKeyDown={e => e.key === "Enter" && joinTrip()} />
            <BtnDark onClick={joinTrip} disabled={busy}>{busy ? "..." : "Join"}</BtnDark>
          </div>
          {joinErr && <p className="text-xs text-red-500 mt-2">{joinErr}</p>}
        </Card>

        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-semibold text-gray-700">My Trips ({trips.length})</h2>
          <BtnDark onClick={createTrip} disabled={busy}>{busy ? "Creating..." : "+ New Trip"}</BtnDark>
        </div>

        {trips.length === 0 ? (
          <Card className="p-10 text-center">
            <div className="text-5xl mb-3">🌴</div>
            <p className="text-gray-400 text-sm mb-4">No trips yet!</p>
            <BtnDark onClick={createTrip} disabled={busy}>Create Your First Trip</BtnDark>
          </Card>
        ) : (
          <div className="space-y-3">
            {trips.sort((a, b) => (b.created || 0) - (a.created || 0)).map(t => (
              <Card key={t.code} className="p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onOpen(t.code)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center text-lg">✈️</div>
                    <div>
                      <div className="font-semibold text-gray-800 text-sm">{t.name || "Untitled"}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{t.code}</span>
                        {t.joined && <span className="text-xs text-blue-500">joined</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => removeTrip(t.code, e)} className="text-gray-300 hover:text-red-400 text-sm p-1">×</button>
                    <span className="text-gray-300">›</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ TRIP VIEW (real-time sync via Firebase) ============
function TripView({ code, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(null);
  const ignoreNext = useRef(false);

  // Real-time listener — auto syncs when anyone edits
  useEffect(() => {
    const unsub = listenTrip(code, (val) => {
      if (ignoreNext.current) { ignoreNext.current = false; return; }
      if (val) setData(val);
      else setData(defaultTrip());
      setLoading(false);
    });
    return () => unsub();
  }, [code]);

  // Debounced save to Firebase
  const save = useCallback((newData) => {
    setData(newData);
    setSaveStatus("saving");
    ignoreNext.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const ok = await saveTrip(code, newData);
      setSaveStatus(ok ? "saved" : "error");
      // Update local trip list name
      const trips = getMyTrips();
      const idx = trips.findIndex(t => t.code === code);
      if (idx >= 0) { trips[idx].name = newData.setup?.tripName || "Untitled"; saveMyTrips(trips); }
    }, 800);
  }, [code]);

  const upd = useCallback((key, valOrFn) => {
    setData(prev => {
      if (!prev) return prev;
      const newVal = typeof valOrFn === "function" ? valOrFn(prev[key]) : valOrFn;
      const n = { ...prev, [key]: newVal };
      save(n);
      return n;
    });
  }, [save]);

  const setSetup = (fn) => upd("setup", fn);
  const setItinerary = (fn) => upd("itinerary", fn);
  const setExpenses = (fn) => upd("expenses", fn);
  const setPacking = (fn) => upd("packing", fn);
  const setPackChecks = (fn) => upd("packChecks", fn);
  const setPaidDebts = (fn) => upd("paidDebts", fn);

  const copyCode = () => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const copyLink = () => { navigator.clipboard?.writeText(window.location.origin + "?trip=" + code); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (loading || !data) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-4xl animate-bounce">✈️</div></div>;

  const { setup = {}, itinerary = [], expenses = [], packing = [], packChecks = {}, paidDebts = {} } = data;
  const names = (setup.members || []).map(m => m.name).filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50 pb-24" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="text-gray-400 hover:text-gray-700 text-sm">← Back</button>
              <div>
                <h1 className="text-base font-bold text-gray-900">{setup.tripName || "Untitled Trip"}</h1>
                <p className="text-xs text-gray-400">{setup.startDate && setup.endDate ? `${fmtD(setup.startDate)} — ${fmtD(setup.endDate)}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {saveStatus === "saving" && <span className="text-xs text-amber-500 animate-pulse">Saving...</span>}
              {saveStatus === "saved" && <span className="text-xs text-emerald-500">✓ Synced</span>}
              {saveStatus === "error" && <span className="text-xs text-red-500">⚠ Error</span>}
              <button onClick={() => doExport(setup, itinerary, expenses)} className="text-xs font-medium bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full hover:bg-gray-200">📥 Excel</button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 p-2.5 bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl border border-gray-100">
            <span className="text-xs text-gray-400">Code:</span>
            <span className="font-mono font-bold text-gray-800 tracking-widest text-sm">{code}</span>
            <button onClick={copyCode} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-full hover:bg-gray-700">{copied ? "✓ Copied!" : "Copy"}</button>
            <button onClick={copyLink} className="text-xs bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-500">🔗 Link</button>
            <span className="text-xs text-gray-400 ml-auto">Share to invite</span>
          </div>
        </div>
      </div>

      <div className="sticky top-[106px] z-10 bg-gray-50 pt-3 pb-2">
        <div className="max-w-3xl mx-auto px-4 flex gap-2 overflow-x-auto pb-1">
          {TRIP_TABS.map(t => <Pill key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>{t.icon} {t.label}</Pill>)}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-3">
        {tab === "dashboard" && <Dashboard setup={setup} expenses={expenses} itinerary={itinerary} />}
        {tab === "setup" && <SetupTab setup={setup} setSetup={setSetup} />}
        {tab === "itinerary" && <ItineraryTab setup={setup} items={itinerary} setItems={setItinerary} />}
        {tab === "expenses" && <ExpensesTab setup={setup} expenses={expenses} setExpenses={setExpenses} />}
        {tab === "debts" && <DebtsTab setup={setup} expenses={expenses} paidDebts={paidDebts} setPaidDebts={setPaidDebts} />}
        {tab === "packing" && <PackingTab names={names} groups={packing} setGroups={setPacking} checks={packChecks} setChecks={setPackChecks} />}
      </div>
    </div>
  );
}

// ============ DASHBOARD ============
function Dashboard({ setup, expenses = [], itinerary = [] }) {
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const dates = getDates(setup?.startDate, setup?.endDate);
  const [filter, setFilter] = useState("__all__");

  // Filter expenses by person (only those where the person is in splitAmong)
  const filtered = filter === "__all__" ? expenses : expenses.filter(e => e.splitAmong?.includes(filter));

  const totalBudget = filter === "__all__"
    ? (setup?.members || []).reduce((s, m) => s + (m.budget || 0), 0)
    : ((setup?.members || []).find(m => m.name === filter)?.budget || 0);

  const totalSpent = filter === "__all__"
    ? filtered.reduce((s, e) => s + (e.amount || 0), 0)
    : filtered.reduce((s, e) => s + ((e.amount || 0) / (e.splitAmong?.length || 1)), 0);

  const remaining = totalBudget - totalSpent;
  const pct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;

  const byCat = {}; CATS.forEach(c => byCat[c] = 0);
  filtered.forEach(e => {
    const amt = filter === "__all__" ? (e.amount || 0) : (e.amount || 0) / (e.splitAmong?.length || 1);
    byCat[e.category] = (byCat[e.category] || 0) + amt;
  });
  const maxCat = Math.max(...Object.values(byCat), 1);

  const byDate = {}; dates.forEach(d => byDate[isoD(d)] = 0);
  filtered.forEach(e => {
    if (!e.date) return;
    const amt = filter === "__all__" ? (e.amount || 0) : (e.amount || 0) / (e.splitAmong?.length || 1);
    byDate[e.date] = (byDate[e.date] || 0) + amt;
  });
  const maxDay = Math.max(...Object.values(byDate), 1);

  const perMember = names.map(n => {
    const m = (setup.members || []).find(x => x.name === n);
    let spent = 0;
    expenses.forEach(e => { if (e.splitAmong?.includes(n) && e.splitAmong.length > 0) spent += (e.amount || 0) / e.splitAmong.length; });
    return { name: n, budget: m?.budget || 0, spent: Math.round(spent) };
  });
  const { settlements: allSettlements } = calcDebts(names, expenses);
  const settlements = filter === "__all__" ? allSettlements : allSettlements.filter(s => s.from === filter || s.to === filter);

  return (
    <div className="space-y-5">
      <Card className="p-4"><div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-400 font-medium">Filter:</span>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilter("__all__")} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${filter === "__all__" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>All</button>
          {names.map(n => <button key={n} onClick={() => setFilter(n)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${filter === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>{n}</button>)}
        </div>
      </div></Card>

      <Card className="p-6 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white border-none relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white opacity-5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="text-xs uppercase tracking-widest text-gray-400 mb-1">✈️ {setup?.tripName || "Your Trip"}</div>
          <div className="text-sm text-gray-400 mb-4">{dates.length} days · {names.length} travelers{dates.length > 0 ? ` · ${fmtD(dates[0])} – ${fmtD(dates[dates.length - 1])}` : ""}</div>
          <div className="grid grid-cols-3 gap-4">
            <div><div className="text-xs text-gray-400">Budget</div><div className="text-xl font-bold">{fmt(totalBudget)}</div></div>
            <div><div className="text-xs text-gray-400">Spent</div><div className="text-xl font-bold text-orange-400">{fmt(totalSpent)}</div></div>
            <div><div className="text-xs text-gray-400">Remaining</div><div className={`text-xl font-bold ${remaining >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(remaining)}</div></div>
          </div>
          <div className="mt-4 bg-white/10 rounded-full h-3 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: pct + "%" }} />
          </div>
          <div className="text-xs text-gray-400 mt-1 text-right">{pct.toFixed(0)}% used</div>
        </div>
      </Card>

      {filter === "__all__" && <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">👥 Budget per Person</h3>
        <div className="space-y-3">{perMember.map(m => { const p = m.budget > 0 ? Math.min(m.spent / m.budget * 100, 100) : 0; return (
          <div key={m.name}><div className="flex justify-between text-sm mb-1"><span className="font-medium">{m.name}</span><span className={`text-xs ${m.budget - m.spent < 0 ? "text-red-500 font-semibold" : "text-gray-400"}`}>{fmt(m.spent)} / {fmt(m.budget)}</span></div><div className="bg-gray-100 rounded-full h-2.5 overflow-hidden"><div className={`h-full rounded-full transition-all ${p > 90 ? "bg-red-400" : p > 70 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: p + "%" }} /></div></div>
        ); })}</div>
      </Card>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">📂 By Category</h3><div className="space-y-2.5">{CATS.map(c => (<div key={c} className="flex items-center gap-2.5"><span className="w-6 text-center">{CAT_EMOJI[c]}</span><span className="text-xs text-gray-500 w-24">{c}</span><div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden"><div className="h-full rounded-full" style={{ width: (byCat[c] / maxCat * 100) + "%", background: CAT_COLORS[c] }} /></div><span className="text-xs font-medium text-gray-600 w-24 text-right">{fmt(byCat[c])}</span></div>))}</div></Card>
        <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">📅 By Day</h3><div className="flex items-end gap-2 h-36">{Object.entries(byDate).sort().map(([d, v]) => (<div key={d} className="flex-1 flex flex-col items-center justify-end h-full"><div className="text-xs font-semibold text-gray-600 mb-1">{v > 0 ? fmt(v) : ""}</div><div className="w-full bg-gradient-to-t from-gray-800 to-gray-600 rounded-t-lg" style={{ height: Math.max((v / maxDay * 100), 4) + "%" }} /><div className="text-xs text-gray-400 mt-1.5 text-center">{fmtD(d)}</div></div>))}</div></Card>
      </div>

      <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">🤝 Settlements</h3>{settlements.length === 0 ? <p className="text-sm text-gray-400 italic text-center py-4">No debts yet</p> : <div className="space-y-2">{settlements.map((s, i) => (<div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-red-50 via-white to-emerald-50 border border-gray-100"><div className="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-sm font-semibold">{s.from}</div><div className="flex-1 flex items-center gap-1"><div className="flex-1 border-t border-dashed border-gray-300" /><span className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-full">{fmt(s.amt)}</span><div className="flex-1 border-t border-dashed border-gray-300" /><span className="text-gray-400">→</span></div><div className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-lg text-sm font-semibold">{s.to}</div></div>))}</div>}</Card>
    </div>
  );
}

// ============ SETUP ============
function SetupTab({ setup, setSetup }) {
  const u = (k, v) => setSetup(p => ({ ...p, [k]: v }));
  const uM = (i, k, v) => setSetup(p => { const m = [...(p.members || [])]; m[i] = { ...m[i], [k]: v }; return { ...p, members: m }; });
  const addM = () => setSetup(p => ({ ...p, members: [...(p.members || []), { id: genId(), name: "", budget: 2000000 }] }));
  const rmM = (i) => setSetup(p => ({ ...p, members: (p.members || []).filter((_, idx) => idx !== i) }));
  const applyB = (v) => setSetup(p => ({ ...p, members: (p.members || []).map(m => ({ ...m, budget: Number(v) || 0 })) }));

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">✈️ Trip Info</h3>
        <Inp value={setup?.tripName || ""} onChange={e => u("tripName", e.target.value)} placeholder="Trip Name" className="w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Inp type="date" value={setup?.startDate || ""} onChange={e => u("startDate", e.target.value)} />
          <Inp type="date" value={setup?.endDate || ""} onChange={e => u("endDate", e.target.value)} />
        </div>
      </Card>
      <Card className="p-5 space-y-4">
        <div className="flex justify-between items-center"><h3 className="text-sm font-semibold text-gray-700">👥 Members ({(setup?.members || []).length})</h3><BtnDark onClick={addM}>+ Add</BtnDark></div>
        <div className="flex gap-2 items-center"><NumInp value="" placeholder="Set all budgets" className="flex-1" onChange={v => applyB(v)} /><span className="text-xs text-gray-400 shrink-0">Apply all</span></div>
        <div className="space-y-2">{(setup?.members || []).map((m, i) => (
          <div key={m.id || i} className="flex gap-2 items-center bg-gray-50 p-2 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{(m.name || "?")[0].toUpperCase()}</div>
            <Inp value={m.name || ""} onChange={e => uM(i, "name", e.target.value)} placeholder="Name" className="flex-1" />
            <NumInp value={m.budget} onChange={v => uM(i, "budget", v)} placeholder="Budget" className="w-32" />
            {(setup?.members || []).length > 1 && <button onClick={() => rmM(i)} className="text-gray-300 hover:text-red-500 text-lg">×</button>}
          </div>
        ))}</div>
      </Card>
    </div>
  );
}

// ============ ITINERARY (Calendar View) ============
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00:00 – 23:00
const SLOT_H = 48; // px per hour
const MEMBER_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#10b981", "#eab308", "#ef4444", "#06b6d4", "#84cc16", "#f43f5e"];

// Overlap layout: assign column index and total columns to overlapping events
function layoutEvents(evts, timeToMin) {
  if (!evts.length) return [];
  const sorted = evts.map(e => ({ ...e, _s: timeToMin(e.time), _e: timeToMin(e.endTime || e.time) })).sort((a, b) => a._s - b._s || a._e - b._e);
  const groups = [];
  let group = [sorted[0]], groupEnd = sorted[0]._e;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]._s < groupEnd) {
      group.push(sorted[i]);
      groupEnd = Math.max(groupEnd, sorted[i]._e);
    } else {
      groups.push(group);
      group = [sorted[i]];
      groupEnd = sorted[i]._e;
    }
  }
  groups.push(group);
  const result = [];
  groups.forEach(g => {
    const cols = [];
    g.forEach(evt => {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c] <= evt._s) { cols[c] = evt._e; result.push({ ...evt, _col: c, _total: 0 }); placed = true; break; }
      }
      if (!placed) { result.push({ ...evt, _col: cols.length, _total: 0 }); cols.push(evt._e); }
    });
    const total = cols.length;
    result.forEach(r => { if (g.find(e => e.id === r.id)) r._total = total; });
  });
  return result;
}

function ItineraryTab({ setup, items = [], setItems }) {
  const dates = getDates(setup?.startDate, setup?.endDate);
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const [viewMode, setViewMode] = useState("week");
  const [viewPeople, setViewPeople] = useState([]); // empty = all
  const [viewDay, setViewDay] = useState(dates[0] ? isoD(dates[0]) : "");
  const [dayPeople, setDayPeople] = useState([]); // selected people in day view (empty = all)
  const [modal, setModal] = useState(null);
  const [drag, setDrag] = useState(null); // { type: "create"|"move"|"resize-top"|"resize-bottom", ... }
  const gridRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { if (dates.length && !dates.find(d => isoD(d) === viewDay)) setViewDay(isoD(dates[0])); }, [dates.length]);

  const timeToMin = (t) => { const [h, m] = (t || "06:00").split(":").map(Number); return h * 60 + m; };
  const minToTime = (m) => { const clamped = Math.max(0, Math.min(m, 1439)); return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`; };
  const snapTo30 = (m) => Math.round(m / 30) * 30;
  const getColor = (name) => MEMBER_COLORS[names.indexOf(name) % MEMBER_COLORS.length] || "#6b7280";

  const add = (date, startTime, endTime, assignedTo) => {
    const item = { id: genId(), date, time: startTime, endTime: endTime || minToTime(timeToMin(startTime) + 60), activity: "", location: "", locationUrl: "", assignedTo: assignedTo || [...names], notes: "" };
    setItems(p => [...(p || []), item]);
    setModal({ id: item.id, snapshot: item, isNew: true });
  };
  const rm = (id) => { setModal(null); setItems(p => (p || []).filter(r => r.id !== id)); };
  const upd = (id, k, v) => setItems(p => (p || []).map(r => r.id === id ? { ...r, [k]: v } : r));
  const updMulti = (id, obj) => setItems(p => (p || []).map(r => r.id === id ? { ...r, ...obj } : r));
  const togA = (id, n) => setItems(p => (p || []).map(r => r.id !== id ? r : { ...r, assignedTo: r.assignedTo?.includes(n) ? r.assignedTo.filter(x => x !== n) : [...(r.assignedTo || []), n] }));

  // Toggle person in day view filter
  const togDayPerson = (n) => setDayPeople(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);
  const togWeekPerson = (n) => setViewPeople(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  // Y position to minutes (relative to scroll container's grid body)
  const yToMin = (y) => snapTo30(Math.max(0, Math.min((y / SLOT_H) * 60, 1410)));

  // --- DRAG SYSTEM ---
  const handleGridMouseDown = (date, col, e) => {
    if (e.button !== 0 || e.target.closest("[data-event]")) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const startMin = yToMin(y);
    setDrag({ type: "create", date, col, startMin, currentMin: startMin });
  };

  const handleEventMouseDown = (item, type, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startMin = timeToMin(item.time);
    const endMin = timeToMin(item.endTime || minToTime(startMin + 60));
    setDrag({ type, id: item.id, origDate: item.date, origStart: startMin, origEnd: endMin, anchorX: e.clientX, anchorY: e.clientY, startMin, endMin });
  };

  // Detect which column (date) the mouse is over
  const getDateFromX = useCallback((clientX) => {
    if (!scrollRef.current) return null;
    const cols = scrollRef.current.querySelectorAll("[data-coldate]");
    for (const col of cols) {
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return col.getAttribute("data-coldate");
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!drag) return;
    if (drag.type === "create") {
      if (!scrollRef.current) return;
      const gridBody = scrollRef.current.querySelector("[data-gridbody]");
      if (!gridBody) return;
      const rect = gridBody.getBoundingClientRect();
      const y = e.clientY - rect.top;
      setDrag(prev => prev ? { ...prev, currentMin: yToMin(y) } : null);
    } else {
      const dy = e.clientY - drag.anchorY;
      const deltaMin = snapTo30(Math.round((dy / SLOT_H) * 60));
      if (drag.type === "move") {
        const newStart = Math.max(0, Math.min(drag.origStart + deltaMin, 1410 - (drag.origEnd - drag.origStart)));
        const newEnd = newStart + (drag.origEnd - drag.origStart);
        const newDate = getDateFromX(e.clientX) || drag.origDate;
        setDrag(prev => prev ? { ...prev, startMin: newStart, endMin: newEnd } : null);
        updMulti(drag.id, { time: minToTime(newStart), endTime: minToTime(newEnd), date: newDate });
      } else if (drag.type === "resize-bottom") {
        const newEnd = Math.max(drag.origStart + 30, Math.min(drag.origEnd + deltaMin, 1440));
        setDrag(prev => prev ? { ...prev, endMin: newEnd } : null);
        upd(drag.id, "endTime", minToTime(newEnd));
      } else if (drag.type === "resize-top") {
        const newStart = Math.max(0, Math.min(drag.origStart + deltaMin, drag.origEnd - 30));
        setDrag(prev => prev ? { ...prev, startMin: newStart } : null);
        upd(drag.id, "time", minToTime(newStart));
      }
    }
  }, [drag, getDateFromX]);

  const handleMouseUp = useCallback(() => {
    if (!drag) return;
    if (drag.type === "create") {
      const s = Math.min(drag.startMin, drag.currentMin);
      const e = Math.max(drag.startMin, drag.currentMin);
      const endMin = e > s ? e + 30 : s + 60;
      const assignedTo = viewMode === "day" && drag.col !== "__all__" ? [drag.col] : [...names];
      add(drag.date, minToTime(s), minToTime(Math.min(endMin, 1440)), assignedTo);
    }
    setDrag(null);
  }, [drag, names, viewMode]);

  useEffect(() => {
    if (drag) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
    }
  }, [drag, handleMouseMove, handleMouseUp]);

  // --- POSITION & RENDERING ---
  const getPos = (item) => {
    const start = timeToMin(item.time);
    const end = timeToMin(item.endTime || minToTime(start + 60));
    return { top: (start / 60) * SLOT_H, height: Math.max(((end - start) / 60) * SLOT_H, 12) };
  };

  const renderEvent = (item, showName, col, total) => {
    const { top, height } = getPos(item);
    const color = item.assignedTo?.length === 1 ? getColor(item.assignedTo[0]) : "#3b82f6";
    const compact = height < 36;
    const w = total > 1 ? `${Math.floor(100 / total)}%` : "calc(100% - 8px)";
    const left = total > 1 ? `${Math.floor((col / total) * 100)}%` : "4px";
    return (
      <div key={item.id} data-event="true"
        className="absolute rounded-lg px-2 py-1 overflow-hidden border border-white/50 hover:brightness-110 transition-all z-20 cursor-grab active:cursor-grabbing"
        style={{ top, height, width: w, left, background: color + "22", borderLeft: `3px solid ${color}` }}
        onMouseDown={e => handleEventMouseDown(item, "move", e)}
        onClick={e => { e.stopPropagation(); setModal({ id: item.id, snapshot: item }); }}>
        {compact ? (
          <div className="text-xs font-medium truncate" style={{ color }}>{item.time?.slice(0, 5)} {item.activity || "Untitled"}</div>
        ) : (<>
          <div className="text-xs font-semibold truncate" style={{ color }}>{item.activity || "Untitled"}</div>
          <div className="text-xs text-gray-500 truncate">{item.time?.slice(0, 5)} – {(item.endTime || "").slice(0, 5)}</div>
          {item.location && <div className="text-xs text-gray-400 truncate">📍 {item.location}</div>}
          {showName && item.assignedTo?.length > 0 && <div className="text-xs text-gray-400 truncate">{item.assignedTo.join(", ")}</div>}
        </>)}
        {/* Resize handles */}
        <div className="absolute top-0 left-0 right-0 h-2 cursor-n-resize" onMouseDown={e => handleEventMouseDown(item, "resize-top", e)} />
        <div className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize" onMouseDown={e => handleEventMouseDown(item, "resize-bottom", e)} />
      </div>
    );
  };

  const renderDragPreview = (colDate, colName) => {
    if (!drag || drag.type !== "create" || drag.date !== colDate || drag.col !== colName) return null;
    const s = Math.min(drag.startMin, drag.currentMin) - 360;
    const e = Math.max(drag.startMin, drag.currentMin) - 360 + 30;
    const top = (s / 60) * SLOT_H;
    const height = Math.max(((e - s) / 60) * SLOT_H, SLOT_H / 2);
    return <div className="absolute left-1 right-1 rounded-lg bg-blue-200 opacity-50 border-2 border-blue-400 z-10 pointer-events-none" style={{ top, height }} />;
  };

  const renderCol = (date, colName, colItems) => {
    const laid = layoutEvents(colItems, timeToMin);
    return (
      <div className="flex-1 min-w-[120px] relative border-r border-gray-100" style={{ height: HOURS.length * SLOT_H }}
        onMouseDown={e => { const rect = e.currentTarget.getBoundingClientRect(); handleGridMouseDown(date, colName, { ...e, currentTarget: e.currentTarget, clientY: e.clientY, target: e.target, button: e.button, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() }); }}>
        {HOURS.map(h => <div key={h} className="absolute w-full border-t border-gray-100" style={{ top: h * SLOT_H }} />)}
        {HOURS.map(h => <div key={h + "half"} className="absolute w-full border-t border-gray-50" style={{ top: h * SLOT_H + SLOT_H / 2 }} />)}
        {renderDragPreview(date, colName)}
        {laid.map(item => renderEvent(item, viewMode === "week", item._col, item._total))}
      </div>
    );
  };

  const renderTimeGutter = () => (
    <div className="shrink-0 w-14 border-r border-gray-200 relative bg-white" style={{ height: HOURS.length * SLOT_H }}>
      {HOURS.map(h => h === 0 ? null : (
        <div key={h} className="absolute w-full text-right pr-2 text-xs text-gray-400 -translate-y-1/2" style={{ top: h * SLOT_H }}>
          {String(h).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );

  // Compute data
  const weekFiltered = viewPeople.length === 0 ? items : (items || []).filter(r => viewPeople.some(p => r.assignedTo?.includes(p)));
  const visiblePeople = dayPeople.length > 0 ? dayPeople : names;
  const dayAllItems = (items || []).filter(r => r.date === viewDay);
  const modalItem = modal ? (items || []).find(r => r.id === modal.id) || modal.snapshot : null;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5">
            <button onClick={() => setViewMode("week")} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${viewMode === "week" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>📅 Day</button>
            <button onClick={() => setViewMode("day")} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${viewMode === "day" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>👥 Person</button>
          </div>
          <div className="h-5 w-px bg-gray-200" />
          {viewMode === "week" ? (
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setViewPeople([])} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${viewPeople.length === 0 ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>Everyone</button>
              {names.map(n => <button key={n} onClick={() => togWeekPerson(n)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${viewPeople.includes(n) ? "text-white" : "bg-gray-100 text-gray-500"}`} style={viewPeople.includes(n) ? { background: getColor(n) } : {}}>{n}</button>)}
            </div>
          ) : (<>
            <div className="flex gap-1.5 flex-wrap">
              {dates.map(d => {
                const ds = isoD(d);
                return <button key={ds} onClick={() => setViewDay(ds)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${viewDay === ds ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>{fmtD(d)}</button>;
              })}
            </div>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setDayPeople([])} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${dayPeople.length === 0 ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>All</button>
              {names.map(n => <button key={n} onClick={() => togDayPerson(n)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${dayPeople.includes(n) ? "text-white" : "bg-gray-100 text-gray-500"}`} style={dayPeople.includes(n) ? { background: getColor(n) } : {}}>{n}</button>)}
            </div>
          </>)}
        </div>
      </Card>

      {/* Calendar */}
      <Card className="overflow-hidden">
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 200px)", userSelect: drag ? "none" : "auto" }}>
          <div style={{ minWidth: (viewMode === "week" ? dates.length : visiblePeople.length) * 120 + 56 }}>
            {/* Sticky header */}
            <div className="flex border-b border-gray-200 bg-white sticky top-0" style={{ zIndex: 25 }}>
              <div className="shrink-0 w-14 border-r border-gray-200" />
              {viewMode === "week" ? dates.map(d => (
                <div key={isoD(d)} className="flex-1 min-w-[120px] text-center py-2 px-1 border-r border-gray-100">
                  <div className="text-xs font-semibold text-gray-700">{fmtD(d)}</div>
                </div>
              )) : visiblePeople.map(n => (
                <div key={n} className="flex-1 min-w-[120px] text-center py-2 px-1 border-r border-gray-100">
                  <div className="w-7 h-7 rounded-full text-white flex items-center justify-center text-xs font-bold mx-auto mb-1" style={{ background: getColor(n) }}>{n[0]}</div>
                  <div className="text-xs font-medium text-gray-600 truncate">{n}</div>
                </div>
              ))}
            </div>
            {/* Grid body */}
            <div className="flex relative" data-gridbody="true">
              {renderTimeGutter()}
              {viewMode === "week" ? dates.map(d => {
                const ds = isoD(d);
                const colItems = (weekFiltered || []).filter(r => r.date === ds);
                return <div key={ds} data-coldate={ds} className="flex-1 min-w-[120px]">{renderCol(ds, "__week__", colItems)}</div>;
              }) : visiblePeople.map(n => {
                const personItems = dayAllItems.filter(r => r.assignedTo?.includes(n));
                return <div key={n} data-coldate={viewDay} className="flex-1 min-w-[120px]">{renderCol(viewDay, n, personItems)}</div>;
              })}
            </div>
          </div>
        </div>
      </Card>

      <div className="text-center">
        <span className="text-xs text-gray-400">Click to create · Drag edges to resize · Drag body to move</span>
      </div>

      {/* Event Modal */}
      {modal && modalItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-gray-800">{modal.isNew ? "New Event" : "Edit Event"}</h3>
              <button onClick={() => setModal(null)} className="text-gray-300 hover:text-gray-600 text-xl">×</button>
            </div>
            <Inp value={modalItem.activity || ""} onChange={e => upd(modal.id, "activity", e.target.value)} placeholder="Event name..." className="w-full text-base font-semibold" autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-400 mb-1 block">Start</label><Inp type="time" value={modalItem.time || ""} onChange={e => upd(modal.id, "time", e.target.value)} className="w-full" /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">End</label><Inp type="time" value={modalItem.endTime || ""} onChange={e => upd(modal.id, "endTime", e.target.value)} className="w-full" /></div>
            </div>
            <div><label className="text-xs text-gray-400 mb-1 block">Date</label><Sel value={modalItem.date || ""} onChange={e => upd(modal.id, "date", e.target.value)} className="w-full">{dates.map(d => <option key={isoD(d)} value={isoD(d)}>{fmtD(d)}</option>)}</Sel></div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">📍 Location</label>
              <Inp value={modalItem.location || ""} onChange={e => upd(modal.id, "location", e.target.value)} placeholder="Place name" className="w-full" />
              <Inp value={modalItem.locationUrl || ""} onChange={e => upd(modal.id, "locationUrl", e.target.value)} placeholder="Google Maps link (optional)" className="w-full mt-1.5 text-xs" />
              {modalItem.locationUrl && <a href={modalItem.locationUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 inline-block">↗ Open in Maps</a>}
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Who's joining</label>
              <div className="flex gap-1.5 flex-wrap">
                {names.map(n => (
                  <button key={n} onClick={() => togA(modal.id, n)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${modalItem.assignedTo?.includes(n) ? "text-white" : "bg-gray-100 text-gray-400"}`}
                    style={modalItem.assignedTo?.includes(n) ? { background: getColor(n) } : {}}>{n}</button>
                ))}
              </div>
            </div>
            <Inp value={modalItem.notes || ""} onChange={e => upd(modal.id, "notes", e.target.value)} placeholder="Notes..." className="w-full text-xs" />
            <div className="flex justify-between pt-2">
              <button onClick={() => rm(modal.id)} className="text-xs text-red-400 hover:text-red-600">Delete event</button>
              <BtnDark onClick={() => setModal(null)}>Done</BtnDark>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ EXPENSES ============
function ExpensesTab({ setup, expenses = [], setExpenses }) {
  const dates = getDates(setup?.startDate, setup?.endDate);
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const add = () => setExpenses(p => [...(p || []), { id: genId(), date: dates[0] ? isoD(dates[0]) : "", description: "", category: "Food", amount: 0, paidBy: names[0] || "", splitAmong: [...names] }]);
  const rm = (id) => setExpenses(p => (p || []).filter(e => e.id !== id));
  const upd = (id, k, v) => setExpenses(p => (p || []).map(e => e.id === id ? { ...e, [k]: v } : e));
  const togS = (id, n) => setExpenses(p => (p || []).map(e => e.id !== id ? e : { ...e, splitAmong: e.splitAmong?.includes(n) ? e.splitAmong.filter(x => x !== n) : [...(e.splitAmong || []), n] }));
  const total = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><div className="text-sm text-gray-500">Total: <span className="font-bold text-gray-900 text-base">{fmt(total)}</span></div><BtnDark onClick={add}>+ Add Expense</BtnDark></div>
      {(expenses || []).length === 0 && <Card className="p-10 text-center"><div className="text-4xl mb-2">💸</div><p className="text-sm text-gray-400">No expenses yet</p></Card>}
      {(expenses || []).map(ex => (
        <Card key={ex.id} className="p-4 space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Sel value={ex.date || ""} onChange={e => upd(ex.id, "date", e.target.value)} className="w-36">{dates.map(d => <option key={isoD(d)} value={isoD(d)}>{fmtD(d)}</option>)}</Sel>
            <Sel value={ex.category || "Food"} onChange={e => upd(ex.id, "category", e.target.value)} className="w-36">{CATS.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}</Sel>
            <Inp value={ex.description || ""} onChange={e => upd(ex.id, "description", e.target.value)} placeholder="Description" className="flex-1 min-w-[120px]" />
            <NumInp value={ex.amount} onChange={v => upd(ex.id, "amount", v)} placeholder="Amount" className="w-28 text-right font-semibold" />
            <button onClick={() => rm(ex.id)} className="text-gray-300 hover:text-red-400 text-lg">×</button>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-xs text-gray-400">Paid by:</span>
            <Sel value={ex.paidBy || ""} onChange={e => upd(ex.id, "paidBy", e.target.value)} className="w-28"><option value="">—</option>{names.map(n => <option key={n}>{n}</option>)}</Sel>
            <span className="text-xs text-gray-400 ml-2">Split:</span>
            {names.map(n => <button key={n} onClick={() => togS(ex.id, n)} className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all ${ex.splitAmong?.includes(n) ? "bg-emerald-100 text-emerald-700 border border-emerald-300" : "bg-gray-50 text-gray-300 border border-gray-200"}`}>{n}</button>)}
            <button onClick={() => setExpenses(p => (p || []).map(e => e.id === ex.id ? { ...e, splitAmong: [...names] } : e))} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">All</button>
          </div>
          {ex.amount > 0 && ex.splitAmong?.length > 0 && <div className="text-xs text-gray-400">{fmt(Math.round(ex.amount / ex.splitAmong.length))} / person</div>}
        </Card>
      ))}
    </div>
  );
}

// ============ DEBTS ============
function DebtsTab({ setup, expenses = [], paidDebts = {}, setPaidDebts }) {
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const { bal, totalPaid, settlements } = calcDebts(names, expenses);
  const togglePaid = (key) => setPaidDebts(p => ({ ...(p || {}), [key]: !(p || {})[key] }));
  const paidCount = settlements.filter((s, i) => paidDebts[`${s.from}-${s.to}`]).length;
  return (
    <div className="space-y-5">
      <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">💰 Balance</h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{names.map(n => { const b = Math.round(bal[n] || 0); return (
        <div key={n} className={`rounded-xl p-3 border ${b > 0 ? "bg-emerald-50 border-emerald-200" : b < 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <div className="flex items-center gap-2 mb-1"><div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">{n[0]}</div><span className="text-sm font-medium">{n}</span></div>
          <div className={`text-lg font-bold ${b > 0 ? "text-emerald-600" : b < 0 ? "text-red-500" : "text-gray-400"}`}>{b > 0 ? "+" : ""}{fmt(b)}</div>
          <div className="text-xs text-gray-400 mt-0.5">Paid: {fmt(Math.round(totalPaid[n] || 0))}</div>
        </div>); })}</div></Card>
      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-gray-700">🤝 Who Pays Whom</h3>
          {settlements.length > 0 && <span className="text-xs text-gray-400">{paidCount}/{settlements.length} paid</span>}
        </div>
        {settlements.length === 0 ? <div className="text-center py-6"><div className="text-3xl mb-2">✅</div><p className="text-sm text-gray-400">Everyone settled!</p></div> : <div className="space-y-3">{settlements.map((s, i) => {
          const key = `${s.from}-${s.to}`;
          const isPaid = !!paidDebts[key];
          return (
            <div key={i} className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${isPaid ? "bg-gray-50 border-gray-200 opacity-60" : "bg-gradient-to-r from-red-50 via-white to-emerald-50 border-gray-100"}`}>
              <div className="flex items-center gap-2"><div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isPaid ? "bg-gray-200 text-gray-500" : "bg-red-100 text-red-700"}`}>{s.from[0]}</div><span className={`font-semibold text-sm ${isPaid ? "text-gray-400 line-through" : "text-red-700"}`}>{s.from}</span></div>
              <div className="flex-1 flex items-center gap-2"><div className="flex-1 border-t-2 border-dashed border-gray-200" /><div className={`px-3 py-1 rounded-full text-sm font-bold ${isPaid ? "bg-emerald-500 text-white" : "bg-gray-900 text-white"}`}>{isPaid ? "✓ Paid" : fmt(s.amt)}</div><div className="flex-1 border-t-2 border-dashed border-gray-200" /><span className="text-gray-400">→</span></div>
              <div className="flex items-center gap-2"><span className={`font-semibold text-sm ${isPaid ? "text-gray-400 line-through" : "text-emerald-700"}`}>{s.to}</span><div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isPaid ? "bg-gray-200 text-gray-500" : "bg-emerald-100 text-emerald-700"}`}>{s.to[0]}</div></div>
              <button onClick={() => togglePaid(key)} className={`shrink-0 ml-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isPaid ? "bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-600" : "bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700"}`}>{isPaid ? "Undo" : "Mark Paid"}</button>
            </div>);
        })}</div>}
      </Card>
    </div>
  );
}

// ============ PACKING ============
function PackingTab({ names = [], groups = [], setGroups, checks = {}, setChecks }) {
  const [newCat, setNewCat] = useState("");
  const toggle = (key) => setChecks(p => ({ ...(p || {}), [key]: !(p || {})[key] }));
  const addItem = (gId) => setGroups(p => (p || []).map(g => g.id === gId ? { ...g, items: [...(g.items || []), { id: genId(), name: "" }] } : g));
  const rmItem = (gId, iId) => setGroups(p => (p || []).map(g => g.id === gId ? { ...g, items: (g.items || []).filter(it => it.id !== iId) } : g));
  const updItem = (gId, iId, v) => setGroups(p => (p || []).map(g => g.id === gId ? { ...g, items: (g.items || []).map(it => it.id === iId ? { ...it, name: v } : it) } : g));
  const addGroup = () => { if (!newCat.trim()) return; setGroups(p => [...(p || []), { id: genId(), cat: newCat.trim(), items: [{ id: genId(), name: "" }] }]); setNewCat(""); };
  const rmGroup = (gId) => setGroups(p => (p || []).filter(g => g.id !== gId));
  const updCat = (gId, v) => setGroups(p => (p || []).map(g => g.id === gId ? { ...g, cat: v } : g));
  const totalItems = (groups || []).reduce((s, g) => s + (g.items || []).length, 0);
  const totalChecks = Object.values(checks || {}).filter(Boolean).length;
  const maxC = totalItems * Math.max(names.length, 1);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-gray-500">Packed: <span className="font-bold text-gray-900">{totalChecks}</span> / {maxC}</div>
          <div className="flex gap-2"><Inp value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category..." className="w-40" onKeyDown={e => e.key === "Enter" && addGroup()} /><BtnDark onClick={addGroup}>+ Category</BtnDark></div>
        </div>
        {totalItems > 0 && <div className="mt-3 bg-gray-100 rounded-full h-2 overflow-hidden"><div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: (totalChecks / Math.max(maxC, 1) * 100) + "%" }} /></div>}
      </Card>
      {(groups || []).map(g => (
        <Card key={g.id} className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
            <input value={g.cat || ""} onChange={e => updCat(g.id, e.target.value)} className="font-semibold text-sm text-gray-700 bg-transparent focus:outline-none focus:underline" />
            <div className="flex gap-2"><button onClick={() => addItem(g.id)} className="text-xs font-medium text-gray-600 bg-white border px-2.5 py-1 rounded-full">+ Item</button><button onClick={() => rmGroup(g.id)} className="text-xs text-gray-300 hover:text-red-500">Remove</button></div>
          </div>
          <div className="divide-y">{(g.items || []).map(item => (
            <div key={item.id} className="px-5 py-3 flex items-center gap-3">
              <input value={item.name || ""} onChange={e => updItem(g.id, item.id, e.target.value)} placeholder="Item..." className="text-sm text-gray-700 bg-transparent focus:outline-none focus:underline w-36 shrink-0" />
              <div className="flex gap-1.5 flex-wrap flex-1">{names.map(n => { const key = `${g.id}-${item.id}-${n}`; return <button key={n} onClick={() => toggle(key)} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${(checks || {})[key] ? "bg-emerald-100 text-emerald-700 border border-emerald-300" : "bg-gray-50 text-gray-400 border border-gray-200"}`}>{(checks || {})[key] ? "✓ " : ""}{n}</button>; })}</div>
              <button onClick={() => rmItem(g.id, item.id)} className="text-gray-200 hover:text-red-400 text-sm">×</button>
            </div>
          ))}</div>
        </Card>
      ))}
    </div>
  );
}

// ============ MAIN ============
export default function App() {
  const [activeTrip, setActiveTrip] = useState(null);

  // Auto-join from URL: yoursite.com?trip=ABC123
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tripCode = params.get("trip");
    if (tripCode) setActiveTrip(tripCode.toUpperCase());
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {activeTrip
        ? <TripView code={activeTrip} onBack={() => { setActiveTrip(null); window.history.replaceState({}, "", window.location.pathname); }} />
        : <Home onOpen={(code) => { setActiveTrip(code); window.history.replaceState({}, "", "?trip=" + code); }} />
      }
    </div>
  );
}