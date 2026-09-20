import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ── localStorage hook ──────────────────────────────────────────────────────

function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setInner] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  const set: React.Dispatch<React.SetStateAction<T>> = useCallback((action) => {
    setInner(prev => {
      const next = typeof action === "function" ? (action as (p: T) => T)(prev) : action;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [value, set];
}

// ── constants ──────────────────────────────────────────────────────────────

const DAY_SHORT   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAY_FULL    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SLOTS     = Array.from({ length: 30 }, (_, i) => 7 + i * 0.5);
const SLOT_PX   = 28;
const TABS      = ["schedule","budget","notes","weather","study"] as const;
const EVENT_COLORS = ["#4ade80","#22d3ee","#a78bfa","#fb923c","#f472b6","#facc15"];
const STARS = [[18,12],[52,22],[94,7],[142,17],[183,5],[228,14],[272,21],[301,9],[313,29],[38,34],[168,28],[255,8]] as const;

const BUDGET_CATEGORIES = [
  { id:"groceries",     label:"Groceries",     color:"#4ade80" },
  { id:"transport",     label:"Transport",     color:"#22d3ee" },
  { id:"dining",        label:"Dining",        color:"#a78bfa" },
  { id:"utilities",     label:"Utilities",     color:"#fb923c" },
  { id:"entertainment", label:"Entertainment", color:"#f472b6" },
  { id:"other",         label:"Other",         color:"#71717a" },
];

const RELATION_OPTIONS = ["Friend","Family","Colleague","Classmate","Partner","Other"];

// ── types ──────────────────────────────────────────────────────────────────

type RepeatMode = "none"|"daily"|"weekdays"|"weekly"|"custom";
type Tab = typeof TABS[number];

type CalEvent = {
  id:string; title:string; day:number; startHour:number;
  duration:number; color:string; repeat:RepeatMode; repeatDays?:number[];
  description?:string;
};

type BudgetItem = { id:string; category:string; label:string; amount:number; type:"income"|"expense" };
type Note       = { id:string; text:string; pinned:boolean; createdAt:string };
type Contact    = { id:string; name:string; email:string; phone:string; relation:string };
type StudySession = { id:string; date:string; minutes:number };

// ── study helpers ──────────────────────────────────────────────────────────

interface SisyData { netPts:number; cycles:number; pos:number; pct:number; penalties:number; }

function todayISO() { return new Date().toISOString().split("T")[0]; }

function studyHeatColor(min: number): string {
  if (min === 0) return "#111111";
  if (min < 30)  return "#14532d";
  if (min < 60)  return "#166534";
  return "#4ade80";
}

function computeSisy(sessions: StudySession[]): SisyData {
  const GOAL = 100;
  const byDate = new Map<string,number>();
  sessions.forEach(s => byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.minutes));
  const sorted = [...byDate.keys()].sort();

  let raw = 0;
  byDate.forEach(m => { raw += m >= 60 ? 50 : m >= 30 ? 25 : m >= 15 ? 10 : 0; });

  let penalties = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((+new Date(sorted[i]) - +new Date(sorted[i-1])) / 86400000) - 1;
    if (gap > 0) penalties += gap * 15;
  }
  if (sorted.length > 0 && sorted[sorted.length-1] !== todayISO()) {
    const gap = Math.round((+new Date(todayISO()) - +new Date(sorted[sorted.length-1])) / 86400000) - 1;
    if (gap > 0) penalties += gap * 15;
  }

  const net = Math.max(0, raw - penalties);
  return { netPts: net, cycles: Math.floor(net / GOAL), pos: net % GOAL, pct: (net % GOAL) / GOAL, penalties };
}

function computeStreak(sessions: StudySession[]): number {
  const dates = new Set(sessions.map(s => s.date));
  let streak = 0;
  for (let d = 0; d < 365; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    if (dates.has(dt.toISOString().split("T")[0])) streak++;
    else break;
  }
  return streak;
}

// ── weather helpers ────────────────────────────────────────────────────────

type WeatherState = { status:"idle"|"loading"|"error"|"ok"; error?:string; city?:string; current?:CurrentWeather; daily?:DailyWeather[] };
type CurrentWeather = { temp:number; feels:number; humidity:number; wind:number; code:number; isDay:number };
type DailyWeather   = { date:string; high:number; low:number; code:number; precip:number };

function wmoLabel(code: number): string {
  if(code===0) return "Clear";
  if(code<=2)  return "Partly cloudy";
  if(code===3) return "Overcast";
  if(code<=49) return "Fog";
  if(code<=57) return "Drizzle";
  if(code<=67) return "Rain";
  if(code<=77) return "Snow";
  if(code<=82) return "Showers";
  if(code<=86) return "Snow showers";
  return "Thunderstorm";
}

function wmoIcon(code: number, isDay=1): string {
  if(code===0) return isDay ? "☀️" : "🌙";
  if(code<=2)  return isDay ? "⛅" : "🌤️";
  if(code===3) return "☁️";
  if(code<=49) return "🌫️";
  if(code<=57) return "🌦️";
  if(code<=67) return "🌧️";
  if(code<=77) return "❄️";
  if(code<=82) return "🌧️";
  if(code<=86) return "🌨️";
  return "⛈️";
}

// ── schedule helpers ───────────────────────────────────────────────────────

const REPEAT_LABELS: Record<RepeatMode,string> = {
  none:"Does not repeat", daily:"Every day",
  weekdays:"Weekdays (Mon–Fri)", weekly:"Weekly", custom:"Custom days",
};

function getEventDays(e: CalEvent): number[] {
  switch(e.repeat){
    case "daily":    return [0,1,2,3,4,5,6];
    case "weekdays": return [0,1,2,3,4];
    case "custom":   return e.repeatDays ?? [e.day];
    default:         return [e.day];
  }
}

function countOnDay(events: CalEvent[], dow: number) {
  return events.filter(e => getEventDays(e).includes(dow)).length;
}

function heatColor(count: number): string {
  if(count===0) return "var(--heat-0)";
  if(count===1) return "var(--heat-1)";
  if(count===2) return "var(--heat-2)";
  return "var(--heat-4)";
}

function fmtHour(h: number) {
  const hour = Math.floor(h);
  const mins = h % 1 === 0.5 ? "30" : "00";
  if (hour < 12) return `${String(hour).padStart(2,"0")}:${mins}`;
  if (hour === 12) return `12:${mins}`;
  return `${String(hour-12).padStart(2,"0")}:${mins}`;
}

function weekMonday(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow===0 ? -6 : 1-dow));
  d.setHours(0,0,0,0);
  return d;
}

// ── version / seed data ────────────────────────────────────────────────────

const LS_VERSION = "2";
if (localStorage.getItem("wp:version") !== LS_VERSION) {
  ["wp:events","wp:budget","wp:notes","wp:contacts","wp:tab","wp:monthOffset"].forEach(k => localStorage.removeItem(k));
  localStorage.setItem("wp:version", LS_VERSION);
}

const initialEvents: CalEvent[]   = [];
const initialBudget: BudgetItem[] = [];
const initialNotes:  Note[]       = [];
const initialContacts: Contact[]  = [];

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab,   setActiveTab]  = useLocalStorage<Tab>("wp:tab", "schedule");
  const [slideDir,    setSlideDir]   = useState<"left"|"right">("right");
  const [tabKey,      setTabKey]     = useState(0);

  const changeTab = (newTab: Tab) => {
    if(newTab === activeTab) return;
    setSlideDir(TABS.indexOf(newTab) > TABS.indexOf(activeTab) ? "right" : "left");
    setTabKey(k => k + 1);
    setActiveTab(newTab);
  };

  const [events,      setEvents]     = useLocalStorage<CalEvent[]>("wp:events", initialEvents);
  const [budget,      setBudget]     = useLocalStorage<BudgetItem[]>("wp:budget", initialBudget);
  const [notes,       setNotes]      = useLocalStorage<Note[]>("wp:notes", initialNotes);
  const [contacts,    setContacts]   = useLocalStorage<Contact[]>("wp:contacts", initialContacts);
  const [monthOffset, setMonthOffset]= useLocalStorage<number>("wp:monthOffset", 0);
  const [zoomedWeek,  setZoomedWeek] = useState<Date|null>(null);

  // study
  const [studySessions, setStudySessions] = useLocalStorage<StudySession[]>("wp:study", []);
  const [timerRunning,  setTimerRunning]  = useState(false);
  const [timerElapsed,  setTimerElapsed]  = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(() => {
    if (timerRunning) {
      timerIntervalRef.current = setInterval(() => setTimerElapsed(e => e + 1), 1000);
    } else {
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [timerRunning]);

  // event form
  const [showForm,    setShowForm]   = useState(false);
  const [editingId,   setEditingId]  = useState<string|null>(null);
  const [newEvent,    setNewEvent]   = useState<{ title:string; day:number; startHour:number; duration:number; color:string; repeat:RepeatMode; repeatDays:number[]; description:string }>(
    { title:"", day:0, startHour:9, duration:1, color:EVENT_COLORS[0], repeat:"none", repeatDays:[], description:"" }
  );

  const [popupEvent,  setPopupEvent]  = useState<CalEvent|null>(null);
  const [ctxEvent,    setCtxEvent]    = useState<CalEvent|null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  function startLongPress(ev: CalEvent) {
    longPressTimer.current = setTimeout(() => { longPressTimer.current = null; setCtxEvent(ev); }, 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }
  function handleEventTap(ev: CalEvent) {
    if (longPressTimer.current !== null) { cancelLongPress(); setPopupEvent(ev); }
  }
  function openEdit(ev: CalEvent) {
    setCtxEvent(null);
    setEditingId(ev.id);
    setNewEvent({ title:ev.title, day:ev.day, startHour:ev.startHour, duration:ev.duration, color:ev.color, repeat:ev.repeat, repeatDays:ev.repeatDays??[], description:ev.description??"" });
    setShowForm(true);
  }

  // budget form
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [newBudgetItem,  setNewBudgetItem]  = useState<{ label:string; category:string; amount:string; type:"income"|"expense" }>(
    { label:"", category:"groceries", amount:"", type:"expense" }
  );

  // notes
  const [newNoteText, setNewNoteText] = useState("");

  // contacts
  const [showContactForm, setShowContactForm] = useState(false);
  const [newContact, setNewContact] = useState<{ name:string; email:string; phone:string; relation:string }>(
    { name:"", email:"", phone:"", relation:"Friend" }
  );
  const [expandedContact, setExpandedContact] = useState<string|null>(null);

  // weather
  const [weather, setWeather] = useState<WeatherState>({ status:"idle" });
  const weatherFetchedRef = useRef(false);

  useEffect(() => {
    if(activeTab !== "weather") return;
    if(weatherFetchedRef.current) return;
    weatherFetchedRef.current = true;
    setWeather({ status:"loading" });
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { latitude: lat, longitude: lon } = coords;
          const [wxRes, geoRes] = await Promise.all([
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto&forecast_days=7`),
            fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`),
          ]);
          const wx  = await wxRes.json();
          const geo = await geoRes.json();
          const city = geo.address?.city || geo.address?.town || geo.address?.village || geo.address?.county || "Your location";
          const c = wx.current;
          setWeather({ status:"ok", city, current:{ temp:Math.round(c.temperature_2m), feels:Math.round(c.apparent_temperature), humidity:c.relative_humidity_2m, wind:Math.round(c.wind_speed_10m), code:c.weather_code, isDay:c.is_day }, daily:wx.daily.time.map((date:string,i:number)=>({ date, high:Math.round(wx.daily.temperature_2m_max[i]), low:Math.round(wx.daily.temperature_2m_min[i]), code:wx.daily.weather_code[i], precip:wx.daily.precipitation_sum[i] })) });
        } catch { setWeather({ status:"error", error:"Failed to load weather data." }); }
      },
      () => setWeather({ status:"error", error:"Location access denied." })
    );
  }, [activeTab, weather.status]);

  // swipe
  const swipeRef = useRef<{ x:number; y:number }|null>(null);
  function onTouchStart(e: React.TouchEvent) { swipeRef.current = { x:e.touches[0].clientX, y:e.touches[0].clientY }; }
  function onTouchEnd(e: React.TouchEvent) {
    if (!swipeRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeRef.current.y;
    swipeRef.current = null;
    if (zoomedWeek) return;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    const idx = TABS.indexOf(activeTab);
    if (dx < 0 && idx < TABS.length - 1) changeTab(TABS[idx + 1]);
    if (dx > 0 && idx > 0)               changeTab(TABS[idx - 1]);
  }

  // ── derived ──────────────────────────────────────────────────────────────

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const displayMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1), [monthOffset, today]);

  const monthSquares = useMemo(() => {
    const year = displayMonth.getFullYear(), month = displayMonth.getMonth();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay();
    const offset = firstDow === 0 ? 6 : firstDow - 1;
    const sq: Array<{ date:Date; dow:number }|null> = [];
    for(let i=0;i<offset;i++) sq.push(null);
    for(let d=1;d<=daysInMonth;d++){
      const date = new Date(year,month,d);
      sq.push({ date, dow: date.getDay()===0 ? 6 : date.getDay()-1 });
    }
    return sq;
  }, [displayMonth]);

  const zoomedWeekDays = useMemo(() => {
    if(!zoomedWeek) return [];
    return DAY_SHORT.map((_,i) => {
      const date = new Date(zoomedWeek); date.setDate(zoomedWeek.getDate()+i);
      return { date, dow:i, events:events.filter(e=>getEventDays(e).includes(i)) };
    });
  }, [zoomedWeek, events]);

  const income   = budget.filter(b=>b.type==="income").reduce((s,b)=>s+b.amount,0);
  const expenses = budget.filter(b=>b.type==="expense").reduce((s,b)=>s+b.amount,0);
  const balance  = income - expenses;
  const sortedNotes = [...notes].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));

  // ── handlers ─────────────────────────────────────────────────────────────

  const resetForm = () => { setNewEvent({ title:"", day:0, startHour:9, duration:1, color:EVENT_COLORS[0], repeat:"none", repeatDays:[], description:"" }); setEditingId(null); setShowForm(false); };

  const addEvent = () => {
    if(!newEvent.title.trim()) return;
    const repeatDays = newEvent.repeat==="custom" ? (newEvent.repeatDays.length>0 ? newEvent.repeatDays : [newEvent.day]) : undefined;
    const built: CalEvent = { ...newEvent, repeatDays, id: editingId ?? Date.now().toString() };
    setEvents(editingId ? events.map(e=>e.id===editingId?built:e) : [...events,built]);
    resetForm();
  };

  const toggleCustomDay = (d:number) => setNewEvent(e=>({ ...e, repeatDays:e.repeatDays.includes(d)?e.repeatDays.filter(x=>x!==d):[...e.repeatDays,d] }));

  const addBudgetItem = () => {
    if(!newBudgetItem.label.trim()||!newBudgetItem.amount) return;
    setBudget([...budget, { ...newBudgetItem, id:Date.now().toString(), amount:parseFloat(newBudgetItem.amount) }]);
    setNewBudgetItem({ label:"", category:"groceries", amount:"", type:"expense" });
    setShowBudgetForm(false);
  };

  const addNote = () => {
    if(!newNoteText.trim()) return;
    const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    setNotes([{ id:Date.now().toString(), text:newNoteText, pinned:false, createdAt:days[new Date().getDay()] },...notes]);
    setNewNoteText("");
  };

  const removeNote  = (id:string) => setNotes(notes.filter(n=>n.id!==id));
  const togglePin   = (id:string) => setNotes(notes.map(n=>n.id===id?{...n,pinned:!n.pinned}:n));

  const addContact = () => {
    if(!newContact.name.trim()) return;
    setContacts([...contacts,{...newContact,id:Date.now().toString()}]);
    setNewContact({ name:"", email:"", phone:"", relation:"Friend" });
    setShowContactForm(false);
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background:"var(--background)", color:"var(--foreground)", fontFamily:"var(--font-body)" }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

      {/* Header */}
      <header style={{ borderBottom:"1px solid var(--border)" }} className="px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-sm font-semibold tracking-tight">WEEKLY_PLANNER</span>
          <span className="text-[9px]" style={{ color:"var(--muted-foreground)" }}>v1.0</span>
        </div>
        <div className="flex items-center gap-0" style={{ display:"inline-flex", border:"1px solid var(--border)", borderRadius:"var(--radius)" }}>
          {TABS.map((t,i,arr)=>(
            <button key={t} onClick={()=>changeTab(t)} className="px-3 py-1 text-[10px] uppercase tracking-widest transition-colors"
              style={{ background:activeTab===t?"var(--primary)":"transparent", color:activeTab===t?"var(--primary-foreground)":"var(--muted-foreground)", borderRight:i<arr.length-1?"1px solid var(--border)":"none", cursor:"pointer" }}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 mt-2 ml-0.5">
          {TABS.map(t=>(
            <div key={t} className="rounded-full transition-all"
              style={{ width:activeTab===t?"14px":"4px", height:"4px", background:activeTab===t?"var(--primary)":"var(--border)" }}/>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6" style={{ overflow:"hidden" }}>
        <div key={tabKey} className={slideDir==="right"?"tab-slide-right":"tab-slide-left"}>

        {/* ══ SCHEDULE ══ */}
        {activeTab === "schedule" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                {zoomedWeek ? (
                  <>
                    <button onClick={()=>setZoomedWeek(null)} className="text-[10px] px-3 py-1" style={{ border:"1px solid var(--border)", color:"var(--primary)", borderRadius:"var(--radius)", cursor:"pointer" }}>← month</button>
                    <span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>
                      {zoomedWeek.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {new Date(zoomedWeek.getTime()+6*86400000).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                    </span>
                  </>
                ) : (
                  <>
                    <button onClick={()=>setMonthOffset(m=>m-1)} className="w-6 h-6 flex items-center justify-center text-xs" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", color:"var(--muted-foreground)", cursor:"pointer" }}>←</button>
                    <span className="text-xs font-medium" style={{ minWidth:"130px", textAlign:"center" }}>{MONTH_NAMES[displayMonth.getMonth()]} {displayMonth.getFullYear()}</span>
                    <button onClick={()=>setMonthOffset(m=>m+1)} className="w-6 h-6 flex items-center justify-center text-xs" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", color:"var(--muted-foreground)", cursor:"pointer" }}>→</button>
                    <button onClick={()=>setMonthOffset(0)} className="text-[10px] px-2 py-1 ml-1" style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>today</button>
                  </>
                )}
              </div>
              <button onClick={()=>{ if(showForm) resetForm(); else setShowForm(true); }} className="text-[10px] px-3 py-1.5 font-medium"
                style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>+ ADD_EVENT</button>
            </div>

            {showForm && (
              <div className="mb-5 p-4" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                <div className="text-[10px] mb-3" style={{ color:"var(--primary)", letterSpacing:"0.1em" }}>{editingId?"EDIT_EVENT":"NEW_EVENT"}</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <input className="col-span-2 text-xs px-3 py-2" placeholder="event title" value={newEvent.title} onChange={e=>setNewEvent({...newEvent,title:e.target.value})} onKeyDown={e=>e.key==="Enter"&&addEvent()}/>
                  <textarea className="col-span-2 text-xs px-3 py-2 resize-none" rows={2} placeholder="description (optional)" value={newEvent.description} onChange={e=>setNewEvent({...newEvent,description:e.target.value})}/>
                  <select className="text-xs px-3 py-2" value={newEvent.day} onChange={e=>setNewEvent({...newEvent,day:+e.target.value})}>{DAY_FULL.map((d,i)=><option key={d} value={i}>{d}</option>)}</select>
                  <select className="text-xs px-3 py-2" value={newEvent.startHour} onChange={e=>setNewEvent({...newEvent,startHour:+e.target.value})}>{SLOTS.map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}</select>
                  <select className="text-xs px-3 py-2" value={newEvent.duration} onChange={e=>setNewEvent({...newEvent,duration:+e.target.value})}>
                    {[0.5,1,1.5,2,2.5,3,3.5,4].map(d=><option key={d} value={d}>{d<1?"30 min":d===1?"1 hr":`${d} hrs`}</option>)}
                  </select>
                  <select className="text-xs px-3 py-2" value={newEvent.repeat} onChange={e=>setNewEvent({...newEvent,repeat:e.target.value as RepeatMode,repeatDays:[]})}>
                    {(Object.keys(REPEAT_LABELS) as RepeatMode[]).map(k=><option key={k} value={k}>{REPEAT_LABELS[k]}</option>)}
                  </select>
                  {newEvent.repeat==="custom" && (
                    <div className="col-span-2 flex gap-1">
                      {DAY_SHORT.map((d,i)=>(
                        <button key={d} type="button" onClick={()=>toggleCustomDay(i)} className="flex-1 py-1 text-[10px] transition-colors"
                          style={{ background:newEvent.repeatDays.includes(i)?"var(--primary)":"var(--muted)", color:newEvent.repeatDays.includes(i)?"var(--primary-foreground)":"var(--muted-foreground)", border:"1px solid var(--border)", borderRadius:"var(--radius)", cursor:"pointer" }}>
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="col-span-2 flex items-center gap-2">
                    <span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>color:</span>
                    {EVENT_COLORS.map(c=>(
                      <button key={c} onClick={()=>setNewEvent({...newEvent,color:c})} className="w-4 h-4 rounded-sm transition-transform"
                        style={{ background:c, transform:newEvent.color===c?"scale(1.3)":"scale(1)", outline:newEvent.color===c?`2px solid ${c}`:undefined, outlineOffset:"2px", cursor:"pointer" }}/>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={addEvent} className="text-[10px] px-3 py-1.5" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>{editingId?"SAVE":"ADD"}</button>
                  <button onClick={resetForm} className="text-[10px] px-3 py-1.5" style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>CANCEL</button>
                </div>
              </div>
            )}

            {!zoomedWeek && (
              <div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAY_SHORT.map(d=><div key={d} className="text-center text-[10px] py-1" style={{ color:"var(--muted-foreground)", letterSpacing:"0.08em" }}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthSquares.map((sq,idx)=>{
                    if(!sq) return <div key={`b${idx}`}/>;
                    const count=countOnDay(events,sq.dow);
                    const isToday=sq.date.getTime()===today.getTime();
                    return (
                      <button key={sq.date.toISOString()} onClick={()=>setZoomedWeek(weekMonday(sq.date))}
                        className="heat-sq flex flex-col items-start p-1.5"
                        style={{ background:heatColor(count), border:isToday?"1px solid var(--primary)":"1px solid transparent", borderRadius:"var(--radius)", aspectRatio:"1", cursor:"pointer" }}>
                        <span className="text-[11px] leading-none font-medium" style={{ color:count>0?"#e2e2e2":"var(--muted-foreground)" }}>{sq.date.getDate()}</span>
                        {count>0&&<span className="text-[9px] leading-none mt-auto opacity-70" style={{ color:"#e2e2e2" }}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>events:</span>
                  {[{l:"0",c:"var(--heat-0)"},{l:"1",c:"var(--heat-1)"},{l:"2",c:"var(--heat-2)"},{l:"3+",c:"var(--heat-4)"}].map(x=>(
                    <div key={x.l} className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm" style={{ background:x.c, border:"1px solid var(--border)" }}/>
                      <span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>{x.l}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <div className="text-[10px] mb-3" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>ALL_EVENTS</div>
                  <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
                    {events.map((ev,i,arr)=>(
                      <div key={ev.id} className="flex items-center gap-3 px-4 py-2.5 group transition-colors hover:bg-[#1a1a1a] select-none"
                        style={{ borderBottom:i<arr.length-1?"1px solid var(--border)":"none", cursor:"pointer" }}
                        onPointerDown={()=>startLongPress(ev)} onPointerUp={()=>handleEventTap(ev)} onPointerLeave={cancelLongPress} onContextMenu={e=>{e.preventDefault();setCtxEvent(ev);}}>
                        <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background:ev.color }}/>
                        <span className="text-xs flex-1">{ev.title}</span>
                        <span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>{fmtHour(ev.startHour)}</span>
                        <span className="text-[10px]" style={{ color:ev.color, opacity:0.7 }}>{ev.repeat!=="none"?`↻ ${REPEAT_LABELS[ev.repeat]}`:DAY_SHORT[ev.day]}</span>
                      </div>
                    ))}
                    {events.length===0&&<div className="px-4 py-3 text-xs" style={{ color:"var(--muted-foreground)" }}>no events</div>}
                  </div>
                </div>

                {/* contacts */}
                <div className="mt-8">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px]" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>CONTACTS</div>
                    <button onClick={()=>setShowContactForm(!showContactForm)} className="text-[10px] px-3 py-1.5"
                      style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>+ ADD</button>
                  </div>
                  {showContactForm && (
                    <div className="mb-4 p-4" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                      <div className="text-[10px] mb-3" style={{ color:"var(--primary)", letterSpacing:"0.1em" }}>NEW_CONTACT</div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <input className="col-span-2 text-xs px-3 py-2" placeholder="full name" value={newContact.name} onChange={e=>setNewContact({...newContact,name:e.target.value})}/>
                        <input className="text-xs px-3 py-2" placeholder="email" type="email" value={newContact.email} onChange={e=>setNewContact({...newContact,email:e.target.value})}/>
                        <input className="text-xs px-3 py-2" placeholder="phone" type="tel" value={newContact.phone} onChange={e=>setNewContact({...newContact,phone:e.target.value})}/>
                        <select className="col-span-2 text-xs px-3 py-2" value={newContact.relation} onChange={e=>setNewContact({...newContact,relation:e.target.value})}>
                          {RELATION_OPTIONS.map(r=><option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={addContact} className="text-[10px] px-3 py-1.5" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>ADD</button>
                        <button onClick={()=>setShowContactForm(false)} className="text-[10px] px-3 py-1.5" style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>CANCEL</button>
                      </div>
                    </div>
                  )}
                  <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
                    {contacts.map((c,i,arr)=>(
                      <div key={c.id}>
                        <div className="flex items-center group transition-colors hover:bg-[#1a1a1a]"
                          style={{ borderBottom:expandedContact===c.id||i<arr.length-1?"1px solid var(--border)":"none" }}>
                          <button className="flex items-center gap-3 px-4 py-3 text-left flex-1 min-w-0" onClick={()=>setExpandedContact(expandedContact===c.id?null:c.id)}>
                            <div className="w-7 h-7 flex items-center justify-center flex-shrink-0 text-[10px] font-semibold" style={{ background:"var(--muted)", borderRadius:"var(--radius)", color:"var(--primary)" }}>{c.name.charAt(0).toUpperCase()}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs">{c.name}</div>
                              <div className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>{c.relation}</div>
                            </div>
                            <span className="text-[10px] transition-transform mr-2" style={{ color:"var(--muted-foreground)", transform:expandedContact===c.id?"rotate(180deg)":"none", display:"inline-block" }}>▾</span>
                          </button>
                          <button onClick={()=>setContacts(contacts.filter(x=>x.id!==c.id))} className="opacity-0 group-hover:opacity-100 text-xs transition-opacity pr-4" style={{ color:"var(--muted-foreground)", cursor:"pointer" }}>×</button>
                        </div>
                        {expandedContact===c.id&&(
                          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5" style={{ background:"var(--muted)", borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
                            <div><div className="text-[9px] mb-0.5" style={{ color:"var(--muted-foreground)", letterSpacing:"0.12em" }}>EMAIL</div><div className="text-[11px]">{c.email||"—"}</div></div>
                            <div><div className="text-[9px] mb-0.5" style={{ color:"var(--muted-foreground)", letterSpacing:"0.12em" }}>PHONE</div><div className="text-[11px]">{c.phone||"—"}</div></div>
                          </div>
                        )}
                      </div>
                    ))}
                    {contacts.length===0&&<div className="px-4 py-3 text-xs" style={{ color:"var(--muted-foreground)" }}>no contacts</div>}
                  </div>
                </div>
              </div>
            )}

            {zoomedWeek && (
              <div className="zoom-in">
                <div className="grid gap-1 mb-2" style={{ gridTemplateColumns:"48px repeat(7,1fr)" }}>
                  <div/>
                  {zoomedWeekDays.map(({ date, dow, events:dayEvts })=>{
                    const count=dayEvts.length, isToday=date.getTime()===today.getTime();
                    return (
                      <div key={dow} className="flex flex-col items-center gap-1 pb-2">
                        <span className="text-[10px]" style={{ color:"var(--muted-foreground)", letterSpacing:"0.08em" }}>{DAY_SHORT[dow]}</span>
                        <div className="w-7 h-7 flex items-center justify-center text-xs font-medium rounded-sm" style={{ background:heatColor(count), color:count>0?"#e2e2e2":"var(--muted-foreground)", border:isToday?"1px solid var(--primary)":"1px solid transparent" }}>{date.getDate()}</div>
                        <span className="text-[9px]" style={{ color:"var(--muted-foreground)" }}>{count>0?`${count}ev`:""}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
                  {SLOTS.map((slot,si)=>(
                    <div key={slot} className="grid" style={{ gridTemplateColumns:"48px repeat(7,1fr)", borderBottom:si<SLOTS.length-1?`1px solid ${slot%1===0?"var(--border)":"rgba(255,255,255,0.04)"}`:undefined }}>
                      <div className="text-right pr-2 flex items-start pt-1" style={{ color:"var(--muted-foreground)", height:`${SLOT_PX}px` }}>
                        {slot%1===0&&<span className="text-[9px]">{fmtHour(slot)}</span>}
                      </div>
                      {zoomedWeekDays.map(({ dow, events:dayEvts })=>{
                        const cellEvts=dayEvts.filter(e=>e.startHour===slot);
                        return (
                          <div key={dow} className="relative" style={{ height:`${SLOT_PX}px`, borderLeft:"1px solid var(--border)" }}>
                            {cellEvts.map(ev=>(
                              <div key={ev.id} className="absolute inset-x-0 mx-0.5 text-[10px] font-medium px-1.5 py-1 overflow-hidden select-none"
                                style={{ background:ev.color+"18", borderLeft:`2px solid ${ev.color}`, color:ev.color, top:2, height:`${ev.duration*SLOT_PX*2-4}px`, zIndex:1, borderRadius:"1px", cursor:"pointer", transition:"filter 0.1s" }}
                                onPointerDown={()=>startLongPress(ev)} onPointerUp={()=>handleEventTap(ev)} onPointerLeave={cancelLongPress} onContextMenu={e=>{e.preventDefault();setCtxEvent(ev);}}>
                                <span className="block truncate leading-tight">{ev.title}</span>
                                {ev.repeat!=="none"&&<span className="block text-[8px] opacity-50 mt-0.5">↻</span>}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ BUDGET ══ */}
        {activeTab === "budget" && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[{label:"INCOME",value:income,color:"#4ade80"},{label:"EXPENSES",value:expenses,color:"#f87171"},{label:"BALANCE",value:balance,color:balance>=0?"#4ade80":"#f87171"}].map(c=>(
                <div key={c.label} className="p-4" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                  <div className="text-[9px] mb-2" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>{c.label}</div>
                  <div className="text-2xl font-semibold" style={{ color:c.color, fontVariantNumeric:"tabular-nums" }}>${Math.abs(c.value).toFixed(2)}</div>
                  {c.label==="BALANCE"&&income>0&&<div className="text-[9px] mt-1" style={{ color:"var(--muted-foreground)" }}>{balance>=0?`${((balance/income)*100).toFixed(0)}% saved`:"over budget"}</div>}
                </div>
              ))}
            </div>
            {expenses>0&&(
              <div className="mb-6 p-4" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                <div className="text-[9px] mb-3" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>BREAKDOWN</div>
                <div className="space-y-2.5">
                  {BUDGET_CATEGORIES.map(cat=>{
                    const total=budget.filter(b=>b.type==="expense"&&b.category===cat.id).reduce((s,b)=>s+b.amount,0);
                    if(!total) return null;
                    const pct=(total/expenses)*100;
                    return (
                      <div key={cat.id}>
                        <div className="flex justify-between text-[10px] mb-1"><span>{cat.label.toUpperCase()}</span><span style={{ color:"var(--muted-foreground)" }}>${total.toFixed(2)} · {pct.toFixed(0)}%</span></div>
                        <div className="h-0.5 overflow-hidden" style={{ background:"var(--muted)" }}><div className="h-full transition-all" style={{ width:`${pct}%`, background:cat.color }}/></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <div className="text-[9px]" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>TRANSACTIONS</div>
              <button onClick={()=>setShowBudgetForm(!showBudgetForm)} className="text-[10px] px-3 py-1.5" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>+ ADD_ITEM</button>
            </div>
            {showBudgetForm&&(
              <div className="mb-4 p-4" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <input className="col-span-2 text-xs px-3 py-2" placeholder="description" value={newBudgetItem.label} onChange={e=>setNewBudgetItem({...newBudgetItem,label:e.target.value})}/>
                  <input type="number" className="text-xs px-3 py-2" placeholder="amount ($)" value={newBudgetItem.amount} onChange={e=>setNewBudgetItem({...newBudgetItem,amount:e.target.value})}/>
                  <select className="text-xs px-3 py-2" value={newBudgetItem.type} onChange={e=>setNewBudgetItem({...newBudgetItem,type:e.target.value as "income"|"expense"})}>
                    <option value="expense">expense</option><option value="income">income</option>
                  </select>
                  {newBudgetItem.type==="expense"&&<select className="col-span-2 text-xs px-3 py-2" value={newBudgetItem.category} onChange={e=>setNewBudgetItem({...newBudgetItem,category:e.target.value})}>{BUDGET_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>}
                </div>
                <div className="flex gap-2">
                  <button onClick={addBudgetItem} className="text-[10px] px-3 py-1.5" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>ADD</button>
                  <button onClick={()=>setShowBudgetForm(false)} className="text-[10px] px-3 py-1.5" style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>CANCEL</button>
                </div>
              </div>
            )}
            <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
              {budget.map((item,i,arr)=>{
                const cat=BUDGET_CATEGORIES.find(c=>c.id===item.category);
                const col=item.type==="income"?"#4ade80":"#f87171";
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 group transition-colors hover:bg-[#1a1a1a]" style={{ borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
                    <div className="w-1.5 h-1.5 flex-shrink-0" style={{ background:item.type==="income"?"#4ade80":(cat?.color||"#71717a") }}/>
                    <span className="text-xs flex-1">{item.label}</span>
                    {item.type==="expense"&&cat&&<span className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>{cat.label.toUpperCase()}</span>}
                    <span className="text-xs font-medium" style={{ color:col, fontVariantNumeric:"tabular-nums" }}>{item.type==="income"?"+":"-"}${item.amount.toFixed(2)}</span>
                    <button onClick={()=>setBudget(budget.filter(b=>b.id!==item.id))} className="opacity-0 group-hover:opacity-100 text-xs transition-opacity" style={{ color:"var(--muted-foreground)", cursor:"pointer" }}>×</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ NOTES ══ */}
        {activeTab === "notes" && (
          <div>
            <div className="flex gap-2 mb-5">
              <textarea rows={2} className="flex-1 text-xs px-3 py-2.5 resize-none" style={{ borderRadius:"var(--radius)" }}
                placeholder="// quick note — enter to save" value={newNoteText} onChange={e=>setNewNoteText(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addNote();} }}/>
              <button onClick={addNote} className="px-4 text-[10px] self-start py-2.5" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>SAVE</button>
            </div>
            {sortedNotes.some(n=>n.pinned)&&(
              <div className="mb-1">
                <div className="text-[9px] mb-2" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>PINNED</div>
                <div className="space-y-1.5">{sortedNotes.filter(n=>n.pinned).map(n=><NoteRow key={n.id} note={n} onRemove={removeNote} onTogglePin={togglePin}/>)}</div>
              </div>
            )}
            {sortedNotes.some(n=>!n.pinned)&&(
              <div className="mt-4">
                {sortedNotes.some(n=>n.pinned)&&<div className="text-[9px] mb-2" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>NOTES</div>}
                <div className="space-y-1.5">{sortedNotes.filter(n=>!n.pinned).map(n=><NoteRow key={n.id} note={n} onRemove={removeNote} onTogglePin={togglePin}/>)}</div>
              </div>
            )}
            {notes.length===0&&<div className="text-xs py-10 text-center" style={{ color:"var(--muted-foreground)" }}>// no notes yet</div>}
          </div>
        )}

        {/* ══ WEATHER ══ */}
        {activeTab === "weather" && (
          <div>
            {weather.status==="idle"&&<div className="text-xs py-10 text-center" style={{ color:"var(--muted-foreground)" }}>// initializing...</div>}
            {weather.status==="loading"&&<div className="py-10 text-center"><div className="text-xs mb-2" style={{ color:"var(--primary)" }}>FETCHING_LOCATION...</div><div className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>allow location access if prompted</div></div>}
            {weather.status==="error"&&(
              <div className="py-10 text-center">
                <div className="text-2xl mb-3">⚠️</div>
                <div className="text-xs mb-3" style={{ color:"#f87171" }}>{weather.error}</div>
                <button onClick={()=>{ weatherFetchedRef.current=false; setWeather({status:"idle"}); }} className="text-[10px] px-3 py-1.5" style={{ border:"1px solid var(--border)", color:"var(--primary)", borderRadius:"var(--radius)", cursor:"pointer" }}>RETRY</button>
              </div>
            )}
            {weather.status==="ok"&&weather.current&&weather.daily&&(
              <div>
                <div className="mb-5 p-5" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-[10px] mb-1" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>CURRENT · {weather.city?.toUpperCase()}</div>
                      <div className="text-5xl font-semibold" style={{ color:"var(--primary)", fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{weather.current.temp}°</div>
                      <div className="text-xs mt-1" style={{ color:"var(--muted-foreground)" }}>{wmoLabel(weather.current.code)}</div>
                    </div>
                    <div className="text-5xl" style={{ lineHeight:1 }}>{wmoIcon(weather.current.code,weather.current.isDay)}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[{label:"FEELS LIKE",value:`${weather.current.feels}°`},{label:"HUMIDITY",value:`${weather.current.humidity}%`},{label:"WIND",value:`${weather.current.wind} km/h`}].map(s=>(
                      <div key={s.label} className="p-2.5" style={{ background:"var(--muted)", borderRadius:"var(--radius)" }}>
                        <div className="text-[9px] mb-1" style={{ color:"var(--muted-foreground)", letterSpacing:"0.12em" }}>{s.label}</div>
                        <div className="text-sm font-medium" style={{ fontVariantNumeric:"tabular-nums" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] mb-3" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>7-DAY FORECAST</div>
                <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
                  {weather.daily.map((day,i,arr)=>{
                    const d=new Date(day.date+"T12:00:00");
                    const label=i===0?"Today":i===1?"Tomorrow":d.toLocaleDateString("en-US",{weekday:"short"});
                    return (
                      <div key={day.date} className="flex items-center gap-4 px-4 py-3 hover:bg-[#1a1a1a] transition-colors" style={{ borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
                        <span className="text-xs w-20 flex-shrink-0" style={{ color:i===0?"var(--primary)":"var(--foreground)" }}>{label}</span>
                        <span className="text-lg flex-shrink-0" style={{ lineHeight:1 }}>{wmoIcon(day.code)}</span>
                        <span className="text-[10px] flex-1" style={{ color:"var(--muted-foreground)" }}>{wmoLabel(day.code)}</span>
                        {day.precip>0&&<span className="text-[10px] flex-shrink-0" style={{ color:"#22d3ee" }}>💧{day.precip.toFixed(1)}mm</span>}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-medium" style={{ fontVariantNumeric:"tabular-nums" }}>{day.high}°</span>
                          <span className="text-xs" style={{ color:"var(--muted-foreground)", fontVariantNumeric:"tabular-nums" }}>{day.low}°</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={()=>{ weatherFetchedRef.current=false; setWeather({status:"idle"}); }} className="mt-4 text-[10px] px-3 py-1.5"
                  style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>↻ REFRESH</button>
              </div>
            )}
          </div>
        )}

        {/* ══ STUDY ══ */}
        {activeTab === "study" && (
          <StudyTab
            sessions={studySessions}
            onLog={mins => setStudySessions(s=>[...s,{ id:Date.now().toString(), date:todayISO(), minutes:mins }])}
            timerRunning={timerRunning}
            timerElapsed={timerElapsed}
            onToggle={()=>setTimerRunning(r=>!r)}
            onReset={()=>{ setTimerRunning(false); setTimerElapsed(0); }}
          />
        )}

        </div>
      </main>

      {/* event popup */}
      {popupEvent&&(
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 px-4" style={{ background:"rgba(0,0,0,0.6)", backdropFilter:"blur(2px)" }} onClick={()=>setPopupEvent(null)}>
          <div className="w-full max-w-sm p-5 zoom-in" style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", borderLeft:`3px solid ${popupEvent.color}` }} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm font-semibold" style={{ color:popupEvent.color }}>{popupEvent.title}</div>
                <div className="text-[10px] mt-1" style={{ color:"var(--muted-foreground)" }}>{DAY_FULL[popupEvent.day]} · {fmtHour(popupEvent.startHour)}{popupEvent.duration>1?` – ${fmtHour(popupEvent.startHour+popupEvent.duration)}`:""}</div>
                {popupEvent.repeat!=="none"&&<div className="text-[10px] mt-0.5" style={{ color:"var(--muted-foreground)" }}>↻ {REPEAT_LABELS[popupEvent.repeat]}</div>}
              </div>
              <button onClick={()=>setPopupEvent(null)} style={{ color:"var(--muted-foreground)", cursor:"pointer", fontSize:"1.1rem", lineHeight:1 }}>×</button>
            </div>
            {popupEvent.description&&<p className="text-xs leading-relaxed" style={{ color:"var(--foreground)", borderTop:"1px solid var(--border)", paddingTop:"0.75rem" }}>{popupEvent.description}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={()=>{ openEdit(popupEvent); setPopupEvent(null); }} className="flex-1 text-[10px] py-2" style={{ border:`1px solid ${popupEvent.color}`, color:popupEvent.color, borderRadius:"var(--radius)", cursor:"pointer" }}>EDIT</button>
              <button onClick={()=>{ setEvents(events.filter(e=>e.id!==popupEvent.id)); setPopupEvent(null); }} className="flex-1 text-[10px] py-2" style={{ border:"1px solid #f87171", color:"#f87171", borderRadius:"var(--radius)", cursor:"pointer" }}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {/* context menu */}
      {ctxEvent&&(
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 px-4" style={{ background:"rgba(0,0,0,0.5)", backdropFilter:"blur(2px)" }} onClick={()=>setCtxEvent(null)}>
          <div className="w-full max-w-sm zoom-in" style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }} onClick={e=>e.stopPropagation()}>
            <div className="px-4 py-3" style={{ borderBottom:"1px solid var(--border)" }}>
              <div className="text-xs font-semibold" style={{ color:ctxEvent.color }}>{ctxEvent.title}</div>
              <div className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>{DAY_SHORT[ctxEvent.day]} · {fmtHour(ctxEvent.startHour)}</div>
            </div>
            <button className="w-full text-left px-4 py-3 text-xs transition-colors hover:bg-[#1a1a1a]" style={{ color:"var(--foreground)", borderBottom:"1px solid var(--border)", cursor:"pointer" }} onClick={()=>openEdit(ctxEvent)}>✎ &nbsp;Edit event</button>
            <button className="w-full text-left px-4 py-3 text-xs transition-colors hover:bg-[#1a1a1a]" style={{ color:"#f87171", cursor:"pointer" }} onClick={()=>{ setEvents(events.filter(e=>e.id!==ctxEvent.id)); setCtxEvent(null); }}>✕ &nbsp;Delete event</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── NoteRow ────────────────────────────────────────────────────────────────

function NoteRow({ note, onRemove, onTogglePin }: { note:Note; onRemove:(id:string)=>void; onTogglePin:(id:string)=>void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 group transition-colors" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:note.pinned?"#151a15":"var(--card)" }}>
      <button onClick={()=>onTogglePin(note.id)} className="mt-0.5 text-xs flex-shrink-0" style={{ color:note.pinned?"var(--primary)":"var(--border)", cursor:"pointer", lineHeight:1 }}>◆</button>
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-relaxed">{note.text}</p>
        <span className="text-[10px] mt-1 block" style={{ color:"var(--muted-foreground)" }}>{note.createdAt}</span>
      </div>
      <button onClick={()=>onRemove(note.id)} className="opacity-0 group-hover:opacity-100 text-sm leading-none flex-shrink-0 transition-opacity" style={{ color:"var(--muted-foreground)", cursor:"pointer" }}>×</button>
    </div>
  );
}

// ── SisyphusScene ──────────────────────────────────────────────────────────

function SisyphusScene({ pct, cycles, pos, hasPenalty }: { pct:number; cycles:number; pos:number; hasPenalty:boolean }) {
  // Slope: (8, 148) → (292, 22)
  const sx=8, sy=148, ex=292, ey=22;
  const dx=ex-sx, dy=ey-sy; // (284, -126)
  const len=Math.sqrt(dx*dx+dy*dy); // ≈315
  const nx=dy/len*-1, ny=dx/len*-1; // outward normal (above slope): (-dy/len, -dx/len) — wait

  // Normal pointing "above" the slope (toward sky):
  // slope dir = (284,-126)/315 = (0.902,-0.400)
  // 90° CW in SVG-coords (y-down): rotate (ux,uy) → (uy, -ux) = (-0.400, -0.902) → points left+up = above slope ✓
  const ux=dx/len, uy=dy/len;
  const normalX=uy, normalY=-ux; // points above slope

  const r=11;
  const t=Math.max(0.02, Math.min(0.97, pct));

  const spx=sx+t*dx, spy=sy+t*dy;
  const bcx=spx+normalX*r, bcy=spy+normalY*r;

  const ft=Math.max(0.01, t-0.09);
  const fspx=sx+ft*dx, fspy=sy+ft*dy;
  // Figure torso base slightly above slope
  const fbx=fspx+normalX*5, fby=fspy+normalY*5;

  return (
    <div className="rounded mb-5 overflow-hidden" style={{ border:"1px solid var(--border)", background:"#080808" }}>
      <svg width="100%" viewBox="0 0 320 155" style={{ display:"block" }}>
        <defs>
          <radialGradient id="boulder-g" cx="38%" cy="32%" r="65%">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.45"/>
            <stop offset="100%" stopColor="#052e16" stopOpacity="0.95"/>
          </radialGradient>
          <filter id="glow-f" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Stars */}
        {STARS.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={0.9} fill="#4ade80" opacity={0.3+Math.sin(i)*0.15}/>)}

        {/* Crescent moon */}
        <circle cx="24" cy="28" r="9" fill="#1a2e1a" opacity="0.9"/>
        <circle cx="28.5" cy="25" r="7.5" fill="#080808"/>

        {/* Goal star at top */}
        <text x={ex-2} y={ey-8} textAnchor="middle" style={{ fontSize:"8px", fill:"#4ade80", opacity:0.5 }}>★</text>

        {/* Hill silhouette */}
        <path d={`M 0 155 L ${sx} ${sy} L ${ex} ${ey} L 320 ${ey} L 320 155 Z`} fill="#0f0f0f"/>
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#1e3020" strokeWidth="1.5"/>

        {/* Progress track (faint dotted line along slope) */}
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#1a3020" strokeWidth="1" strokeDasharray="3 5" opacity="0.4"/>

        {/* Sisyphus stick figure */}
        {/* Torso (leaning forward toward boulder) */}
        <line x1={fbx} y1={fby+10} x2={fbx+9} y2={fby-2} stroke="#999" strokeWidth="1.3" strokeLinecap="round"/>
        {/* Head */}
        <circle cx={fbx+10} cy={fby-6} r={4} fill="none" stroke="#999" strokeWidth="1.3"/>
        {/* Arms pushing boulder */}
        <line x1={fbx+6} y1={fby+2} x2={bcx-r*0.65} y2={bcy+3} stroke="#999" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1={fbx+7} y1={fby+5} x2={bcx-r*0.7} y2={bcy+7} stroke="#999" strokeWidth="1.3" strokeLinecap="round"/>
        {/* Back leg (planted) */}
        <line x1={fbx} y1={fby+10} x2={fbx-7} y2={fby+20} stroke="#999" strokeWidth="1.3" strokeLinecap="round"/>
        {/* Front leg (pushing off) */}
        <line x1={fbx} y1={fby+10} x2={fbx+4} y2={fby+20} stroke="#999" strokeWidth="1.3" strokeLinecap="round"/>

        {/* Boulder glow */}
        <circle cx={bcx} cy={bcy} r={r+5} fill="#4ade80" opacity="0.05" filter="url(#glow-f)"/>
        {/* Boulder */}
        <circle cx={bcx} cy={bcy} r={r} fill="url(#boulder-g)" stroke="#4ade80" strokeWidth="0.8" opacity="0.92"/>
        {/* Boulder crack marks */}
        <line x1={bcx-3} y1={bcy-4} x2={bcx+1} y2={bcy+2} stroke="#4ade80" strokeWidth="0.5" opacity="0.25"/>
        <line x1={bcx+3} y1={bcy-3} x2={bcx} y2={bcy+4} stroke="#4ade80" strokeWidth="0.5" opacity="0.2"/>

        {/* Progress bar at bottom */}
        <rect x="8" y="147" width="304" height="2" rx="1" fill="#1a1a1a"/>
        <rect x="8" y="147" width={Math.max(4, 304*pct)} height="2" rx="1" fill="#4ade80" opacity="0.6"/>

        {/* Labels */}
        <text x="8" y="142" style={{ fontFamily:"monospace", fontSize:"7.5px", fill:"#333" }}>
          {hasPenalty ? "the stone slips..." : `step ${pos}/100`}
        </text>
        <text x="312" y="142" textAnchor="end" style={{ fontFamily:"monospace", fontSize:"7.5px", fill:"#333" }}>
          ascent #{cycles+1}
        </text>
      </svg>
    </div>
  );
}

// ── StudyTab ───────────────────────────────────────────────────────────────

function StudyTab({ sessions, onLog, timerRunning, timerElapsed, onToggle, onReset }: {
  sessions: StudySession[];
  onLog: (minutes:number) => void;
  timerRunning: boolean;
  timerElapsed: number;
  onToggle: () => void;
  onReset: () => void;
}) {
  const [promptLog, setPromptLog] = useState(false);

  const sisy   = computeSisy(sessions);
  const streak = computeStreak(sessions);
  const today  = todayISO();
  const todayMins = sessions.filter(s=>s.date===today).reduce((s,x)=>s+x.minutes,0);
  const totalHrs  = Math.floor(sessions.reduce((s,x)=>s+x.minutes,0)/60);

  const elapsed_m = Math.floor(timerElapsed/60);
  const elapsed_s = timerElapsed%60;
  const RING_R=72, RING_C=2*Math.PI*72;
  const ringFill=Math.min(timerElapsed/3600,1);
  const dashOff=RING_C*(1-ringFill);

  const heatmap = useMemo(()=>{
    const byDate=new Map<string,number>();
    sessions.forEach(s=>byDate.set(s.date,(byDate.get(s.date)??0)+s.minutes));
    const now=new Date();
    const dow=now.getDay()===0?6:now.getDay()-1;
    const start=new Date(now); start.setDate(now.getDate()-dow-15*7); start.setHours(0,0,0,0);
    const todayStr=now.toISOString().split("T")[0];
    const weeks: Array<Array<{ date:string; minutes:number; isToday:boolean; monthLabel?:string }>> = [];
    let prevMonth=-1;
    for(let w=0;w<16;w++){
      const week=[];
      for(let d=0;d<7;d++){
        const day=new Date(start); day.setDate(start.getDate()+w*7+d);
        const ds=day.toISOString().split("T")[0];
        const isFuture=day>now;
        const monthLabel=(d===0&&day.getMonth()!==prevMonth)?MONTH_NAMES[day.getMonth()].slice(0,3):undefined;
        if(d===0) prevMonth=day.getMonth();
        week.push({ date:ds, minutes:isFuture?-1:(byDate.get(ds)??0), isToday:ds===todayStr, monthLabel });
      }
      weeks.push(week);
    }
    return weeks;
  },[sessions]);

  const handlePauseOrStop=()=>{
    onToggle();
    if(elapsed_m>=15) setPromptLog(true);
  };

  const handleLog=()=>{ onLog(elapsed_m); onReset(); setPromptLog(false); };
  const handleDiscard=()=>{ onReset(); setPromptLog(false); };

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { label:"TODAY",  value: todayMins>=60?`${Math.floor(todayMins/60)}h${todayMins%60}m`:`${todayMins}m` },
          { label:"TOTAL",  value:`${totalHrs}h` },
          { label:"STREAK", value:`${streak}d` },
          { label:"ASCENT", value:`#${sisy.cycles+1}` },
        ].map(s=>(
          <div key={s.label} className="p-3" style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", background:"var(--card)" }}>
            <div className="text-[9px] mb-1" style={{ color:"var(--muted-foreground)", letterSpacing:"0.12em" }}>{s.label}</div>
            <div className="text-base font-semibold" style={{ color:"var(--primary)", fontVariantNumeric:"tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Sisyphus */}
      <SisyphusScene pct={sisy.pct} cycles={sisy.cycles} pos={sisy.pos} hasPenalty={sisy.penalties>0&&sessions.length>0}/>

      {/* Scoring legend */}
      <div className="flex items-center gap-3 mb-5 px-1">
        <span className="text-[9px]" style={{ color:"var(--muted-foreground)" }}>study → steps:</span>
        {[["15m","+10"],["30m","+25"],["60m+","+50"]].map(([t,v])=>(
          <div key={t} className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color:"var(--muted-foreground)" }}>{t}</span>
            <span className="text-[9px] font-medium" style={{ color:"var(--primary)" }}>{v}</span>
          </div>
        ))}
        <span className="text-[9px] ml-auto" style={{ color:"#f87171" }}>miss a day −15</span>
      </div>

      {/* Timer */}
      <div className="flex flex-col items-center mb-6">
        <svg width="190" height="190" viewBox="0 0 190 190">
          {/* Tick marks */}
          {Array.from({length:60},(_,i)=>{
            const angle=(i/60)*2*Math.PI-Math.PI/2;
            const isMaj=i%5===0;
            const r1=isMaj?76:78, r2=82;
            return <line key={i} x1={95+r1*Math.cos(angle)} y1={95+r1*Math.sin(angle)} x2={95+r2*Math.cos(angle)} y2={95+r2*Math.sin(angle)} stroke={isMaj?"#2a2a2a":"#1a1a1a"} strokeWidth={isMaj?1.2:0.8}/>;
          })}
          {/* Background ring */}
          <circle cx="95" cy="95" r={RING_R} fill="none" stroke="#161616" strokeWidth="4"/>
          {/* Progress arc */}
          <circle cx="95" cy="95" r={RING_R} fill="none"
            stroke={timerRunning?"#4ade80":timerElapsed>0?"#166534":"#1a1a1a"}
            strokeWidth="4" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={dashOff}
            transform="rotate(-90 95 95)"
            style={{ transition:"stroke-dashoffset 0.9s linear, stroke 0.4s" }}/>
          {/* Center time */}
          <text x="95" y="90" textAnchor="middle" dominantBaseline="middle"
            style={{ fontFamily:"monospace", fontSize:"30px", fill:"#e2e2e2", fontVariantNumeric:"tabular-nums", letterSpacing:"-1px" }}>
            {String(elapsed_m).padStart(2,"0")}:{String(elapsed_s).padStart(2,"0")}
          </text>
          <text x="95" y="113" textAnchor="middle"
            style={{ fontFamily:"monospace", fontSize:"8px", fill:"#444", letterSpacing:"0.18em" }}>
            {timerRunning?"STUDYING":timerElapsed>0?"PAUSED":"READY"}
          </text>
        </svg>

        {promptLog ? (
          <div className="text-center mt-1">
            <div className="text-xs mb-3" style={{ color:"var(--foreground)" }}>
              log <span style={{ color:"var(--primary)" }}>{elapsed_m} min</span> session?
              {elapsed_m>=60&&<span className="ml-2 text-[10px]" style={{ color:"#4ade80" }}>+50 steps 🏔</span>}
              {elapsed_m>=30&&elapsed_m<60&&<span className="ml-2 text-[10px]" style={{ color:"#4ade80" }}>+25 steps</span>}
              {elapsed_m>=15&&elapsed_m<30&&<span className="ml-2 text-[10px]" style={{ color:"#4ade80" }}>+10 steps</span>}
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={handleLog} className="px-5 py-2 text-[10px] font-medium" style={{ background:"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>LOG SESSION</button>
              <button onClick={handleDiscard} className="px-4 py-2 text-[10px]" style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>DISCARD</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 mt-1">
            <button onClick={timerRunning?handlePauseOrStop:onToggle}
              className="px-8 py-2.5 text-[10px] font-medium tracking-widest"
              style={{ background:timerRunning?"#166534":"var(--primary)", color:"var(--primary-foreground)", borderRadius:"var(--radius)", cursor:"pointer", minWidth:"110px" }}>
              {timerRunning?"PAUSE":"START"}
            </button>
            <button onClick={()=>{ onReset(); setPromptLog(false); }} className="w-8 h-8 flex items-center justify-center text-sm"
              style={{ border:"1px solid var(--border)", color:"var(--muted-foreground)", borderRadius:"var(--radius)", cursor:"pointer" }}>↺</button>
          </div>
        )}
      </div>

      {/* Heatmap */}
      <div>
        <div className="text-[10px] mb-3" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>STUDY_LOG</div>
        <div className="overflow-x-auto">
          <div style={{ display:"inline-block", minWidth:"fit-content" }}>
            {/* Month labels */}
            <div style={{ display:"flex", gap:"2px", marginBottom:"2px", paddingLeft:"18px" }}>
              {heatmap.map((week,wi)=>(
                <div key={wi} style={{ width:"10px", fontSize:"7px", color:"#444", textAlign:"left", overflow:"visible", whiteSpace:"nowrap" }}>
                  {week[0]?.monthLabel??""}{" "}
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:"2px" }}>
              {/* Day labels */}
              <div style={{ display:"flex", flexDirection:"column", gap:"2px", marginRight:"2px" }}>
                {["M","","W","","F","","S"].map((d,i)=>(
                  <div key={i} style={{ height:"10px", width:"10px", fontSize:"7px", color:"#444", lineHeight:"10px", textAlign:"right" }}>{d}</div>
                ))}
              </div>
              {/* Week columns */}
              {heatmap.map((week,wi)=>(
                <div key={wi} style={{ display:"flex", flexDirection:"column", gap:"2px" }}>
                  {week.map((day,di)=>(
                    <div key={di}
                      title={day.minutes>=0?`${day.date}: ${day.minutes}min`:""}
                      style={{
                        width:"10px", height:"10px",
                        background: day.minutes<0?"transparent": day.minutes===0?"#111111": studyHeatColor(day.minutes),
                        borderRadius:"2px",
                        border: day.isToday?"1px solid #4ade80":"1px solid transparent",
                        transition:"transform 0.1s",
                        cursor: day.minutes>0?"default":"default",
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
            {/* Legend */}
            <div style={{ display:"flex", alignItems:"center", gap:"6px", marginTop:"8px", paddingLeft:"18px" }}>
              <span style={{ fontSize:"8px", color:"#444" }}>less</span>
              {[0,15,30,60].map(m=>(
                <div key={m} style={{ width:"9px", height:"9px", borderRadius:"2px", background:studyHeatColor(m), border:"1px solid #1a1a1a" }}/>
              ))}
              <span style={{ fontSize:"8px", color:"#444" }}>more</span>
              <span style={{ fontSize:"8px", color:"#333", marginLeft:"8px" }}>15m · 30m · 60m+</span>
            </div>
          </div>
        </div>
      </div>

      {/* Session history */}
      {sessions.length>0&&(
        <div className="mt-6">
          <div className="text-[10px] mb-2" style={{ color:"var(--muted-foreground)", letterSpacing:"0.15em" }}>RECENT_SESSIONS</div>
          <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
            {[...sessions].reverse().slice(0,8).map((s,i,arr)=>(
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#1a1a1a] transition-colors"
                style={{ borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background:studyHeatColor(s.minutes) }}/>
                <span className="text-xs flex-1" style={{ color:"var(--muted-foreground)" }}>{s.date}</span>
                <span className="text-xs" style={{ color:"var(--primary)", fontVariantNumeric:"tabular-nums" }}>{s.minutes}min</span>
                <span className="text-[10px]" style={{ color:"#333" }}>
                  +{s.minutes>=60?50:s.minutes>=30?25:s.minutes>=15?10:0} steps
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
