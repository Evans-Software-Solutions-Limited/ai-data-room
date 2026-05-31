/* global React, ReactDOM */
const { useState, useEffect } = React;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSelect } = window;
const { Sidebar, TopBar, Ico, Badge, PreviewBar, NdaGate, RowMenu, UploadFlow } = window;
const D = window.Datum;

const FOLDER_IDX = "02";

/* ------------------------------------------------------------------ data  */
const CHECKLIST = D.CHECKLISTS[FOLDER_IDX].map((c) => [c.name, c.state, c.req ? "required" : ""]);

const DOCS = [
  { file: "Management_Accounts_Q1_2026.xlsx", type: "xls", cls: "Management accounts", conf: 97, uploader: "R. Wells", time: "2d ago", sense: "match" },
  { file: "Cashflow_Forecast_FY26.xlsx", type: "xls", cls: "Cashflow forecast", conf: 95, uploader: "R. Wells", time: "2d ago", sense: "match" },
  { file: "Board_Pack_Apr_2026.pdf", type: "pdf", cls: "Board pack", conf: 93, uploader: "J. Lin", time: "3d ago", sense: "match" },
  { file: "Cap_Table_2025.pdf", type: "pdf", cls: "Cap table", conf: 91, uploader: "R. Wells", time: "5d ago", sense: "match" },
  { file: "Marketing_Deck_2025.pdf", type: "pdf", cls: "Go-to-market deck", conf: 88, uploader: "T. Shah", time: "1d ago", sense: "mismatch" },
  { file: "Bank_Statement_Mar.pdf", type: "pdf", cls: "Indexing…", conf: null, uploader: "T. Shah", time: "4m ago", sense: "pending" },
];

const AUDIT = [
  { verb: "FLAG", ai: true, text: <>Flagged <b>Marketing_Deck_2025.pdf</b> — reads as a <span className="mono">04_Product</span> document</>, actor: "datum AI", time: "1d ago" },
  { verb: "CLASSIFY", ai: true, text: <>Classified <b>Management_Accounts_Q1_2026.xlsx</b> as <span className="mono">Management accounts</span> · 97%</>, actor: "datum AI", time: "2d ago" },
  { verb: "UPLOAD", ai: false, text: <>Uploaded <b>Bank_Statement_Mar.pdf</b> to 02_Financials</>, actor: "T. Shah", time: "4m ago" },
  { verb: "DOWNLOAD", ai: false, text: <>Downloaded <b>Board_Pack_Apr_2026.pdf</b></>, actor: "J. Lin", time: "3d ago" },
];

const SENSE = {
  match:    { kind: "ok",      label: "Match" },
  mismatch: { kind: "ai",      label: "Move suggested" },
  pending:  { kind: "pending", label: "Checking" },
};

/* ------------------------------------------------------------------ parts */
function ChecklistPanel({ state, satisfied }) {
  if (state === "loading") {
    return (
      <div className="panel">
        <div className="panel-head"><span className="panel-title">Required documents</span></div>
        <div className="checklist-summary"><div className="skel" style={{ height: 28, width: 120, marginBottom: 12 }} /><div className="skel" style={{ height: 7, width: "100%" }} /></div>
        <div className="check-list">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="check-row"><div className="skel" style={{ height: 19, width: 19, borderRadius: 999 }} /><div className="skel skel-row" style={{ flex: 1 }} /></div>)}</div>
      </div>
    );
  }
  const empty = state === "empty";
  let items = empty ? CHECKLIST.map((c) => [c[0], "missing", c[2]]) : CHECKLIST.map((c) => satisfied.has(c[0]) ? [c[0], "present", c[2]] : c);
  const present = items.filter((c) => c[1] === "present").length;
  const total = items.length;
  const flagged = state === "flagged";
  const pct = Math.round((present / total) * 100);
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Required documents</span></div>
      <div className="checklist-summary">
        <div className="cl-count"><span className="big">{present}</span><span className="of">/ {total}</span><span className="word">{empty ? "nothing uploaded" : "complete"}</span></div>
        <div className={"progress" + (flagged ? " is-ai" : "")}><div className="progress-track"><div className="progress-fill" style={{ width: pct + "%" }} /></div><span className="progress-num">{pct}%</span></div>
        {flagged && <div className="cl-flagnote"><span className="ai-diamond sm" />Progress reflects an open AI sense-check flag in this folder</div>}
      </div>
      <div className="check-list">
        {items.map(([name, st, req]) => (
          <div key={name} className={"check-row" + (st === "missing" ? " is-missing" : "")}>
            <span className={"check-box " + (st === "present" ? "cb-present" : "cb-missing")}>{st === "present" && <Ico.check />}</span>
            <span className="check-name">{name}</span>
            <span className={"check-tag" + (st === "missing" && req ? " req" : "")}>{req ? "required" : "optional"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MismatchCallout({ onResolve }) {
  return (
    <div className="ai-callout">
      <div className="ac-head"><span className="ac-diamond" /><span className="ac-label">AI sense-check · move suggested</span></div>
      <div className="ac-body"><b>Marketing_Deck_2025.pdf</b> reads as a <b>04_Product</b> go-to-market deck, not a financial statement. Moving it keeps the Financials checklist accurate and external readers from seeing it under Financials.</div>
      <div className="ac-actions"><button className="btn btn-ai btn-sm" onClick={onResolve}><Ico.arrow /> Move to 04_Product</button><button className="btn btn-ghost btn-sm" onClick={onResolve}>Keep here</button></div>
    </div>
  );
}

// internal documents table (owner / editor / internal viewer)
function DocsTable({ state, extraDocs, canDownload }) {
  if (state === "empty") {
    return (
      <div className="panel"><div className="empty">
        <div className="e-mark"><span className="ai-diamond" /></div>
        <div className="e-title">No documents indexed yet</div>
        <div className="e-text">Upload your financial statements and datum will classify each one and check it against the required-documents list.</div>
      </div></div>
    );
  }
  if (state === "loading") {
    return (
      <div className="panel"><div className="panel-head"><span className="panel-title">Documents</span><span className="spacer" /><span className="badge badge-ai"><span className="ai-diamond sm" />Indexing</span></div>
        <div className="panel-body">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel skel-row" style={{ marginBottom: 14, height: 18 }} />)}</div></div>
    );
  }
  const base = state === "healthy" ? DOCS.filter((d) => d.sense === "match") : DOCS;
  const docs = [...extraDocs, ...base];
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Documents</span><span className="spacer" /><span className="section-label">{docs.length} files</span></div>
      <div className="panel-body" style={{ paddingTop: 6 }}>
        <table className="dtable">
          <colgroup><col style={{ width: "30%" }} /><col style={{ width: "20%" }} /><col style={{ width: "14%" }} /><col style={{ width: "11%" }} /><col style={{ width: "17%" }} /><col style={{ width: "8%" }} /></colgroup>
          <thead><tr><th>Document</th><th>AI classification</th><th>Uploaded by</th><th>Added</th><th>Sense-check</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => {
              const s = SENSE[d.sense] || SENSE.match;
              return (
                <tr key={d.file} className={d.isNew ? "row-new" : ""}>
                  <td><div className="fname-cell"><span className="ftype">{d.type}</span><span className="t-file">{d.file}</span></div></td>
                  <td><span className={"doc-class" + (d.sense === "mismatch" ? " is-flag" : "")}>{d.cls}</span>{d.conf != null && <span className="conf-inline">{d.conf}%</span>}</td>
                  <td className="t-mono">{d.uploader}</td>
                  <td className="t-mono t-muted">{d.time}</td>
                  <td><Badge kind={s.kind} dot>{s.label}</Badge></td>
                  <td className="t-right"><RowMenu actions={[
                    { label: "Open", icon: <Ico.eye />, onClick: () => {} },
                    canDownload ? { label: "Download", icon: <Ico.download />, onClick: () => {} } : null,
                    { label: "View in audit log", icon: <Ico.log />, onClick: () => { window.location.href = "Audit Log.html"; } },
                    { sep: true },
                    { label: "Move to another folder", icon: <Ico.arrow />, onClick: () => {} },
                  ].filter(Boolean)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// read-only external document list (no internal AI metadata)
function ExternalDocs({ canDownload }) {
  const docs = DOCS.filter((d) => d.sense === "match");
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Documents</span><span className="spacer" /><span className="section-label">{docs.length} files · read-only</span></div>
      <div className="panel-body" style={{ paddingTop: 6 }}>
        <table className="dtable">
          <colgroup><col style={{ width: "58%" }} /><col style={{ width: "22%" }} /><col style={{ width: "20%" }} /></colgroup>
          <thead><tr><th>Document</th><th>Added</th><th className="t-right">{canDownload ? "Download" : "Access"}</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.file}>
                <td><div className="fname-cell"><span className="ftype">{d.type}</span><span className="t-file">{d.file}</span></div></td>
                <td className="t-mono t-muted">{d.time}</td>
                <td className="t-right">{canDownload
                  ? <button className="icon-btn"><Ico.download /></button>
                  : <span className="t-mono t-muted" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Ico.eye style={{ width: 13, height: 13 }} /> view-only</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditPanel() {
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Recent activity</span><span className="spacer" /><a className="section-label" href="Audit Log.html" style={{ textDecoration: "none" }}>audit log →</a></div>
      <div className="panel-body" style={{ paddingTop: 4 }}>
        {AUDIT.map((a, i) => (
          <div key={i} className="audit-row">
            <span className={"verb" + (a.ai ? " verb-ai" : "")}>{a.verb}</span>
            <span className="a-text">{a.text}</span>
            <span className={"a-actor" + (a.ai ? " ai" : "")}>{a.actor}</span>
            <span className="a-time">{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- app  */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "aiContract": "indigo",
  "density": "compact",
  "screenState": "flagged"
}/*EDITMODE-END*/;

const CONTRACT_VALUE = { "Ledger Amber": "amber", "Signal Indigo": "indigo", "Archive Teal": "teal" };
const CONTRACT_LABEL = { amber: "Ledger Amber", indigo: "Signal Indigo", teal: "Archive Teal" };
const STATE_VALUE = { "With AI flag": "flagged", "Healthy": "healthy", "Empty room": "empty", "Indexing": "loading" };
const STATE_LABEL = { flagged: "With AI flag", healthy: "Healthy", empty: "Empty room", loading: "Indexing" };

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [resolved, setResolved] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [extraDocs, setExtraDocs] = useState([]);
  const [satisfied, setSatisfied] = useState(() => new Set());
  const [toast, setToast] = useState(null);

  useEffect(() => { document.documentElement.setAttribute("data-ai", t.aiContract || "indigo"); }, [t.aiContract]);
  useEffect(() => { setResolved(false); }, [t.screenState]);

  const v = D.getViewer();
  const external = D.isExternal();
  const ndaOk = D.ndaOk();
  const inScope = D.canSeeFolder(FOLDER_IDX);
  const canUpload = D.canUpload();
  const canDownload = D.canDownload();
  const aiAdmin = D.aiAdmin();

  const Tweaks = (
    <TweaksPanel title="Tweaks">
      <TweakSection label="AI colour contract" />
      <TweakRadio label="Reserved AI hue" value={CONTRACT_LABEL[t.aiContract] || "Signal Indigo"} options={["Ledger Amber", "Signal Indigo", "Archive Teal"]} onChange={(val) => setTweak("aiContract", CONTRACT_VALUE[val])} />
      {!external && <><TweakSection label="Screen state" /><TweakSelect label="State" value={STATE_LABEL[t.screenState] || "With AI flag"} options={["With AI flag", "Healthy", "Empty room", "Indexing"]} onChange={(val) => setTweak("screenState", STATE_VALUE[val])} /></>}
      <TweakSection label="Layout" />
      <TweakRadio label="Density" value={t.density} options={["compact", "regular"]} onChange={(val) => setTweak("density", val)} />
    </TweaksPanel>
  );

  const Frame = (children, crumbsTail) => (
    <div className="app" data-density={t.density}>
      <PreviewBar />
      <Sidebar active={"f" + FOLDER_IDX} />
      <TopBar crumbs={external
        ? [{ label: "datum", href: "Cited Q&A.html" }, { label: v.org }, { label: FOLDER_IDX + "_Financials" }]
        : [{ label: "datum", href: "Cited Q&A.html" }, { label: "Capital Pay" }, { label: "Canonical room" }, { label: FOLDER_IDX + "_Financials" }]} />
      {children}
      {toast && <div className="toast"><Ico.check /> {toast}<button className="toast-x" onClick={() => setToast(null)}><Ico.x /></button></div>}
      {Tweaks}
    </div>
  );

  // External viewer, NDA not signed → gate
  if (external && !ndaOk) return Frame(<NdaGate />);

  // External viewer, folder not in their scope → denied
  if (external && !inScope) {
    return Frame(
      <main className="main"><div className="page"><div className="denied-panel">
        <div className="dp-ic"><Ico.lock /></div>
        <div className="dp-title">{FOLDER_IDX}_Financials isn't in your scope</div>
        <div className="dp-text">Capital Pay has shared {v.scope.length} of 6 folders with {v.org}. This folder isn't one of them — its documents are invisible to you and can't be searched or requested.</div>
        <div className="dp-scope">You can open{v.scope.map((idx) => <a key={idx} className="dp-folder" href="Folder View.html"><span className="mono">{idx}</span> {D.folderName(idx)}</a>)}</div>
      </div></div></main>
    );
  }

  // External viewer with access → read-only folder
  if (external) {
    return Frame(
      <main className="main"><div className="page page-wide">
        <div className="page-head"><div className="head-row"><div>
          <div className="page-eyebrow">{FOLDER_IDX}_Financials · shared with {v.org}</div>
          <h1 className="page-title">Financials</h1>
          <p className="page-sub">Read-only. {canDownload ? "You can download originals." : "View-only — documents can't be downloaded."}</p>
        </div><div className="spacer" /><a className="btn btn-ghost" href="Cited Q&A.html"><Ico.search /> Ask the room</a></div></div>
        {v.watermark && <div className="watermark-note"><span className="wm-ic"><Ico.eye /></span><span>Every page you open is watermarked with <b>{v.email}</b>. Views and downloads are logged to Capital Pay's audit trail.</span></div>}
        <ExternalDocs canDownload={canDownload} />
      </div></main>
    );
  }

  // ---- Internal (owner / editor / viewer) ----
  const state = t.screenState;
  const showCallout = aiAdmin && state === "flagged" && !resolved;
  const effState = state === "flagged" && resolved ? "healthy" : state;

  return Frame(
    <main className="main"><div className="page page-wide">
      <div className="page-head"><div className="head-row"><div>
        <div className="page-eyebrow">{FOLDER_IDX}_Financials · canonical room</div>
        <h1 className="page-title">Financials</h1>
        <p className="page-sub">Financial statements, forecasts and board materials. Checked against the required-documents list on upload.</p>
      </div>
        <div className="spacer" />
        <a className="btn btn-ghost" href="Cited Q&A.html"><Ico.search /> Ask the room</a>
        {canUpload && <button className="btn btn-primary" onClick={() => setUploadOpen(true)}><Ico.upload /> Upload</button>}
      </div></div>

      <div className="folder-grid">
        <ChecklistPanel state={effState} satisfied={satisfied} />
        <div className="docs-col">
          {showCallout && <MismatchCallout onResolve={() => setResolved(true)} />}
          <DocsTable state={effState} extraDocs={extraDocs} canDownload={canDownload} />
          {effState !== "empty" && effState !== "loading" && <AuditPanel />}
        </div>
      </div>

      {uploadOpen && <UploadFlow folderIdx={FOLDER_IDX} onClose={() => setUploadOpen(false)} onComplete={(doc, target) => {
        setUploadOpen(false);
        if (target === FOLDER_IDX) {
          setExtraDocs((d) => [{ file: doc.file, type: doc.type, cls: doc.ai.cls, conf: doc.ai.conf, uploader: v.name.split(" ").map((p) => p[0]).join(". ") + ".", time: "just now", sense: "match", isNew: true }, ...d]);
          if (doc.ai.satisfies) setSatisfied((s) => new Set(s).add(doc.ai.satisfies));
          setToast(doc.file + " added to " + FOLDER_IDX + "_Financials · logged.");
        } else {
          setToast(doc.file + " moved to " + target + "_" + D.folderName(target) + " · logged.");
        }
      }} />}
    </div></main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
