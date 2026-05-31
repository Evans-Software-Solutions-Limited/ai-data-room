/* ==========================================================================
   datum/room — shared identity & access model (plain JS, no build step).
   Loaded before every screen's React script. Exposes window.Datum.

   This is the single source of truth for:
     · the canonical folders
     · who can sign in (identities) and their role + scope + per-user limits
     · the permission helpers every screen gates its UI on
     · the per-folder required-documents checklist
     · sample documents + their simulated AI analysis (upload flow)
   "Viewing as" is persisted in localStorage so it survives navigation
   between the separate HTML pages.
   ========================================================================== */
(function () {
  const LS_KEY = "datum.viewerId";

  /* ---- Canonical folders --------------------------------------------- */
  const FOLDERS = [
    { idx: "01", name: "Company Overview", docs: 14 },
    { idx: "02", name: "Financials",       docs: 38 },
    { idx: "03", name: "Commercial",       docs: 22 },
    { idx: "04", name: "Product",          docs: 31 },
    { idx: "05", name: "Legal",            docs: 27 },
    { idx: "06", name: "Operations",       docs: 19 },
  ];
  const folderName = (idx) => (FOLDERS.find((f) => f.idx === idx) || {}).name || idx;
  const folderDocs = (idx) => (FOLDERS.find((f) => f.idx === idx) || {}).docs || 0;

  /* ---- Roles --------------------------------------------------------- */
  // capability flags per role. External adds per-user overrides on top.
  const ROLES = {
    owner:    { label: "Owner",   internal: true,  manageAccess: true,  upload: true,  download: true,  viewAudit: true,  viewMembers: true,  aiAdmin: true,  manageSubrooms: true },
    editor:   { label: "Editor",  internal: true,  manageAccess: false, upload: true,  download: true,  viewAudit: true,  viewMembers: false, aiAdmin: true,  manageSubrooms: true },
    viewer:   { label: "Viewer",  internal: true,  manageAccess: false, upload: false, download: true,  viewAudit: true,  viewMembers: false, aiAdmin: false, manageSubrooms: false },
    external: { label: "External viewer", internal: false, manageAccess: false, upload: false, download: false, viewAudit: false, viewMembers: false, aiAdmin: false, manageSubrooms: false },
  };

  /* ---- Identities (who you can "view as") ---------------------------- */
  const ALL = ["01", "02", "03", "04", "05", "06"];
  const IDENTITIES = [
    { id: "rwells", name: "Rebecca Wells", email: "rebecca@capitalpay.co.uk", role: "owner",  initials: "RW", scope: ALL, you: true },
    { id: "jlin",   name: "James Lin",     email: "james@capitalpay.co.uk",   role: "editor", initials: "JL", scope: ALL },
    { id: "odoyle", name: "Owen Doyle",    email: "owen@capitalpay.co.uk",    role: "viewer", initials: "OD", scope: ALL },
    // external viewers — scoped, NDA-gated, per-user limits
    { id: "pnair",  name: "Priya Nair",  email: "priya@stripe.com",  role: "external", initials: "PN",
      org: "Stripe Inc.", subroom: "vendor due-diligence", scope: ["01", "04", "06"],
      nda: "signed", download: true,  watermark: true, expires: "11 Jun 2026" },
    { id: "hroy",   name: "Hannah Roy",  email: "hannah@indexventures.com", role: "external", initials: "HR",
      org: "Index Ventures", subroom: "investor", scope: ["01", "02", "04", "06"],
      nda: "signed", download: false, watermark: true, expires: "30 Jun 2026" },
    { id: "dokafor", name: "Devon Okafor", email: "devon@stripe.com", role: "external", initials: "DO",
      org: "Stripe Inc.", subroom: "vendor due-diligence", scope: ["01", "04", "06"],
      nda: "pending", download: false, watermark: true, expires: "11 Jun 2026" },
  ];
  const byId = (id) => IDENTITIES.find((i) => i.id === id) || IDENTITIES[0];
  const OWNER = IDENTITIES[0];

  /* ---- Current viewer ------------------------------------------------- */
  function getViewerId() {
    try { return localStorage.getItem(LS_KEY) || "rwells"; } catch (e) { return "rwells"; }
  }
  function getViewer() { return byId(getViewerId()); }

  // pages an identity is allowed to open; otherwise redirect to fallback
  // keys: qa, folder, opp, audit, members, ds
  function pageAllowed(v, key) {
    const r = ROLES[v.role];
    if (key === "members") return r.manageAccess;          // owner only
    if (key === "opp")     return r.manageSubrooms;        // owner/editor
    if (key === "audit")   return r.viewAudit;             // internal
    return true;                                            // qa, folder, ds: all
  }
  function fallbackPage(v) {
    return ROLES[v.role].internal ? "Audit Log.html" : "Cited Q&A.html";
  }

  function setViewer(id) {
    try { localStorage.setItem(LS_KEY, id); } catch (e) {}
    const v = byId(id);
    // figure out the current page key from <body data-page>
    const key = document.body.getAttribute("data-page");
    if (key && !pageAllowed(v, key)) {
      window.location.href = fallbackPage(v);
    } else {
      window.location.reload();
    }
  }

  // call on each screen mount: redirect away if this identity can't see it
  function guard(key) {
    const v = getViewer();
    if (!pageAllowed(v, key)) {
      window.location.replace(fallbackPage(v));
      return false;
    }
    return true;
  }

  /* ---- Permission helpers (operate on current viewer) ---------------- */
  const cap = (k) => ROLES[getViewer().role][k];
  const helpers = {
    isOwner:        () => getViewer().role === "owner",
    isInternal:     () => ROLES[getViewer().role].internal,
    isExternal:     () => !ROLES[getViewer().role].internal,
    isPreviewing:   () => getViewerId() !== "rwells",
    canUpload:      () => cap("upload"),
    canManageAccess:() => cap("manageAccess"),
    canViewAudit:   () => cap("viewAudit"),
    canManageSubrooms: () => cap("manageSubrooms"),
    aiAdmin:        () => cap("aiAdmin"),
    canDownload:    () => { const v = getViewer(); return ROLES[v.role].internal ? ROLES[v.role].download : !!v.download; },
    hasWatermark:   () => { const v = getViewer(); return !ROLES[v.role].internal && !!v.watermark; },
    ndaOk:          () => { const v = getViewer(); return ROLES[v.role].internal || v.nda === "signed"; },
    canSeeFolder:   (idx) => { const v = getViewer(); return ROLES[v.role].internal || v.scope.indexOf(idx) !== -1; },
    visibleFolders: () => { const v = getViewer(); return ROLES[v.role].internal ? FOLDERS : FOLDERS.filter((f) => v.scope.indexOf(f.idx) !== -1); },
  };

  /* ---- Per-folder required-documents checklist ----------------------- */
  // present/missing here is the *default* room state (owner view).
  const CHECKLISTS = {
    "01": [
      { name: "Company profile & cap structure", req: true,  state: "present" },
      { name: "Org chart", req: false, state: "present" },
      { name: "Incorporation certificate", req: true, state: "present" },
    ],
    "02": [
      { name: "Management accounts (latest)", req: true,  state: "present" },
      { name: "Cashflow forecast (12-month)", req: true,  state: "present" },
      { name: "Balance sheet", req: true, state: "present" },
      { name: "P&L statement (YTD)", req: true, state: "present" },
      { name: "Board pack (latest)", req: false, state: "present" },
      { name: "Cap table", req: false, state: "present" },
      { name: "Revenue by customer", req: false, state: "present" },
      { name: "Budget vs. actuals", req: false, state: "present" },
      { name: "Audited accounts (FY25)", req: true,  state: "present" },
      { name: "Debt & loan agreements", req: true,  state: "missing" },
      { name: "Bank statements (3 months)", req: false, state: "missing" },
    ],
    "05": [
      { name: "Articles of association", req: true, state: "present" },
      { name: "Material contracts", req: true, state: "present" },
      { name: "IP assignments", req: true, state: "missing" },
      { name: "ISO 27001 statement of applicability", req: false, state: "present" },
    ],
  };

  /* ---- Sample documents for the upload flow + simulated AI analysis --- */
  // Each carries the AI's verdict: target folder, classification, confidence,
  // which checklist item it satisfies, and whether it looks misfiled.
  const SAMPLES = [
    { file: "Debt_Facility_Agreement_2025.pdf", type: "pdf", size: "1.8 MB",
      ai: { folder: "02", cls: "Debt & loan agreement", conf: 96, satisfies: "Debt & loan agreements", misfiled: false,
            note: "A senior debt facility agreement — satisfies a missing mandatory item in Financials." } },
    { file: "Bank_Statement_Apr_2026.pdf", type: "pdf", size: "420 KB",
      ai: { folder: "02", cls: "Bank statement", conf: 94, satisfies: "Bank statements (3 months)", misfiled: false,
            note: "One month of statements — covers part of the optional 3-month bank-statement item." } },
    { file: "Product_Roadmap_H2.pdf", type: "pdf", size: "3.1 MB",
      ai: { folder: "04", cls: "Product roadmap", conf: 91, satisfies: null, misfiled: true,
            note: "This reads as a Product document. Uploading it to Financials would misfile it — datum suggests 04_Product." } },
  ];

  window.Datum = {
    FOLDERS, folderName, folderDocs,
    ROLES, IDENTITIES, OWNER, byId,
    getViewerId, getViewer, setViewer, guard, pageAllowed, fallbackPage,
    CHECKLISTS, SAMPLES,
    ...helpers,
  };
})();
