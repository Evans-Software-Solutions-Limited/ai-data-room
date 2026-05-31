/* global React */
/* datum/room — access flow components: RowMenu, ConfirmDialog, InviteWizard.
   Loaded on Members (+ RowMenu on Folder). Exported to window. */
(function () {
  const { useState, useRef, useEffect } = React;
  const D = window.Datum;
  const Ico = window.Ico;

  /* ---- Row action menu ------------------------------------------------ */
  function RowMenu({ actions }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, []);
    return (
      <span className="row-actions" ref={ref}>
        <button className="icon-btn" onClick={() => setOpen(!open)}><Ico.more /></button>
        {open && (
          <div className="menu-pop">
            {actions.map((a, i) => a.sep
              ? <div key={i} className="menu-sep" />
              : <button key={i} className={"menu-item" + (a.danger ? " danger" : "")} onClick={() => { setOpen(false); a.onClick && a.onClick(); }}>{a.icon}{a.label}</button>
            )}
          </div>
        )}
      </span>
    );
  }

  /* ---- Confirm dialog ------------------------------------------------- */
  function ConfirmDialog({ title, children, confirmLabel = "Confirm", danger = true, onConfirm, onClose }) {
    return (
      <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal confirm">
          <div className="modal-body">
            <div className="confirm-ic">{danger ? <Ico.lock /> : <Ico.shield />}</div>
            <div className="modal-title" style={{ marginBottom: 8 }}>{title}</div>
            <div className="confirm-text">{children}</div>
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Invite wizard -------------------------------------------------- */
  const ROLE_OPTS = [
    { id: "editor",   name: "Editor",          desc: "Full room · can upload & classify" },
    { id: "viewer",   name: "Viewer",          desc: "Full room · read-only, internal" },
    { id: "external", name: "External viewer", desc: "Scoped subroom · NDA-gated guest" },
  ];

  function InviteWizard({ onClose, onSent }) {
    const [step, setStep] = useState(0);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("external");
    const [scope, setScope] = useState(["01"]);
    const [download, setDownload] = useState(false);
    const [watermark, setWatermark] = useState(true);
    const [nda, setNda] = useState(true);
    const [expires, setExpires] = useState("11 Jul 2026");
    const [sent, setSent] = useState(false);

    const external = role === "external";
    const STEPS = external ? ["Person", "Scope", "Limits", "Review"] : ["Person", "Limits", "Review"];
    const toggleScope = (idx) => setScope((s) => s.indexOf(idx) === -1 ? [...s, idx] : s.filter((x) => x !== idx));
    const emailValid = /.+@.+\..+/.test(email);

    const canNext = () => {
      const name = STEPS[step];
      if (name === "Person") return emailValid;
      if (name === "Scope") return scope.length > 0;
      return true;
    };
    const isLast = step === STEPS.length - 1;

    const Body = () => {
      const name = STEPS[step];
      if (name === "Person") return (
        <>
          <div className="field">
            <div className="field-label">Email address</div>
            <input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <div className="field-label">Role</div>
            <div className="seg">
              {ROLE_OPTS.map((r) => (
                <button key={r.id} className={"seg-opt" + (role === r.id ? " is-on" : "")} onClick={() => setRole(r.id)}>
                  <div className="so-name">{r.name}</div>
                  <div className="so-desc">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      );
      if (name === "Scope") return (
        <div className="field">
          <div className="field-label">Folders this viewer can see<span className="field-hint">{scope.length} of 6 selected</span></div>
          <div className="scope-pick">
            {D.FOLDERS.map((f) => {
              const on = scope.indexOf(f.idx) !== -1;
              return (
                <button key={f.idx} className={"scope-opt" + (on ? " is-on" : "")} onClick={() => toggleScope(f.idx)}>
                  <span className="cbox">{on && <Ico.check />}</span>
                  <span className="so-idx">{f.idx}</span>
                  <span className="so-fname">{f.name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, color: "var(--ink-3)" }}>
            <Ico.lock /> Documents in unselected folders are invisible — not searchable, not citable.
          </div>
        </div>
      );
      if (name === "Limits") return (
        <>
          {external && (
            <div className="toggle-row">
              <div className="tr-meta"><div className="tr-name">Require NDA before access</div><div className="tr-desc">No document is visible until the viewer signs.</div></div>
              <div className={"switch" + (nda ? " is-on" : "")} onClick={() => setNda(!nda)} />
            </div>
          )}
          <div className="toggle-row">
            <div className="tr-meta"><div className="tr-name">Allow downloads</div><div className="tr-desc">{download ? "Viewer can download originals." : "View-only — no files leave the room."}</div></div>
            <div className={"switch" + (download ? " is-on" : "")} onClick={() => setDownload(!download)} />
          </div>
          <div className="toggle-row">
            <div className="tr-meta"><div className="tr-name">Watermark documents</div><div className="tr-desc">Stamp every page with the viewer's identity.</div></div>
            <div className={"switch" + (watermark ? " is-on" : "")} onClick={() => setWatermark(!watermark)} />
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <div className="field-label">Access expires</div>
            <input className="input" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </>
      );
      // Review
      return (
        <>
          <div className="review-line"><span className="rl-key">Email</span><span className="rl-val mono">{email || "—"}</span></div>
          <div className="review-line"><span className="rl-key">Role</span><span className="rl-val">{ROLE_OPTS.find((r) => r.id === role).name}</span></div>
          {external && <div className="review-line"><span className="rl-key">Scope</span><span className="rl-val">{scope.length} folders · <span className="mono">{scope.join(", ")}</span></span></div>}
          {external && <div className="review-line"><span className="rl-key">NDA</span><span className="rl-val">{nda ? "Required before access" : "Not required"}</span></div>}
          <div className="review-line"><span className="rl-key">Downloads</span><span className="rl-val">{download ? "Allowed" : "View-only"}</span></div>
          <div className="review-line"><span className="rl-key">Watermark</span><span className="rl-val">{watermark ? "On — viewer identity" : "Off"}</span></div>
          <div className="review-line"><span className="rl-key">Expires</span><span className="rl-val mono">{expires}</span></div>
        </>
      );
    };

    return (
      <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal">
          <div className="modal-head">
            <div className="mh-meta">
              <div className="modal-title">{sent ? "Invitation sent" : "Invite to the room"}</div>
              <div className="modal-sub">{sent ? "" : "Set their role, scope and limits before the invite goes out."}</div>
            </div>
            <button className="modal-x" onClick={onClose}><Ico.x /></button>
          </div>

          {!sent && (
            <div className="steps">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 && <span className="step-sep" />}
                  <div className={"step" + (i === step ? " is-active" : i < step ? " is-done" : "")}>
                    <span className="sdot">{i < step ? <Ico.check /> : i + 1}</span>{s}
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="modal-body">
            {sent ? (
              <div className="sent-state">
                <div className="ss-ic"><Ico.mail /></div>
                <div className="ss-t">Invite on its way to {email}</div>
                <div className="ss-x">They'll get a secure link. {external && nda ? "Access unlocks the moment they sign the NDA. " : ""}This invitation is recorded in the audit log.</div>
              </div>
            ) : <Body />}
          </div>

          <div className="modal-foot">
            {!sent && step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <span className="spacer" />
            {sent ? (
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            ) : isLast ? (
              <button className="btn btn-primary" onClick={() => { setSent(true); onSent && onSent({ email, role, scope, download, watermark, nda, expires }); }}><Ico.mail /> Send invite</button>
            ) : (
              <button className="btn btn-primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Continue</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, { RowMenu, ConfirmDialog, InviteWizard });
})();
