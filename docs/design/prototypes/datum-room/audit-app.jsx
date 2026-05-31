/* global React, ReactDOM */
const { useState, useEffect } = React;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio } = window;
const { Sidebar, TopBar, Ico, Badge, PreviewBar } = window;
const D = window.Datum;

/* ------------------------------------------------------------------ data  */
// cat: ai | upload | download | access ; actorKind: ai | internal | external
const EVENTS = [
  // ---- Today ----
  { day: "Today", time: "14:02", verb: "ANSWER", cat: "ai", actor: "datum AI", actorKind: "ai",
    text: <>Answered <b>“What's the current cash runway?”</b> · cited <span className="mono">3</span> sources · 92% confidence</>,
    who: "R. Wells", ip: "asked by owner" },
  { day: "Today", time: "13:48", verb: "DOWNLOAD", cat: "download", actor: "Priya Nair", actorKind: "external",
    text: <>Downloaded <b>Company_Overview.pdf</b> from <span className="mono">01_Company_Overview</span></>,
    who: "priya@stripe.com", ip: "92.40.18.6 · London" },
  { day: "Today", time: "13:31", verb: "DENY", cat: "access", actor: "datum AI", actorKind: "ai",
    text: <>Blocked <b>Cap_Table_2025.pdf</b> request — out of scope for <span className="mono">Stripe Inc.</span> subroom</>,
    who: "Marcus Lee", ip: "auto-enforced" },
  { day: "Today", time: "11:09", verb: "FLAG", cat: "ai", actor: "datum AI", actorKind: "ai",
    text: <>Flagged <b>Marketing_Deck_2025.pdf</b> — reads as a <span className="mono">04_Product</span> document</>,
    who: "in 02_Financials", ip: "sense-check" },
  { day: "Today", time: "10:54", verb: "UPLOAD", cat: "upload", actor: "T. Shah", actorKind: "internal",
    text: <>Uploaded <b>Bank_Statement_Mar.pdf</b> to <span className="mono">02_Financials</span></>,
    who: "T. Shah", ip: "internal" },
  { day: "Today", time: "10:54", verb: "CLASSIFY", cat: "ai", actor: "datum AI", actorKind: "ai",
    text: <>Indexing <b>Bank_Statement_Mar.pdf</b> — classification in progress</>,
    who: "auto", ip: "queued" },
  // ---- Yesterday ----
  { day: "Yesterday", time: "17:22", verb: "NDA SIGNED", cat: "access", actor: "Marcus Lee", actorKind: "external",
    text: <>Signed the mutual NDA for the <span className="mono">Stripe Inc.</span> subroom</>,
    who: "marcus@stripe.com", ip: "104.28.9.2 · Dublin" },
  { day: "Yesterday", time: "16:40", verb: "INVITE", cat: "access", actor: "R. Wells", actorKind: "internal",
    text: <>Invited <b>devon@stripe.com</b> as a viewer · scope <span className="mono">3 of 6 folders</span></>,
    who: "R. Wells", ip: "owner" },
  { day: "Yesterday", time: "15:03", verb: "SCOPE", cat: "access", actor: "R. Wells", actorKind: "internal",
    text: <>Changed <span className="mono">Stripe Inc.</span> scope — removed <b>05_Legal</b></>,
    who: "R. Wells", ip: "owner" },
  { day: "Yesterday", time: "14:12", verb: "CLASSIFY", cat: "ai", actor: "datum AI", actorKind: "ai",
    text: <>Classified <b>Management_Accounts_Q1_2026.xlsx</b> as <span className="mono">Management accounts</span> · 97%</>,
    who: "auto", ip: "on upload" },
  { day: "Yesterday", time: "09:31", verb: "DOWNLOAD", cat: "download", actor: "J. Lin", actorKind: "internal",
    text: <>Downloaded <b>Board_Pack_Apr_2026.pdf</b></>,
    who: "J. Lin", ip: "internal" },
  // ---- 29 May 2026 ----
  { day: "29 May 2026", time: "18:50", verb: "NDA DECLINED", cat: "access", actor: "Sara Kim", actorKind: "external",
    text: <>Declined the NDA for the <span className="mono">Stripe Inc.</span> subroom — access not granted</>,
    who: "sara@stripe.com", ip: "declined" },
  { day: "29 May 2026", time: "16:18", verb: "REINDEX", cat: "ai", actor: "datum AI", actorKind: "ai",
    text: <>Re-indexed <span className="mono">38</span> documents in <span className="mono">02_Financials</span> after upload</>,
    who: "auto", ip: "batch" },
  { day: "29 May 2026", time: "11:02", verb: "MEMBER", cat: "access", actor: "R. Wells", actorKind: "internal",
    text: <>Added <b>J. Lin</b> as an editor on the canonical room</>,
    who: "R. Wells", ip: "owner" },
  { day: "29 May 2026", time: "08:44", verb: "UPLOAD", cat: "upload", actor: "R. Wells", actorKind: "internal",
    text: <>Uploaded <b>Cashflow_Forecast_FY26.xlsx</b> to <span className="mono">02_Financials</span></>,
    who: "R. Wells", ip: "internal" },
];

const FILTERS = [
  { id: "all", label: "All events" },
  { id: "ai", label: "AI actions", ai: true },
  { id: "access", label: "Access & NDA" },
  { id: "download", label: "Downloads" },
  { id: "upload", label: "Uploads" },
];

const VERB_AI = new Set(["ANSWER", "FLAG", "CLASSIFY", "REINDEX", "DENY"]);

function initials(name) {
  if (name === "datum AI") return "AI";
  const p = name.replace(/\./g, "").split(" ").filter(Boolean);
  return (p[0]?.[0] || "") + (p[1]?.[0] || "");
}

/* ------------------------------------------------------------------ parts */
function LogRow({ e }) {
  const isAi = e.actorKind === "ai";
  return (
    <div className={"log-row" + (isAi ? " is-ai" : "")}>
      <span className="lr-time">{e.time}</span>
      <span className="lr-verb"><span className={"verb" + (VERB_AI.has(e.verb) ? " verb-ai" : "")}>{e.verb}</span></span>
      <span className="lr-detail">
        <span className={"lr-actor" + (isAi ? " ai" : e.actorKind === "external" ? " ext" : "")}>
          {isAi ? <span className="ai-diamond" /> : initials(e.actor)}
        </span>
        <span className="lr-text">{e.text}</span>
      </span>
      <span className="lr-meta">
        <span className="lm-who">{e.actor}</span>
        <span className="lm-ip">{e.ip}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- app  */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "aiContract": "indigo",
  "density": "compact"
}/*EDITMODE-END*/;

const CONTRACT_VALUE = { "Ledger Amber": "amber", "Signal Indigo": "indigo", "Archive Teal": "teal" };
const CONTRACT_LABEL = { amber: "Ledger Amber", indigo: "Signal Indigo", teal: "Archive Teal" };

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [filter, setFilter] = useState("all");
  const allowed = D.pageAllowed(D.getViewer(), "audit");
  useEffect(() => { document.documentElement.setAttribute("data-ai", t.aiContract || "indigo"); }, [t.aiContract]);
  useEffect(() => { if (!allowed) window.location.replace(D.fallbackPage(D.getViewer())); }, [allowed]);
  if (!allowed) return null;

  const shown = filter === "all" ? EVENTS : EVENTS.filter((e) => e.cat === filter);
  const counts = {};
  FILTERS.forEach((f) => { counts[f.id] = f.id === "all" ? EVENTS.length : EVENTS.filter((e) => e.cat === f.id).length; });

  // group by day, preserving order
  const days = [];
  shown.forEach((e) => {
    let g = days.find((d) => d.day === e.day);
    if (!g) { g = { day: e.day, items: [] }; days.push(g); }
    g.items.push(e);
  });

  return (
    <div className="app" data-density={t.density}>
      <PreviewBar />
      <Sidebar active="audit" />
      <TopBar crumbs={[{ label: "datum", href: "Cited Q&A.html" }, { label: "Capital Pay" }, { label: "Audit log" }]} />

      <main className="main">
        <div className="page page-wide">
          <div className="page-head">
            <div className="head-row">
              <div>
                <div className="page-eyebrow">Workspace · canonical room</div>
                <h1 className="page-title">Audit log</h1>
                <p className="page-sub">Every action in this room — by people and by datum — recorded in an append-only, tamper-evident trail.</p>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost"><Ico.download /> Export CSV</button>
            </div>
          </div>

          {/* Integrity strip — system trust, NOT an AI surface */}
          <div className="integrity">
            <span className="ig-mark"><Ico.shield /></span>
            <div className="ig-text">
              <span className="ig-title">Tamper-evident trail</span>
              <span className="ig-sub"><b>1,284</b> events · hash-chained · last verified <b>2m ago</b></span>
            </div>
            <span className="spacer" />
            <span className="ig-hash">sha256 · 9f3c…a201</span>
          </div>

          {/* Filters */}
          <div className="filter-bar">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={"fchip" + (f.ai ? " is-ai" : "") + (filter === f.id ? " is-active" : "")}
                onClick={() => setFilter(f.id)}
              >
                {f.ai && <span className="fc-diamond" />}
                {f.label}
                <span className="fc-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {/* Grouped log */}
          {days.map((g) => (
            <React.Fragment key={g.day}>
              <div className="log-day">
                <span className="ld-label">{g.day}</span>
                <span className="ld-rule" />
                <span className="ld-count">{g.items.length} {g.items.length === 1 ? "event" : "events"}</span>
              </div>
              <div className="log-list">
                {g.items.map((e, i) => <LogRow key={i} e={e} />)}
              </div>
            </React.Fragment>
          ))}

          <div className="log-foot">
            <Ico.clock /> <span>Showing recent activity ·</span> <span className="mono">1,284 total events</span>
          </div>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="AI colour contract" />
        <TweakRadio label="Reserved AI hue" value={CONTRACT_LABEL[t.aiContract] || "Signal Indigo"} options={["Ledger Amber", "Signal Indigo", "Archive Teal"]} onChange={(v) => setTweak("aiContract", CONTRACT_VALUE[v])} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular"]} onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
