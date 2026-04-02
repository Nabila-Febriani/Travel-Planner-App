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
    ["Date", "Time", "Activity", "Location", "Category", "Est Cost", "Who", "Notes"],
    ...(itinerary || []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map(r => [r.date, r.time, r.activity, r.location, r.category, r.estCost || 0, r.assignedTo?.join(", "), r.notes])
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

  const copyCode = () => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const copyLink = () => { navigator.clipboard?.writeText(window.location.origin + "?trip=" + code); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (loading || !data) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-4xl animate-bounce">✈️</div></div>;

  const { setup = {}, itinerary = [], expenses = [], packing = [], packChecks = {} } = data;
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
        {tab === "debts" && <DebtsTab setup={setup} expenses={expenses} />}
        {tab === "packing" && <PackingTab names={names} groups={packing} setGroups={setPacking} checks={packChecks} setChecks={setPackChecks} />}
      </div>
    </div>
  );
}

// ============ DASHBOARD ============
function Dashboard({ setup, expenses = [], itinerary = [] }) {
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const dates = getDates(setup?.startDate, setup?.endDate);
  const totalBudget = (setup?.members || []).reduce((s, m) => s + (m.budget || 0), 0);
  const totalSpent = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const itinBudget = itinerary.reduce((s, r) => s + (r.estCost || 0), 0);
  const remaining = totalBudget - totalSpent;
  const pct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;

  const byCat = {}; CATS.forEach(c => byCat[c] = 0);
  expenses.forEach(e => byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0));
  const maxCat = Math.max(...Object.values(byCat), 1);

  const byDate = {}; dates.forEach(d => byDate[isoD(d)] = 0);
  expenses.forEach(e => { if (e.date) byDate[e.date] = (byDate[e.date] || 0) + (e.amount || 0); });
  const maxDay = Math.max(...Object.values(byDate), 1);

  const perMember = names.map(n => {
    const m = (setup.members || []).find(x => x.name === n);
    let spent = 0;
    expenses.forEach(e => { if (e.splitAmong?.includes(n) && e.splitAmong.length > 0) spent += (e.amount || 0) / e.splitAmong.length; });
    return { name: n, budget: m?.budget || 0, spent: Math.round(spent) };
  });
  const { settlements } = calcDebts(names, expenses);

  return (
    <div className="space-y-5">
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[{ e: "🧾", l: "Transactions", v: expenses.length }, { e: "📍", l: "Activities", v: itinerary.length }, { e: "💰", l: "Avg/Day", v: fmt(dates.length > 0 ? Math.round(totalSpent / dates.length) : 0) }, { e: "🗓️", l: "Est. Itin", v: fmt(itinBudget) }].map(s => (
          <Card key={s.l} className="p-4"><div className="flex items-center gap-2"><span className="text-lg">{s.e}</span><span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{s.l}</span></div><div className="text-xl font-bold text-gray-800 mt-1">{s.v}</div></Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">👥 Budget per Person</h3>
        <div className="space-y-3">{perMember.map(m => { const p = m.budget > 0 ? Math.min(m.spent / m.budget * 100, 100) : 0; return (
          <div key={m.name}><div className="flex justify-between text-sm mb-1"><span className="font-medium">{m.name}</span><span className={`text-xs ${m.budget - m.spent < 0 ? "text-red-500 font-semibold" : "text-gray-400"}`}>{fmt(m.spent)} / {fmt(m.budget)}</span></div><div className="bg-gray-100 rounded-full h-2.5 overflow-hidden"><div className={`h-full rounded-full transition-all ${p > 90 ? "bg-red-400" : p > 70 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: p + "%" }} /></div></div>
        ); })}</div>
      </Card>

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
  const uM = (i, k, v) => setSetup(p => { const m = [...(p.members || [])]; m[i] = { ...m[i], [k]: k === "budget" ? Number(v) || 0 : v }; return { ...p, members: m }; });
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
        <div className="flex gap-2 items-center"><Inp type="number" placeholder="Set all budgets" className="flex-1" onChange={e => applyB(e.target.value)} /><span className="text-xs text-gray-400 shrink-0">Apply all</span></div>
        <div className="space-y-2">{(setup?.members || []).map((m, i) => (
          <div key={m.id || i} className="flex gap-2 items-center bg-gray-50 p-2 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{(m.name || "?")[0].toUpperCase()}</div>
            <Inp value={m.name || ""} onChange={e => uM(i, "name", e.target.value)} placeholder="Name" className="flex-1" />
            <Inp type="number" value={m.budget || ""} onChange={e => uM(i, "budget", e.target.value)} placeholder="Budget" className="w-32" />
            {(setup?.members || []).length > 1 && <button onClick={() => rmM(i)} className="text-gray-300 hover:text-red-500 text-lg">×</button>}
          </div>
        ))}</div>
      </Card>
    </div>
  );
}

// ============ ITINERARY ============
function ItineraryTab({ setup, items = [], setItems }) {
  const dates = getDates(setup?.startDate, setup?.endDate);
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const [fp, setFp] = useState("__all__");
  const add = (d) => setItems(p => [...(p || []), { id: genId(), date: isoD(d), time: "09:00", activity: "", location: "", assignedTo: [...names], notes: "", estCost: 0, category: "Activities" }]);
  const rm = (id) => setItems(p => (p || []).filter(r => r.id !== id));
  const upd = (id, k, v) => setItems(p => (p || []).map(r => r.id === id ? { ...r, [k]: k === "estCost" ? Number(v) || 0 : v } : r));
  const togA = (id, n) => setItems(p => (p || []).map(r => r.id !== id ? r : { ...r, assignedTo: r.assignedTo?.includes(n) ? r.assignedTo.filter(x => x !== n) : [...(r.assignedTo || []), n] }));
  const fil = (rows) => fp === "__all__" ? rows : rows.filter(r => r.assignedTo?.includes(fp));
  const totalC = (items || []).reduce((s, r) => s + (r.estCost || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-4"><div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-400 font-medium">View:</span>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFp("__all__")} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${fp === "__all__" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>Everyone</button>
          {names.map(n => <button key={n} onClick={() => setFp(n)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${fp === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>{n}</button>)}
        </div>
        <div className="ml-auto text-xs text-gray-400">Est: <span className="font-bold text-gray-700">{fmt(totalC)}</span></div>
      </div></Card>

      {dates.map(d => {
        const ds = isoD(d), all = (items || []).filter(r => r.date === ds).sort((a, b) => (a.time || "").localeCompare(b.time || "")), rows = fil(all);
        const dayB = all.reduce((s, r) => s + (r.estCost || 0), 0);
        return (
          <Card key={ds} className="overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3 bg-gray-50 border-b">
              <div className="flex items-center gap-3"><span className="font-semibold text-sm text-gray-800">{fmtD(d)}</span><span className="text-xs text-gray-400">{rows.length} act.</span>{dayB > 0 && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{fmt(dayB)}</span>}</div>
              <button onClick={() => add(d)} className="text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border px-3 py-1 rounded-full">+</button>
            </div>
            {rows.length === 0 && <p className="p-5 text-sm text-gray-300 italic text-center">{fp !== "__all__" ? `No activities for ${fp}` : "Tap + to add"}</p>}
            <div className="divide-y">{rows.map(r => (
              <div key={r.id} className="p-4 space-y-2">
                <div className="flex gap-2 items-center flex-wrap">
                  <Inp type="time" value={r.time || ""} onChange={e => upd(r.id, "time", e.target.value)} className="w-24" />
                  <Inp value={r.activity || ""} onChange={e => upd(r.id, "activity", e.target.value)} placeholder="Activity" className="flex-1 min-w-[120px]" />
                  <Inp value={r.location || ""} onChange={e => upd(r.id, "location", e.target.value)} placeholder="📍 Location" className="flex-1 min-w-[100px]" />
                  <button onClick={() => rm(r.id)} className="text-gray-300 hover:text-red-400 text-lg">×</button>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <Sel value={r.category || "Other"} onChange={e => upd(r.id, "category", e.target.value)} className="w-32">{CATS.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}</Sel>
                  <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl px-2"><span className="text-xs text-gray-400">Rp</span><input type="number" value={r.estCost || ""} onChange={e => upd(r.id, "estCost", e.target.value)} placeholder="0" className="bg-transparent py-2 text-sm w-24 focus:outline-none" /></div>
                  <div className="flex gap-1.5 flex-wrap items-center ml-1"><span className="text-xs text-gray-400">Who:</span>{names.map(n => <button key={n} onClick={() => togA(r.id, n)} className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${r.assignedTo?.includes(n) ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400"}`}>{n}</button>)}</div>
                </div>
                <Inp value={r.notes || ""} onChange={e => upd(r.id, "notes", e.target.value)} placeholder="Notes..." className="w-full text-xs" />
              </div>
            ))}</div>
          </Card>
        );
      })}
    </div>
  );
}

// ============ EXPENSES ============
function ExpensesTab({ setup, expenses = [], setExpenses }) {
  const dates = getDates(setup?.startDate, setup?.endDate);
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const add = () => setExpenses(p => [...(p || []), { id: genId(), date: dates[0] ? isoD(dates[0]) : "", description: "", category: "Food", amount: 0, paidBy: names[0] || "", splitAmong: [...names] }]);
  const rm = (id) => setExpenses(p => (p || []).filter(e => e.id !== id));
  const upd = (id, k, v) => setExpenses(p => (p || []).map(e => e.id === id ? { ...e, [k]: k === "amount" ? Number(v) || 0 : v } : e));
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
            <Inp type="number" value={ex.amount || ""} onChange={e => upd(ex.id, "amount", e.target.value)} placeholder="Amount" className="w-28 text-right font-semibold" />
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
function DebtsTab({ setup, expenses = [] }) {
  const names = (setup?.members || []).map(m => m.name).filter(Boolean);
  const { bal, totalPaid, settlements } = calcDebts(names, expenses);
  return (
    <div className="space-y-5">
      <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">💰 Balance</h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{names.map(n => { const b = Math.round(bal[n] || 0); return (
        <div key={n} className={`rounded-xl p-3 border ${b > 0 ? "bg-emerald-50 border-emerald-200" : b < 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <div className="flex items-center gap-2 mb-1"><div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">{n[0]}</div><span className="text-sm font-medium">{n}</span></div>
          <div className={`text-lg font-bold ${b > 0 ? "text-emerald-600" : b < 0 ? "text-red-500" : "text-gray-400"}`}>{b > 0 ? "+" : ""}{fmt(b)}</div>
          <div className="text-xs text-gray-400 mt-0.5">Paid: {fmt(Math.round(totalPaid[n] || 0))}</div>
        </div>); })}</div></Card>
      <Card className="p-5"><h3 className="text-sm font-semibold text-gray-700 mb-4">🤝 Who Pays Whom</h3>{settlements.length === 0 ? <div className="text-center py-6"><div className="text-3xl mb-2">✅</div><p className="text-sm text-gray-400">Everyone settled!</p></div> : <div className="space-y-3">{settlements.map((s, i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-red-50 via-white to-emerald-50 border">
          <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">{s.from[0]}</div><span className="font-semibold text-sm text-red-700">{s.from}</span></div>
          <div className="flex-1 flex items-center gap-2"><div className="flex-1 border-t-2 border-dashed border-gray-200" /><div className="bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-bold">{fmt(s.amt)}</div><div className="flex-1 border-t-2 border-dashed border-gray-200" /><span className="text-gray-400">→</span></div>
          <div className="flex items-center gap-2"><span className="font-semibold text-sm text-emerald-700">{s.to}</span><div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">{s.to[0]}</div></div>
        </div>))}</div>}</Card>
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