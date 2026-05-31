/* global React */
/* datum/room — Upload flow with simulated AI relevance + checklist check.
   Loaded on Folder View. Exports window.UploadFlow. */
(function () {
  const { useState, useEffect, useRef } = React;
  const D = window.Datum;
  const Ico = window.Ico;

  const STEP_LABELS = ["Reading the document", "Classifying contents", "Checking the required-documents list", "Cross-checking the folder"];

  function genericVerdict(name, folderIdx) {
    return { folder: folderIdx, cls: "Supporting document", conf: 90, satisfies: null, misfiled: false,
      note: "datum read “" + name + "” and indexed it. It doesn't map to a specific required item, but it's relevant to this folder." };
  }

  function UploadFlow({ folderIdx = "02", onClose, onComplete }) {
    const [phase, setPhase] = useState("pick");   // pick | analysing | verdict
    const [doc, setDoc] = useState(null);
    const [over, setOver] = useState(false);
    const [anStep, setAnStep] = useState(0);
    const fileRef = useRef(null);

    const choose = (d) => { setDoc(d); setPhase("analysing"); setAnStep(0); };

    useEffect(() => {
      if (phase !== "analysing") return;
      if (anStep < STEP_LABELS.length) {
        const id = setTimeout(() => setAnStep((s) => s + 1), 600);
        return () => clearTimeout(id);
      }
      const id = setTimeout(() => setPhase("verdict"), 450);
      return () => clearTimeout(id);
    }, [phase, anStep]);

    const onDrop = (e) => {
      e.preventDefault(); setOver(false);
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) choose({ file: f.name, type: (f.name.split(".").pop() || "doc").slice(0, 3), size: Math.max(1, Math.round(f.size / 1024)) + " KB", ai: genericVerdict(f.name, folderIdx) });
    };
    const onPick = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) choose({ file: f.name, type: (f.name.split(".").pop() || "doc").slice(0, 3), size: Math.max(1, Math.round(f.size / 1024)) + " KB", ai: genericVerdict(f.name, folderIdx) });
    };

    const ai = doc && doc.ai;
    const misfiled = ai && ai.misfiled;
    const targetFolder = ai ? ai.folder : folderIdx;
    const checklist = D.CHECKLISTS[folderIdx] || [];

    return (
      <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal">
          <div className="modal-head">
            <div className="mh-meta">
              <div className="modal-title">Upload to {folderIdx}_{D.folderName(folderIdx)}</div>
              <div className="modal-sub">datum reads every upload, classifies it, and checks it against this folder's required documents.</div>
            </div>
            <button className="modal-x" onClick={onClose}><Ico.x /></button>
          </div>

          <div className="modal-body">
            {phase === "pick" && (
              <>
                <div
                  className={"dropzone" + (over ? " is-over" : "")}
                  onClick={() => fileRef.current && fileRef.current.click()}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={onDrop}
                >
                  <div className="dz-ic"><Ico.upload /></div>
                  <div className="dz-t">Drop a document here, or click to browse</div>
                  <div className="dz-x">PDF, XLSX, DOCX · up to 100 MB · encrypted at rest</div>
                  <input ref={fileRef} type="file" hidden onChange={onPick} />
                </div>
                <div className="samples">
                  <div className="samples-label">Or try a sample document</div>
                  {D.SAMPLES.map((s) => (
                    <button key={s.file} className="sample-chip" onClick={() => choose(s)}>
                      <span className="sc-type">{s.type}</span>
                      <span className="sc-name">{s.file}</span>
                      <span className="sc-size">{s.size}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {phase === "analysing" && (
              <div className="analysing">
                <div className="an-doc"><span className="sc-type">{doc.type}</span><span className="an-fname">{doc.file}</span></div>
                <div className="an-steps">
                  {STEP_LABELS.map((label, i) => (
                    <div key={i} className={"an-step" + (i < anStep ? " done" : i === anStep ? " active" : "")}>
                      <span className="as-ic">{i < anStep ? <Ico.check /> : i === anStep ? <span className="an-spinner" /> : null}</span>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === "verdict" && (
              <div className="verdict">
                <div className="verdict-head"><span className="ai-diamond" /><span className="vh-label">AI relevance check</span></div>
                <div className={"verdict-card" + (misfiled ? " is-warn" : "")}>
                  <div className="vc-row">
                    <span className="vc-cls">{ai.cls}</span>
                    <span className="vc-conf">{ai.conf}% confidence</span>
                  </div>
                  <div className="vc-note">{ai.note}</div>
                  <div className="vc-target">
                    {misfiled ? <Ico.flag /> : <Ico.check />}
                    {misfiled
                      ? <>belongs in <span className="vc-folder">{targetFolder}_{D.folderName(targetFolder)}</span>, not {folderIdx}_{D.folderName(folderIdx)}</>
                      : ai.satisfies
                        ? <span className="vc-satisfies">satisfies <b>{ai.satisfies}</b> in {folderIdx}_{D.folderName(folderIdx)}</span>
                        : <>files into <span className="vc-folder">{folderIdx}_{D.folderName(folderIdx)}</span></>}
                  </div>
                </div>

                {!misfiled && (
                  <div className="checklist-impact">
                    <div className="ci-head">Required-documents list · after this upload</div>
                    {checklist.map((c) => {
                      const adding = ai.satisfies && c.name === ai.satisfies;
                      const cls = adding ? "adding" : c.state;
                      return (
                        <div key={c.name} className={"ci-row" + (adding ? " adding" : "")}>
                          <span className={"ci-box " + (adding ? "adding" : c.state)}>{(adding || c.state === "present") && <Ico.check />}</span>
                          <span className="ci-name">{c.name}</span>
                          <span className={"ci-tag" + (adding ? " new" : c.state === "missing" && c.req ? " req" : "")}>
                            {adding ? "adding now" : c.state === "missing" ? (c.req ? "still required" : "optional") : c.req ? "required" : "optional"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-foot">
            {phase === "verdict" && <button className="btn btn-ghost" onClick={() => { setPhase("pick"); setDoc(null); }}>Back</button>}
            <span className="spacer" />
            {phase === "pick" && <button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
            {phase === "verdict" && (
              misfiled ? (
                <>
                  <button className="btn btn-ghost" onClick={() => { onComplete(doc, folderIdx); }}>Add here anyway</button>
                  <button className="btn btn-ai" onClick={() => { onComplete(doc, targetFolder); }}><Ico.arrow /> Move to {targetFolder}_{D.folderName(targetFolder)}</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => { onComplete(doc, folderIdx); }}><Ico.check /> Add to {folderIdx}_{D.folderName(folderIdx)}</button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, { UploadFlow });
})();
