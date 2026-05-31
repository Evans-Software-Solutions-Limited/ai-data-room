/* global React, ReactDOM */
const { useState, useRef, useEffect, useCallback } = React;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio } = window;
const { Sidebar, TopBar, Ico, PreviewBar, NdaGate } = window;
const D = window.Datum;

/* ------------------------------------------------------------------ data  */
const THREAD = [
  {
    id: "x1",
    who: "RW",
    q: "What's the company's current cash runway, and when was it last reported?",
    confidence: 92,
    model: "Sonnet 4.6",
    answer: [
      { t: "As of the most recent management accounts, the company holds a cash balance of " },
      { b: "£4.2m" }, { t: " " }, { cite: 1 },
      { t: ". Net monthly burn over the last quarter averaged " },
      { b: "£310k" }, { t: " " }, { cite: 2 },
      { t: ", which the FY26 forecast translates to a runway of approximately " },
      { b: "13 months" }, { t: " " }, { cite: 3 },
      { t: " — i.e. into Q2 2027, before any new revenue or financing. The figures were last refreshed on " },
      { b: "30 April 2026" }, { t: "." },
    ],
    sources: [
      { n: 1, folder: "02_Financials", file: "Management_Accounts_Q1_2026.xlsx", title: "Management Accounts — Q1 2026", snippet: "Cash & equivalents at period end: £4,214,880. Reconciled to bank statements dated 30 Apr 2026.", meta: "xlsx · pg. 1 · indexed 2d ago" },
      { n: 2, folder: "02_Financials", file: "Board_Pack_Apr_2026.pdf", title: "Board Pack — April 2026", snippet: "Average net cash burn for the quarter was £310k/month, down from £358k in Q4 2025 following the headcount freeze.", meta: "pdf · pg. 12 · indexed 2d ago" },
      { n: 3, folder: "02_Financials", file: "Cashflow_Forecast_FY26.xlsx", title: "Cashflow Forecast — FY26", snippet: "Base case shows runway of 13 months from April 2026 at current burn, excluding the pipeline weighted at 40%.", meta: "xlsx · tab 'Base' · indexed 2d ago" },
    ],
  },
  {
    id: "x2",
    who: "RW",
    q: "Has the company completed a SOC 2 Type II audit?",
    idk: true,
    searched: ["05_Legal", "06_Operations", "01_Company_Overview"],
    answer: "I couldn't find anything in the documents you have access to that confirms a SOC 2 Type II audit. There's an ISO 27001 statement of applicability in 05_Legal, but no SOC 2 report or auditor's opinion. If one exists, it hasn't been uploaded to a folder in your scope.",
  },
];

/* ------------------------------------------------------------------ parts */
function AnswerText({ segments, activeCite, onCite }) {
  return (
    <p className="answer-text">
      {segments.map((s, i) => {
        if (s.cite != null) {
          return (
            <span key={i} className={"cite" + (activeCite === s.cite ? " is-active" : "")} onClick={() => onCite(s.cite)} title={"Jump to source " + s.cite}>{s.cite}</span>
          );
        }
        if (s.b) return <strong key={i}>{s.b}</strong>;
        return <React.Fragment key={i}>{s.t}</React.Fragment>;
      })}
    </p>
  );
}

function Exchange({ ex, activeCite, onCite }) {
  return (
    <div className="exchange" data-screen-label={"Q&A · " + ex.id}>
      <div className="prompt">
        <div className="who"><div className="q-avatar">{ex.who}</div></div>
        <div className="q-text">{ex.q}</div>
      </div>
      <div className="answer">
        <div className="ai-mark"><span className="ai-diamond" /></div>
        <div className="answer-body">
          {ex.idk ? (
            <div className="idk">
              <div className="idk-head"><span className="idk-badge">No grounded answer</span></div>
              <p className="idk-text"><span className="idk-title">"{ex.answer}"</span></p>
              <div className="idk-scope">
                searched
                {ex.searched.map((s) => <span key={s} className="sterm">{s}</span>)}
                · 187 documents · 0 supporting passages
              </div>
            </div>
          ) : (
            <>
              <AnswerText segments={ex.answer} activeCite={activeCite} onCite={onCite} />
              <div className="confidence">
                <span className="label">Confidence</span>
                <div className="conf-track"><div className="conf-fill" style={{ width: ex.confidence + "%" }} /></div>
                <span className="conf-pct">{ex.confidence}%</span>
                <span className="conf-meta">{ex.sources.length} sources · {ex.model}</span>
              </div>
              <div className="answer-tools">
                <button className="atool"><Ico.copy /> Copy</button>
                <button className="atool"><Ico.flag /> Flag answer</button>
                <a className="atool" href="Audit Log.html"><Ico.log /> View in audit log</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ s, active, onActivate, refCb }) {
  return (
    <div className={"src-card" + (active ? " is-active" : "")} ref={refCb} onClick={onActivate}>
      <div className="src-num">{s.n}</div>
      <div className="src-path"><span className="pfolder">{s.folder}</span><span>/</span><span>{s.file}</span></div>
      <div className="src-doc">{s.title}</div>
      <div className="src-snippet">{s.snippet}</div>
      <div className="src-foot"><span className="meta">{s.meta}</span><span className="open">Open ↗</span></div>
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
  const [activeCite, setActiveCite] = useState(null);
  const [draft, setDraft] = useState("");
  const railRefs = useRef({});
  const railScrollRef = useRef(null);

  const v = D.getViewer();
  const external = D.isExternal();
  const ndaOk = D.ndaOk();
  const sources = THREAD[0].sources;

  const onCite = useCallback((n) => {
    setActiveCite(n);
    const el = railRefs.current[n];
    const wrap = railScrollRef.current;
    if (el && wrap) wrap.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
  }, []);

  useEffect(() => { document.documentElement.setAttribute("data-ai", t.aiContract || "indigo"); }, [t.aiContract]);

  const Tweaks = (
    <TweaksPanel title="Tweaks">
      <TweakSection label="AI colour contract" />
      <TweakRadio label="Reserved AI hue" value={CONTRACT_LABEL[t.aiContract] || "Signal Indigo"} options={["Ledger Amber", "Signal Indigo", "Archive Teal"]} onChange={(v) => setTweak("aiContract", CONTRACT_VALUE[v])} />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" value={t.density} options={["compact", "regular"]} onChange={(v) => setTweak("density", v)} />
    </TweaksPanel>
  );

  // External viewer who hasn't signed → NDA gate, nothing else
  if (external && !ndaOk) {
    return (
      <div className="app" data-density={t.density}>
        <PreviewBar />
        <Sidebar active="qa" />
        <TopBar crumbs={[{ label: "datum", href: "Cited Q&A.html" }, { label: v.org }, { label: "Ask the room" }]} />
        <NdaGate />
        {Tweaks}
      </div>
    );
  }

  const scopedDocs = external ? v.scope.reduce((n, idx) => n + D.folderDocs(idx), 0) : 187;
  const scopeLabel = external ? v.scope.length + " of 6 folders" : "full room";
  const suggestions = external
    ? ["Which folders can I see?", "Summarise the company overview", "What does the product roadmap cover?"]
    : ["Which folders am I allowed to see?", "Summarise the security posture", "List documents mentioning data retention"];

  return (
    <div className="app" data-density={t.density}>
      <PreviewBar />
      <Sidebar active="qa" />
      <TopBar crumbs={external ? [{ label: "datum", href: "Cited Q&A.html" }, { label: v.org }, { label: "Ask the room" }] : [{ label: "datum" }, { label: "Capital Pay" }, { label: "Ask the room" }]} />

      <main className="main qa-main">
        <section className="chat-col">
          <div className="qa-header">
            <h1 className="qa-title">Ask the room</h1>
            <p className="qa-sub">{external ? "Answers are grounded only in the folders shared with you. Anything outside your scope is invisible to the AI." : "Answers are grounded in your indexed documents. Every claim links to its source."}</p>
            <div className="scope-row">
              <span className="scope-pill"><span className="ico"><Ico.search /></span>across <span className="mono">{scopedDocs}</span> documents</span>
              <span className="scope-pill"><span className="ico"><Ico.layers /></span>scope: <span className="mono">{scopeLabel}</span></span>
              {external ? <span className="scope-pill scope-locked"><Ico.lock /> set by Capital Pay</span> : <span className="scope-pill scope-edit">change scope</span>}
            </div>
          </div>

          <div className="thread">
            <div className="thread-inner">
              {external ? (
                <div className="scoped-welcome">
                  <div className="ai-mark"><span className="ai-diamond" /></div>
                  <div>
                    <p className="answer-text">Hello {v.name.split(" ")[0]} — you can ask anything about the <strong>{v.scope.length} folders</strong> Capital&nbsp;Pay has shared with {v.org}. Every answer cites the documents behind it, and only documents in your scope are ever searched.</p>
                    <div className="sw-scope">
                      {v.scope.map((idx) => <span key={idx} className="sw-folder"><span className="mono">{idx}</span> {D.folderName(idx)}</span>)}
                    </div>
                  </div>
                </div>
              ) : (
                THREAD.map((ex) => <Exchange key={ex.id} ex={ex} activeCite={activeCite} onCite={onCite} />)
              )}
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer-inner">
              <div className="suggested">
                {suggestions.map((s) => (
                  <button key={s} className="suggest-chip" onClick={() => setDraft(s)}><span className="sg-diamond" />{s}</button>
                ))}
              </div>
              <div className="composer">
                <span className="c-diamond" />
                <textarea rows={1} placeholder="Ask anything about the documents in this room…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button className="c-send" disabled={!draft.trim()}><Ico.arrow /></button>
              </div>
              <div className="composer-foot">
                <span className="note">Grounded in {scopedDocs} docs</span><span className="dotsep">·</span>
                {external ? <span className="note">{v.watermark ? "Documents are watermarked · " : ""}questions are logged to Capital Pay's audit trail</span> : <span className="note">Answers &amp; flags are written to the audit log</span>}
              </div>
            </div>
          </div>
        </section>

        <aside className="rail">
          <div className="rail-head">
            <h2 className="rail-title">Sources</h2>
            <div className="rail-sub">{external ? "scoped to your folders" : sources.length + " passages · cash runway"}</div>
          </div>
          <div className="rail-scroll" ref={railScrollRef}>
            {external ? (
              <div className="rail-empty"><span className="serif">Sources will appear here.</span><span className="mono">Drawn only from your {v.scope.length} folders.</span></div>
            ) : (
              sources.map((s) => (
                <SourceCard key={s.n} s={s} active={activeCite === s.n} onActivate={() => onCite(s.n)} refCb={(el) => { railRefs.current[s.n] = el; }} />
              ))
            )}
          </div>
        </aside>
      </main>

      {Tweaks}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
