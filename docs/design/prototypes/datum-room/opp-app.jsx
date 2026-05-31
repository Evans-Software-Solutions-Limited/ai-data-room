/* global React, ReactDOM */
const { useEffect } = React;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSelect } = window;
const { Sidebar, TopBar, Ico, Badge, PreviewBar } = window;
const { IOSDevice } = window;
const D = window.Datum;

/* ------------------------------------------------------------------ data  */
const GRANTED = [
  ["01", "Company Overview", 14],
  ["04", "Product", 31],
  ["06", "Operations", 19],
];
const DENIED = [
  ["02", "Financials", 38],
  ["03", "Commercial", 22],
  ["05", "Legal", 27],
];

const VIEWERS = [
  { name: "Priya Nair", email: "priya@stripe.com", nda: "signed", seen: "2h ago", dl: 14 },
  { name: "Marcus Lee", email: "marcus@stripe.com", nda: "signed", seen: "1d ago", dl: 6 },
  { name: "Devon Okafor", email: "devon@stripe.com", nda: "pending", seen: "invited 3d ago", dl: 0 },
  { name: "Sara Kim", email: "sara@stripe.com", nda: "declined", seen: "—", dl: 0 },
];

const NDA = {
  signed:   { kind: "ok",      label: "NDA signed" },
  pending:  { kind: "pending", label: "NDA pending" },
  declined: { kind: "err",     label: "NDA declined" },
};

/* ------------------------------------------------------------------ parts */
function AiSuggestionBanner({ onDismiss }) {
  return (
    <div className="ai-callout">
      <div className="ac-head"><span className="ac-diamond" /><span className="ac-label">AI access suggestion</span></div>
      <div className="ac-body">
        Stripe viewers have requested <b>Cap_Table_2025.pdf</b> three times this week. It lives in <b>02_Financials</b>,
        which isn't in this subroom's scope. Review whether to grant it — or leave it denied and let them know it's out of scope.
      </div>
      <div className="ac-actions">
        <button className="btn btn-ai btn-sm"><Ico.layers /> Review scope</button>
        <button className="btn btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function ScopeCard() {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Folder scope</span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm"><Ico.layers /> Edit scope</button>
      </div>
      <div className="scope-split">
        <div className="scope-side">
          <div className="scope-side-head"><span className="section-label">Granted</span><span className="cnt">{GRANTED.length} folders</span></div>
          {GRANTED.map(([idx, name, docs]) => (
            <div key={idx} className="scope-row2">
              <span className="scope-ic grant"><Ico.check /></span>
              <span className="scope-idx">{idx}</span>
              <span className="scope-name">{name}</span>
              <span className="scope-docs">{docs} docs</span>
            </div>
          ))}
        </div>
        <div className="scope-side">
          <div className="scope-side-head"><span className="section-label">Denied</span><span className="cnt">{DENIED.length} folders</span></div>
          {DENIED.map(([idx, name, docs]) => (
            <div key={idx} className="scope-row2 is-deny">
              <span className="scope-ic deny"><Ico.lock /></span>
              <span className="scope-idx">{idx}</span>
              <span className="scope-name">{name}</span>
              <span className="scope-docs">hidden</span>
            </div>
          ))}
        </div>
      </div>
      <div className="scope-reassure">
        <span className="lockic"><Ico.lock /></span>
        <span>Stripe viewers <b>cannot see, search, or query</b> any document in a denied folder — it's not just hidden from the list.</span>
      </div>
    </div>
  );
}

function ViewersTable({ state }) {
  if (state === "awaiting") {
    return (
      <div className="panel">
        <div className="panel-head"><span className="panel-title">External viewers</span></div>
        <div className="empty">
          <div className="e-mark"><Ico.eye style={{ width: 18, height: 18, color: "var(--ink-3)" }} /></div>
          <div className="e-title">No one has joined yet</div>
          <div className="e-text">Two invitations are pending. Viewers appear here once they open the invite and accept the NDA.</div>
          <button className="btn btn-primary"><Ico.plus /> Invite a viewer</button>
        </div>
      </div>
    );
  }
  if (state === "loading") {
    return (
      <div className="panel">
        <div className="panel-head"><span className="panel-title">External viewers</span></div>
        <div className="panel-body">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel skel-row" style={{ height: 18, marginBottom: 14 }} />)}</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">External viewers</span><span className="spacer" /><span className="section-label">{VIEWERS.length} invited</span></div>
      <div className="panel-body" style={{ paddingTop: 6 }}>
        <table className="dtable">
          <thead><tr><th>Viewer</th><th>NDA status</th><th>Last seen</th><th className="t-right">Downloads</th><th></th></tr></thead>
          <tbody>
            {VIEWERS.map((v) => {
              const n = NDA[v.nda];
              return (
                <tr key={v.email}>
                  <td><div className="viewer-cell"><span className="vn">{v.name}</span><span className="ve">{v.email}</span></div></td>
                  <td><Badge kind={n.kind} dot>{n.label}</Badge></td>
                  <td className="t-mono t-muted">{v.seen}</td>
                  <td className="t-right t-mono">{v.dl}</td>
                  <td className="t-right"><div className="row-actions"><button className="icon-btn"><Ico.more /></button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* read-only mobile external-viewer surface */
function MobileViewer({ joined }) {
  return (
    <IOSDevice title="" width={402} height={840}>
      <div className="mob-screen">
        {joined ? (
          <>
            <div className="mob-top">
              <div className="mob-shared"><b>Capital Pay</b> shared a room with you</div>
              <div className="mob-roomname">Capital Pay</div>
              <span className="mob-ro"><Ico.check /> Read-only · NDA signed</span>
            </div>
            <div className="mob-body">
              <div className="mob-sec">Folders you can view</div>
              <div className="mob-card">
                {GRANTED.map(([idx, name, docs]) => (
                  <div key={idx} className="mob-frow">
                    <span className="mob-fic">{idx}</span>
                    <span className="mob-fname"><span className="ft">{name}</span><span className="fd">{docs} documents</span></span>
                    <span className="mob-chev"><Ico.arrow style={{ transform: "rotate(90deg)" }} /></span>
                  </div>
                ))}
              </div>
              <div className="mob-sec">Ask</div>
              <div className="mob-ask">
                <span className="ai-diamond" />
                <span><span className="ma-t" style={{ display: "block" }}>Ask the room</span><span className="ma-s">Cited answers from documents you can see</span></span>
              </div>
            </div>
            <div className="mob-foot">priya@stripe.com · downloads &amp; questions are logged to Capital Pay's audit trail</div>
          </>
        ) : (
          <>
            <div className="mob-top">
              <div className="mob-shared"><b>Capital Pay</b> invited you</div>
              <div className="mob-roomname">Capital Pay</div>
            </div>
            <div className="mob-gate">
              <div className="g-ic"><Ico.lock /></div>
              <div className="g-t">Sign the NDA to continue</div>
              <div className="g-x">Capital Pay requires a signed non-disclosure agreement before you can view or download any document in this room.</div>
              <button className="g-btn">Review &amp; sign NDA</button>
              <div className="g-note">invite expires in 11 days</div>
            </div>
            <div className="mob-foot">devon@stripe.com · access granted only after signing</div>
          </>
        )}
      </div>
    </IOSDevice>
  );
}

/* ------------------------------------------------------------------- app  */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "aiContract": "indigo",
  "density": "compact",
  "screenState": "active"
}/*EDITMODE-END*/;

const CONTRACT_VALUE = { "Ledger Amber": "amber", "Signal Indigo": "indigo", "Archive Teal": "teal" };
const CONTRACT_LABEL = { amber: "Ledger Amber", indigo: "Signal Indigo", teal: "Archive Teal" };
const STATE_VALUE = { "Active subroom": "active", "Awaiting viewers": "awaiting", "Loading": "loading" };
const STATE_LABEL = { active: "Active subroom", awaiting: "Awaiting viewers", loading: "Loading" };

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [dismissed, setDismissed] = React.useState(false);
  const allowed = D.pageAllowed(D.getViewer(), "opp");
  useEffect(() => { document.documentElement.setAttribute("data-ai", t.aiContract || "indigo"); }, [t.aiContract]);
  useEffect(() => { if (!allowed) window.location.replace(D.fallbackPage(D.getViewer())); }, [allowed]);
  if (!allowed) return null;

  const state = t.screenState;
  const joined = state === "active";

  return (
    <div className="app" data-density={t.density}>
      <PreviewBar />
      <Sidebar active="opp-stripe" />
      <TopBar crumbs={[{ label: "datum", href: "Cited Q&A.html" }, { label: "Capital Pay" }, { label: "Opportunities" }, { label: "Stripe Inc." }]} />

      <main className="main">
        <div className="page page-wide">
          <div className="page-head">
            <div className="head-row">
              <div>
                <div className="page-eyebrow">Opportunities · vendor due-diligence</div>
                <h1 className="page-title">Stripe Inc.</h1>
                <p className="page-sub">A scoped subroom sharing a subset of the canonical room with Stripe's diligence team.</p>
                <div className="opp-head-pills">
                  <span className="hp"><Ico.eye /> scope: <span className="mono">3 of 6 folders</span></span>
                  <span className="hp"><Ico.lock /> NDA required</span>
                  <span className="hp">invite expires <span className="mono">11 Jun 2026</span></span>
                </div>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost"><Ico.layers /> Scope</button>
              <button className="btn btn-primary"><Ico.plus /> Invite viewer</button>
            </div>
          </div>

          <div className="opp-grid">
            <div className="opp-left">
              {state === "active" && !dismissed && <AiSuggestionBanner onDismiss={() => setDismissed(true)} />}
              <ScopeCard />
              <ViewersTable state={state} />
            </div>

            <div className="panel mob-panel">
              <div className="mob-cap">
                <span className="section-label">What external viewers see</span>
                <span className="mc-sub">Read-only surface · {joined ? "after NDA, on mobile" : "before signing the NDA"}</span>
              </div>
              <div className="mob-stage">
                <div className="mob-scale"><MobileViewer joined={joined} /></div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="AI colour contract" />
        <TweakRadio label="Reserved AI hue" value={CONTRACT_LABEL[t.aiContract] || "Signal Indigo"} options={["Ledger Amber", "Signal Indigo", "Archive Teal"]} onChange={(v) => setTweak("aiContract", CONTRACT_VALUE[v])} />
        <TweakSection label="Screen state" />
        <TweakSelect label="State" value={STATE_LABEL[state] || "Active subroom"} options={["Active subroom", "Awaiting viewers", "Loading"]} onChange={(v) => setTweak("screenState", STATE_VALUE[v])} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular"]} onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
