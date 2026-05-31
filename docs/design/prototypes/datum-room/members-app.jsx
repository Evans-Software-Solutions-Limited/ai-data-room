/* global React, ReactDOM */
const { useState, useEffect } = React;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio } = window;
const { Sidebar, TopBar, Ico, Badge, PreviewBar, RowMenu, ConfirmDialog, InviteWizard } = window;
const D = window.Datum;

/* ------------------------------------------------------------------ data  */
const TEAM = [
  { name: "Rebecca Wells", email: "rebecca@capitalpay.co.uk", role: "Owner", roleCls: "owner", active: "online now", tfa: true, you: true },
  { name: "James Lin", email: "james@capitalpay.co.uk", role: "Editor", roleCls: "editor", active: "2h ago", tfa: true },
  { name: "Tara Shah", email: "tara@capitalpay.co.uk", role: "Editor", roleCls: "editor", active: "4m ago", tfa: true },
  { name: "Owen Doyle", email: "owen@capitalpay.co.uk", role: "Viewer", roleCls: "", active: "3d ago", tfa: false },
];

const SUBROOMS = [
  {
    name: "Stripe Inc.", meta: "vendor due-diligence · 3 of 6 folders", href: "Opportunity.html",
    viewers: [
      { name: "Priya Nair", email: "priya@stripe.com", nda: "ok", ndaLabel: "NDA signed", scope: "3 folders", seen: "2h ago" },
      { name: "Marcus Lee", email: "marcus@stripe.com", nda: "ok", ndaLabel: "NDA signed", scope: "3 folders", seen: "1d ago" },
      { name: "Devon Okafor", email: "devon@stripe.com", nda: "pending", ndaLabel: "NDA pending", scope: "3 folders", seen: "invited 3d ago" },
      { name: "Sara Kim", email: "sara@stripe.com", nda: "err", ndaLabel: "NDA declined", scope: "—", seen: "declined" },
    ],
  },
  {
    name: "Index Ventures", meta: "investor · 4 of 6 folders", href: "Opportunity.html",
    viewers: [
      { name: "Hannah Roy", email: "hannah@indexventures.com", nda: "ok", ndaLabel: "NDA signed", scope: "4 folders", seen: "5h ago" },
      { name: "Leo Marsh", email: "leo@indexventures.com", nda: "ok", ndaLabel: "NDA signed", scope: "4 folders", seen: "2d ago" },
    ],
  },
];

const NDA = { ok: { kind: "ok" }, pending: { kind: "pending" }, err: { kind: "err" } };
const initials = (name) => { const p = name.split(" ").filter(Boolean); return (p[0]?.[0] || "") + (p[1]?.[0] || ""); };

/* ------------------------------------------------------------------ parts */
function AccessRequest({ onResolve, resolved }) {
  if (resolved) {
    return (
      <div className="panel" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Badge kind="ok" dot>Resolved</Badge>
        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Cap_Table_2025.pdf request was actioned. The decision is recorded in the audit log.</span>
        <span style={{ flex: 1 }} />
        <a className="btn btn-quiet btn-sm" href="Audit Log.html">View in audit log</a>
      </div>
    );
  }
  return (
    <div className="ai-callout">
      <div className="ac-head"><span className="ac-diamond" /><span className="ac-label">AI access suggestion · pending decision</span></div>
      <div className="ac-body">
        <b>Marcus Lee</b> (Stripe Inc.) has requested <b>Cap_Table_2025.pdf</b> three times this week.
        It lives in <span className="mono">02_Financials</span>, which isn't in their subroom's scope — review whether to grant it, or keep it denied.
      </div>
      <div className="req-actions">
        <button className="btn btn-ai btn-sm" onClick={onResolve}><Ico.check /> Grant this file</button>
        <button className="btn btn-ghost btn-sm" onClick={onResolve}>Keep denied</button>
        <a className="btn btn-quiet btn-sm" href="Opportunity.html">Open subroom scope</a>
      </div>
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
  const [resolved, setResolved] = useState(false);
  const [modal, setModal] = useState(null);     // 'invite' | null
  const [confirm, setConfirm] = useState(null);  // { who, action } | null
  const [statusOf, setStatusOf] = useState({});  // email -> 'suspended' | 'revoked'
  const [toast, setToast] = useState(null);

  const allowed = D.pageAllowed(D.getViewer(), "members");
  useEffect(() => { document.documentElement.setAttribute("data-ai", t.aiContract || "indigo"); }, [t.aiContract]);
  useEffect(() => { if (!allowed) window.location.replace(D.fallbackPage(D.getViewer())); }, [allowed]);
  if (!allowed) return null;

  const setStatus = (email, s) => setStatusOf((m) => ({ ...m, [email]: s }));

  const extCount = SUBROOMS.reduce((n, s) => n + s.viewers.length, 0);
  const pending = SUBROOMS.reduce((n, s) => n + s.viewers.filter((v) => v.nda === "pending").length, 0);

  const memberActions = (m) => m.you ? [
    { label: "View activity", icon: <Ico.log />, onClick: () => { window.location.href = "Audit Log.html"; } },
  ] : [
    { label: "Change role", icon: <Ico.swap />, onClick: () => setToast("Role change isn't wired in this prototype.") },
    { label: "View activity", icon: <Ico.log />, onClick: () => { window.location.href = "Audit Log.html"; } },
    { sep: true },
    { label: statusOf[m.email] === "suspended" ? "Restore access" : "Suspend access", icon: <Ico.lock />, onClick: () => setStatus(m.email, statusOf[m.email] === "suspended" ? null : "suspended") },
    { label: "Remove from room", icon: <Ico.x />, danger: true, onClick: () => setConfirm({ kind: "member", who: m }) },
  ];

  const viewerActions = (v) => [
    { label: "Edit folder scope", icon: <Ico.layers />, onClick: () => setToast("Scope editing opens the subroom — wired via 'Manage scope'.") },
    v.nda === "pending"
      ? { label: "Resend invite", icon: <Ico.mail />, onClick: () => setToast("Invite resent to " + v.email + ".") }
      : { label: "View activity", icon: <Ico.log />, onClick: () => { window.location.href = "Audit Log.html"; } },
    { sep: true },
    { label: statusOf[v.email] === "suspended" ? "Restore access" : "Suspend access", icon: <Ico.lock />, onClick: () => setStatus(v.email, statusOf[v.email] === "suspended" ? null : "suspended") },
    { label: "Revoke access", icon: <Ico.x />, danger: true, onClick: () => setConfirm({ kind: "viewer", who: v }) },
  ];

  const statusBadge = (email, fallback) => {
    const s = statusOf[email];
    if (s === "revoked") return <Badge kind="err" dot>Revoked</Badge>;
    if (s === "suspended") return <Badge kind="pending" dot>Suspended</Badge>;
    return fallback;
  };

  return (
    <div className="app" data-density={t.density}>
      <PreviewBar />
      <Sidebar active="members" />
      <TopBar crumbs={[{ label: "datum", href: "Cited Q&A.html" }, { label: "Capital Pay" }, { label: "Members & access" }]} />

      <main className="main">
        <div className="page page-wide">
          <div className="page-head">
            <div className="head-row">
              <div>
                <div className="page-eyebrow">Workspace · access control</div>
                <h1 className="page-title">Members &amp; access</h1>
                <p className="page-sub">Who can reach this room, what they can see, and the state of every NDA. External viewers only ever see the folders in their subroom's scope.</p>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setModal("invite")}><Ico.mail /> Invite member</button>
              <button className="btn btn-primary" onClick={() => setModal("invite")}><Ico.plus /> New subroom</button>
            </div>
          </div>

          <div className="stat-row">
            <div className="stat"><div className="s-num">4</div><div className="s-label">Internal members</div></div>
            <div className="stat"><div className="s-num">{extCount}</div><div className="s-label">External viewers</div></div>
            <div className="stat"><div className="s-num">{pending} <span className="s-sub">of {extCount}</span></div><div className="s-label">NDAs outstanding</div></div>
            <div className="stat is-ai"><div className="s-num">1</div><div className="s-label">AI access suggestion</div></div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <AccessRequest resolved={resolved} onResolve={() => setResolved(true)} />
          </div>

          {/* Internal team */}
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Internal team</span><span className="spacer" /><span className="section-label">Capital Pay</span></div>
            <div className="panel-body" style={{ paddingTop: 6 }}>
              <table className="dtable">
                <colgroup><col style={{ width: "38%" }} /><col style={{ width: "16%" }} /><col style={{ width: "20%" }} /><col style={{ width: "18%" }} /><col style={{ width: "8%" }} /></colgroup>
                <thead><tr><th>Member</th><th>Role</th><th>Two-factor</th><th>Last active</th><th></th></tr></thead>
                <tbody>
                  {TEAM.map((m) => (
                    <tr key={m.email} style={statusOf[m.email] === "suspended" ? { opacity: 0.55 } : null}>
                      <td><div className="who-cell"><span className="who-av">{initials(m.name)}</span><div className="who-meta"><span className="who-name">{m.name}{m.you ? " (you)" : ""}</span><span className="who-email">{m.email}</span></div></div></td>
                      <td>{statusOf[m.email] ? statusBadge(m.email) : <span className={"role-pill " + m.roleCls}>{m.role}</span>}</td>
                      <td>{m.tfa ? <span className="two-factor"><Ico.shield /> Enabled</span> : <span className="two-factor off">Not set</span>}</td>
                      <td className="t-mono t-muted">{m.active}</td>
                      <td className="t-right"><RowMenu actions={memberActions(m)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* External viewers per subroom */}
          {SUBROOMS.map((sr) => (
            <div className="panel" key={sr.name}>
              <div className="subroom-head">
                <span className="sh-name">{sr.name}</span>
                <span className="sh-meta">{sr.meta}</span>
                <span className="spacer" />
                <a className="sh-link" href={sr.href}><Ico.layers /> Manage scope</a>
              </div>
              <div className="panel-body" style={{ paddingTop: 6 }}>
                <table className="dtable">
                  <colgroup><col style={{ width: "40%" }} /><col style={{ width: "20%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "8%" }} /></colgroup>
                  <thead><tr><th>Viewer</th><th>NDA status</th><th>Scope</th><th>Last seen</th><th></th></tr></thead>
                  <tbody>
                    {sr.viewers.map((v) => (
                      <tr key={v.email} style={statusOf[v.email] === "suspended" ? { opacity: 0.55 } : null}>
                        <td><div className="who-cell"><span className="who-av ext">{initials(v.name)}</span><div className="who-meta"><span className="who-name">{v.name}</span><span className="who-email">{v.email}</span></div></div></td>
                        <td>{statusBadge(v.email, <Badge kind={NDA[v.nda].kind} dot>{v.ndaLabel}</Badge>)}</td>
                        <td><span className="scope-cell">{v.scope === "—" ? <span className="sc-muted">no access</span> : v.scope}</span></td>
                        <td className="t-mono t-muted">{v.seen}</td>
                        <td className="t-right"><RowMenu actions={viewerActions(v)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </main>

      {modal === "invite" && <InviteWizard onClose={() => setModal(null)} onSent={(d) => setToast("Invitation sent to " + d.email + ".")} />}

      {confirm && (
        <ConfirmDialog
          title={"Revoke access for " + confirm.who.name + "?"}
          confirmLabel="Revoke access"
          onClose={() => setConfirm(null)}
          onConfirm={() => { setStatus(confirm.who.email, "revoked"); setToast(confirm.who.name + "'s access was revoked and logged."); }}
        >
          {confirm.kind === "viewer"
            ? <>This immediately ends <b>{confirm.who.name}</b>'s session and removes them from the subroom. Any signed NDA stays on file, and the revocation is written to the audit log.</>
            : <>This removes <b>{confirm.who.name}</b> from the Capital Pay team and revokes all access. This is recorded in the audit log.</>}
        </ConfirmDialog>
      )}

      {toast && <div className="toast" onAnimationEnd={() => {}}><Ico.check /> {toast}<button className="toast-x" onClick={() => setToast(null)}><Ico.x /></button></div>}

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
