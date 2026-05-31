/* global React */
/* datum/room — shared shell: Sidebar, TopBar (+ "view as" switcher),
   PreviewBar, NdaGate, Ico, Diamond, Badge. Identity-aware via window.Datum.
   Exported to window for every screen's app script. */
(function () {
  const D = window.Datum;
  const OPPS = [
    ["stripe", "Stripe Inc."],
    ["index", "Index Ventures"],
    ["nhs", "RFP · NHS SBS"],
  ];

  const Ico = {
    search: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4"/><path d="M10.2 10.2 13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
    layers: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 2 14 5 8 8 2 5 8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2.5 8.2 8 11 13.5 8.2M2.5 11.2 8 14 13.5 11.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>),
    arrow: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 3.5v9M8 3.5 4.5 7M8 3.5 11.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    copy: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" strokeWidth="1.3"/></svg>),
    flag: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M4 14V3M4 3.5h7l-1.6 2.5L11 8.5H4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    log: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M3 3.5h10M3 8h10M3 12.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>),
    download: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 2.5v8M8 10.5 5 7.5M8 10.5 11 7.5M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    more: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><circle cx="4" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12" cy="8" r="1.1" fill="currentColor"/></svg>),
    check: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    plus: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
    upload: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 11V3.5M8 3.5 5 6.5M8 3.5 11 6.5M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    lock: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.3"/></svg>),
    eye: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3"/></svg>),
    shield: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M8 2 13 4v4.2c0 3-2.2 4.8-5 5.8-2.8-1-5-2.8-5-5.8V4l5-2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M5.8 8 7.3 9.5 10.3 6.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    filter: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
    mail: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><rect x="2.2" y="3.5" width="11.6" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="m2.6 4.5 5.4 4 5.4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    link: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M6.5 9.5 9.5 6.5M7 4.5 8.4 3.1a2.3 2.3 0 0 1 3.3 3.3L10.3 7.8M9 11.5 7.6 12.9a2.3 2.3 0 0 1-3.3-3.3L5.7 8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    clock: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3l2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    swap: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M4 5.5h8M9.5 3 12 5.5 9.5 8M12 10.5H4M6.5 8 4 10.5 6.5 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    x: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
    chevron: (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  };

  function Diamond({ className = "ai-diamond" }) { return <span className={className} />; }

  function Badge({ kind = "neutral", dot = false, children }) {
    return (
      <span className={"badge badge-" + kind + (kind === "pending" ? " pulse" : "")}>
        {dot && <span className="bdot" />}
        {children}
      </span>
    );
  }

  /* ---- Sidebar (identity-aware) -------------------------------------- */
  function Sidebar({ active }) {
    const v = D.getViewer();
    const external = !D.ROLES[v.role].internal;
    const folders = D.visibleFolders();

    return (
      <aside className="sidebar">
        <div className="sb-brand">
          <span className="sb-mark">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect x="6.2" y="6.2" width="7.6" height="7.6" rx="1.4" transform="rotate(45 10 10)" fill="var(--ink)"/></svg>
          </span>
          <a className="sb-wordmark" href={external ? "Cited Q&A.html" : "Cited Q&A.html"}>datum<span className="slash">/</span>room</a>
        </div>
        <div className="sb-scroll">
          <div className="sb-group">
            <div className="sb-label">{external ? "Shared with you" : "Canonical room"}</div>
            {folders.map((f) => (
              <a key={f.idx} className={"sb-item" + (active === "f" + f.idx ? " is-active" : "")} href="Folder View.html">
                <span className="sb-idx">{f.idx}</span>
                <span className="sb-name">{f.name}</span>
                {!external && <span className={"sb-dot " + (f.idx === "02" ? "ai" : "ok")} />}
                <span className="sb-count">{f.docs}</span>
              </a>
            ))}
          </div>

          {!external && D.canManageSubrooms() && (
            <div className="sb-group">
              <div className="sb-label">Opportunities</div>
              {OPPS.map(([id, name]) => (
                <a key={id} className={"sb-item" + (active === "opp-" + id ? " is-active" : "")} href="Opportunity.html">
                  <span className="sb-name">{name}</span>
                </a>
              ))}
            </div>
          )}

          <div className="sb-group">
            <div className="sb-label">Workspace</div>
            <a className={"sb-item" + (active === "qa" ? " is-active" : "")} href="Cited Q&A.html"><span className="sb-name">Ask the room</span></a>
            {!external && D.canViewAudit() && <a className={"sb-item" + (active === "audit" ? " is-active" : "")} href="Audit Log.html"><span className="sb-name">Audit log</span></a>}
            {D.canManageAccess() && <a className={"sb-item" + (active === "members" ? " is-active" : "")} href="Members.html"><span className="sb-name">Members &amp; access</span></a>}
            {!external && <a className={"sb-item" + (active === "ds" ? " is-active" : "")} href="Design System.html"><span className="sb-name">Design system</span></a>}
          </div>

          {external && (
            <div className="sb-extnote">
              <span className="lock"><Ico.lock /></span>
              <div>
                <div className="en-t">Read-only access</div>
                <div className="en-s">{v.scope.length} of 6 folders</div>
                <div className="en-s">{v.download ? "download enabled" : "view-only"}</div>
                {v.expires && <div className="en-s">expires {v.expires}</div>}
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }

  /* ---- "Viewing as" switcher ----------------------------------------- */
  function ViewSwitcher() {
    const [open, setOpen] = React.useState(false);
    const v = D.getViewer();
    const ref = React.useRef(null);
    React.useEffect(() => {
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, []);
    const internal = D.IDENTITIES.filter((i) => D.ROLES[i.role].internal);
    const external = D.IDENTITIES.filter((i) => !D.ROLES[i.role].internal);
    const Row = (i) => (
      <button key={i.id} className={"vs-row" + (i.id === v.id ? " is-current" : "")} onClick={() => D.setViewer(i.id)}>
        <span className={"vs-av" + (D.ROLES[i.role].internal ? "" : " ext")}>{i.initials}</span>
        <span className="vs-meta">
          <span className="vs-name">{i.name}{i.you ? " (you)" : ""}</span>
          <span className="vs-sub">{D.ROLES[i.role].label}{i.org ? " · " + i.org : ""}</span>
        </span>
        {i.id === v.id && <span className="vs-check"><Ico.check /></span>}
      </button>
    );
    return (
      <div className="view-switch" ref={ref}>
        <button className="user-chip" onClick={() => setOpen(!open)}>
          <div className={"avatar" + (D.ROLES[v.role].internal ? "" : " ext")}>{v.initials}</div>
          <span className="uc-meta">
            <span className="uc-name">{v.name}</span>
            <span className="uc-role">{D.ROLES[v.role].label}</span>
          </span>
          <span className="uc-caret"><Ico.swap /></span>
        </button>
        {open && (
          <div className="vs-menu">
            <div className="vs-head"><Ico.swap /> View the room as</div>
            <div className="vs-sec">Capital Pay team</div>
            {internal.map(Row)}
            <div className="vs-sec">External viewers</div>
            {external.map(Row)}
          </div>
        )}
      </div>
    );
  }

  /* ---- Top bar ------------------------------------------------------- */
  function TopBar({ crumbs = [] }) {
    const v = D.getViewer();
    return (
      <header className="topbar">
        <nav className="crumbs">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep">/</span>}
              {c.href ? <a href={c.href}>{c.label}</a> : <span className={i === crumbs.length - 1 ? "here" : ""}>{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
        <div className="spacer" />
        {D.ROLES[v.role].internal ? (
          <div className="org-pill"><span className="org-mark">CP</span>Capital Pay<span className="org-role mono">{v.role}</span></div>
        ) : (
          <div className="org-pill ext"><span className="org-mark ext"><Ico.eye /></span>{v.org}<span className="org-role mono">guest</span></div>
        )}
        <ViewSwitcher />
      </header>
    );
  }

  /* ---- Preview banner (fixed, shown when not the owner) -------------- */
  function PreviewBar() {
    const v = D.getViewer();
    const previewing = D.isPreviewing();
    React.useEffect(() => {
      document.body.classList.toggle("previewing", previewing);
      return () => document.body.classList.remove("previewing");
    }, [previewing]);
    if (!previewing) return null;
    const external = !D.ROLES[v.role].internal;
    const detail = external
      ? `${v.org} · ${v.nda === "signed" ? "read-only" : "NDA " + v.nda} · ${v.scope.length} of 6 folders${v.download ? "" : " · view-only"}`
      : `Capital Pay · ${D.ROLES[v.role].label}${v.role === "owner" ? "" : v.role === "editor" ? " · can't manage access" : " · read-only, no upload"}`;
    return (
      <div className={"preview-bar" + (external ? " is-ext" : "")}>
        <span className="pb-eye"><Ico.eye /></span>
        <span className="pb-text">Previewing as <b>{v.name}</b> — {detail}</span>
        <span className="pb-spacer" />
        <button className="pb-exit" onClick={() => D.setViewer("rwells")}><Ico.x /> Exit preview</button>
      </div>
    );
  }

  /* ---- NDA gate (external viewer who hasn't signed) ------------------- */
  function NdaGate() {
    const v = D.getViewer();
    return (
      <main className="main">
        <div className="nda-gate-wrap">
          <div className="nda-gate">
            <div className="ng-ic"><Ico.lock /></div>
            <div className="ng-eyebrow">{v.org} · {v.subroom}</div>
            <h1 className="ng-title">Sign the NDA to enter the room</h1>
            <p className="ng-text">Capital Pay requires a signed non-disclosure agreement before {v.name.split(" ")[0]} can view, search, or download any document in this room.</p>
            <button className="btn btn-primary ng-btn"><Ico.shield /> Review &amp; sign NDA</button>
            <div className="ng-note">invite to <span className="mono">{v.email}</span> · expires {v.expires}</div>
          </div>
        </div>
      </main>
    );
  }

  Object.assign(window, { Ico, Diamond, Badge, Sidebar, TopBar, ViewSwitcher, PreviewBar, NdaGate });
})();
