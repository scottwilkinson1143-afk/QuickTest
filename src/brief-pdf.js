/* =============================================================================
   Meeting brief PDF - built in the browser with jsPDF + AutoTable (vendored in
   ./vendor) and the Inter typeface, following the Qlik brand guidelines.
   Loaded on demand the first time someone downloads a brief.
   ============================================================================= */
const VENDOR = ["vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/inter-pdf-fonts.js"];
const C = {
  green: [0, 152, 69], gray: [84, 86, 90], deepBlue: [25, 66, 108], ocean: [0, 101, 128], sky: [16, 207, 201],
  casper: [169, 179, 182], line: [226, 228, 229], tint: [246, 247, 247], white: [255, 255, 255],
  critical: [208, 59, 59], serious: [232, 116, 59], warning: [242, 169, 0], muted: [110, 112, 115]
};
const SEV_RGB = { critical: C.critical, serious: C.serious, warning: C.warning, opportunity: C.ocean, info: C.casper, admin: C.line };

let libs;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}
// jsPDF and AutoTable are UMD builds: if the page already has a module loader
// (a global define, module or exports, e.g. from another library), they register
// with it instead of creating window.jspdf. Hide those globals while they load.
const UMD_GLOBALS = ["define", "module", "exports", "require"];
async function loadUmd(srcs) {
  const saved = {};
  for (const k of UMD_GLOBALS) {
    if (k in window) { saved[k] = window[k]; try { window[k] = undefined; } catch (_) { /* read-only */ } }
  }
  try { for (const src of srcs) await loadScript(src); }
  finally { for (const k of Object.keys(saved)) { try { window[k] = saved[k]; } catch (_) { /* read-only */ } } }
}
async function ensureLibs() {
  if (!libs) {
    libs = (async () => {
      await loadUmd(VENDOR.slice(0, 2));           // jsPDF, AutoTable
      if (!window.jspdf?.jsPDF) throw new Error("jsPDF did not load (window.jspdf is missing)");
      await loadScript(VENDOR[2]);                  // Inter fonts, registered on jsPDF
    })();
    libs.catch(() => { libs = null; });            // allow a retry after a failure
  }
  return libs;
}
// approved logo artwork from the page header, rasterised for the PDF (skipped if not present)
async function logoPng() {
  const img = document.getElementById("qlik-logo");
  if (!img || img.hidden || !img.complete || !img.naturalWidth) return null;
  try {
    const w = 720, h = Math.round(w * (img.naturalHeight / img.naturalWidth));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    return { data: cv.toDataURL("image/png"), ratio: h / w };
  } catch (e) { return null; }
}
// characters outside the embedded Inter subset
const clean = s => String(s ?? "").replace(/→/g, ">").replace(/[▲▼]/g, "").replace(/\s+/g, " ").trim();
const cleanCell = s => String(s ?? "").split("\n").map(clean).join("\n");

export async function downloadBriefPdf(p, ctx) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  const { AS_OF, rmName, sourceLabel, fmtDate, fmtShort, fmtTime, gbp, pct, ago, parseD, days, sum, utilHist, SEV_LABEL, WD } = ctx;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 40, CW = W - 2 * M, BOTTOM = H - 46;
  const logo = await logoPng();
  let y = 0;

  const font = (weight = "normal", size = 9, color = C.gray) => { doc.setFont("Inter", weight); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (s, x, yy, opts) => doc.text(clean(s), x, yy, opts);
  const wrap = (s, w) => doc.splitTextToSize(clean(s), w);
  const fill = rgb => doc.setFillColor(...rgb);
  const stroke = rgb => doc.setDrawColor(...rgb);
  const opacity = a => doc.setGState(new doc.GState({ opacity: a }));
  const ensure = need => { if (y + need > BOTTOM) { doc.addPage(); pageHeader(false); } };

  // contrail: brand light trails, drawn as fading strokes
  function contrail(x, yy, w, strong = true) {
    const trails = [[0, 1.6, C.green, 0.05, 0.45, 0.9], [3.5, 0.7, C.sky, 0.1, 0.6, 0.65], [6, 0.6, C.ocean, 0.0, 0.35, 0.4], [8.5, 2.2, C.sky, 0.25, 0.75, 0.3]];
    for (const [dy, lw, rgb, a0, a1, peak] of trails) {
      const n = 40;
      for (let i = 0; i < n; i++) {
        const t = i / n, f = t < a0 || t > a1 + 0.3 ? 0 : t < a1 ? (t - a0) / Math.max(0.01, a1 - a0) : 1 - (t - a1) / 0.3;
        if (f <= 0) continue;
        opacity(Math.max(0, Math.min(1, f)) * peak * (strong ? 1 : 0.6));
        doc.setLineWidth(lw); stroke(rgb);
        doc.line(x + t * w, yy + dy, x + (t + 1 / n) * w, yy + dy);
      }
    }
    opacity(1);
  }
  function pageHeader(first) {
    y = 34;
    if (logo) doc.addImage(logo.data, "PNG", M, y - 4, 64, 64 * logo.ratio);
    font("semibold", 7.5, C.gray);
    doc.setCharSpace(1.2);
    text("MEETING BRIEF", W - M, y + 4, { align: "right" });
    doc.setCharSpace(0);
    font("normal", 7.5, C.muted);
    text(`${p.name} · prepared ${fmtDate(AS_OF)}`, W - M, y + 15, { align: "right" });
    contrail(W * 0.42, y + 24, W * 0.58 - M + 40);
    y = first ? 86 : 92;
  }
  function sectionTitle(t) {
    ensure(40);
    font("bold", 12, C.deepBlue);
    text(t, M, y);
    contrail(M, y + 5, 170, false);
    y += 24;
  }

  /* ---- page 1: who, next meeting, figures ---- */
  pageHeader(true);
  const c = p.c;
  font("bold", 22, C.deepBlue);
  const nameLines = wrap(p.name, CW - 210);
  nameLines.forEach((l, i) => text(l, M, y + i * 25));
  let yy = y + (nameLines.length - 1) * 25 + 18;
  font("normal", 9, C.gray);
  const size = c.annual_turnover_gbp ? `Turnover ${gbp(c.annual_turnover_gbp)}` : c.net_worth_gbp ? `Net worth ${gbp(c.net_worth_gbp)}` : "";
  const meta1 = [p.segment + (p.segment !== "Private Banking" && c.industry ? " · " + c.industry : ""), c.city, size,
    c.onboarded_date ? `Client since ${parseD(c.onboarded_date).getFullYear()}` : "Prospect", `Risk rating: ${c.risk_rating}`].filter(Boolean).join("   ·   ");
  wrap(meta1, CW - 210).forEach(l => { text(l, M, yy); yy += 13; });
  const meta2 = [p.coverage ? `Coverage: ${p.coverage}` : "", p.freqLabel ? `Policy: ${p.freqLabel.toLowerCase()}` : "",
    `Last met ${p.lastMeeting ? `${fmtDate(p.lastMeeting)} (${p.daysSince} days)` : "never"}`, `Last contact ${ago(p.daysSinceContact)}`].filter(Boolean).join("   ·   ");
  font("normal", 8.5, C.muted);
  wrap(meta2, CW - 210).forEach(l => { text(l, M, yy); yy += 12; });
  font("normal", 8.5, C.muted);
  text(`Relationship manager: ${rmName}`, M, yy); yy += 12;

  // next meeting card (right column)
  const bx = W - M - 196, bw = 196, by = y - 14;
  const n = p.next;
  const lines = [];
  if (n) {
    lines.push(["Type", `${n.meeting_type} · ${n.duration_mins || 60} min`], ["Where", `${n.channel} · ${n.location}`]);
    if (n.contactName) lines.push(["With", `${n.contactName}, ${n.contactTitle}`]);
    if (n.specialistName) lines.push(["Specialist", `${n.specialistName} (${n.specialism})`]);
    if (n.reschedule_count) lines.push(["Moved", `${n.reschedule_count}x, originally ${fmtShort(n.origD)}`]);
    lines.push(["Agenda", n.agenda || ""]);
  }
  font("normal", 8, C.gray);
  const rendered = lines.map(([k, v]) => [k, wrap(v, bw - 74)]);
  const bh = n ? 46 + sum(rendered.map(([, v]) => v.length * 10.5 + 3)) : 62;
  fill(C.tint); doc.roundedRect(bx, by, bw, bh, 4, 4, "F");
  fill(n ? C.green : C.critical); doc.rect(bx, by, bw, 3, "F");
  font("semibold", 7, C.gray); doc.setCharSpace(1);
  text(n ? (n.draft ? "PROPOSED MEETING (DRAFT)" : "NEXT MEETING") : "NEXT MEETING", bx + 12, by + 17);
  doc.setCharSpace(0);
  if (n) {
    font("bold", 11, C.deepBlue);
    text(`${WD[n.startD.getDay()]} ${fmtDate(n.startD)} · ${fmtTime(n.startD)}`, bx + 12, by + 32);
    let ly = by + 46;
    rendered.forEach(([k, v]) => {
      font("normal", 8, C.muted); text(k, bx + 12, ly);
      font("normal", 8, C.gray); v.forEach((l, i) => text(l, bx + 66, ly + i * 10.5));
      ly += v.length * 10.5 + 3;
    });
  } else {
    font("bold", 11, C.deepBlue); text("Nothing booked", bx + 12, by + 32);
    font("normal", 8, C.gray);
    text(p.daysSince == null ? "No meeting on record." : p.daysSince > p.interval ? `Overdue by ${p.daysSince - p.interval} days against the ${p.interval}-day policy.` : `Due within ${p.interval - p.daysSince} days.`, bx + 12, by + 46, { maxWidth: bw - 24 });
  }
  y = Math.max(yy, by + bh) + 16;

  // key figures
  const deposits = sum(p.holdings.filter(h => h.category === "Deposits" || h.category === "Transaction Banking").map(h => h.amount_gbp));
  const lendLimit = sum(p.lending.map(h => h.amount_gbp)), lendDrawn = sum(p.lending.map(h => h.drawn_amount_gbp));
  const wealth = sum(p.holdings.filter(h => h.category === "Wealth").map(h => h.amount_gbp));
  const figs = [[gbp(p.income), "Annual income, products held"], [gbp(p.revenue12), "Revenue, last 12 months"], [String(p.holdings.length), "Products held"],
    [gbp(deposits), "Deposits and current accounts"], [lendLimit ? gbp(lendDrawn) : "-", lendLimit ? `Lending drawn of ${gbp(lendLimit)}` : "Lending drawn"]];
  if (wealth) figs.push([gbp(wealth), "Wealth assets"]);
  const fw = CW / figs.length;
  stroke(C.line); doc.setLineWidth(0.6); doc.roundedRect(M, y, CW, 46, 4, 4, "S");
  figs.forEach(([v, l], i) => {
    const fx = M + i * fw;
    if (i) doc.line(fx, y + 8, fx, y + 38);
    font("bold", 13, C.deepBlue); text(v, fx + 10, y + 20);
    font("normal", 7, C.gray); wrap(l, fw - 16).slice(0, 2).forEach((t, k) => text(t, fx + 10, y + 31 + k * 8.5));
  });
  y += 64;

  /* ---- talking points ---- */
  sectionTitle("Talking points");
  if (!p.points.length) { font("normal", 9, C.muted); text("Nothing flagged. A good meeting to ask about plans and introduce new products.", M, y); y += 18; }
  p.points.forEach(t => {
    font("semibold", 9.5, C.deepBlue); const tl = wrap(t.title, CW - 16);
    font("normal", 8.5, C.gray); const el = wrap(t.ev, CW - 16);
    font("normal", 8.5, C.deepBlue); const al = wrap("Action: " + t.act, CW - 16);
    const h = 10 + tl.length * 12 + el.length * 11 + al.length * 11 + 6;
    ensure(h + 4);
    fill(SEV_RGB[t.sev] || C.casper); doc.rect(M, y - 8, 3, h - 6, "F");
    font("semibold", 6.5, C.gray); doc.setCharSpace(1); text(SEV_LABEL[t.sev].toUpperCase(), M + 12, y - 1); doc.setCharSpace(0);
    let ty = y + 11;
    font("semibold", 9.5, C.deepBlue); tl.forEach(l => { text(l, M + 12, ty); ty += 12; });
    font("normal", 8.5, C.gray); el.forEach(l => { text(l, M + 12, ty); ty += 11; });
    font("normal", 8.5, C.deepBlue);
    al.forEach((l, i) => {
      if (i === 0 && l.startsWith("Action: ")) {
        font("semibold", 8.5, C.green); text("Action:", M + 12, ty);
        const wA = doc.getTextWidth("Action: ");
        font("normal", 8.5, C.deepBlue); text(l.slice(8), M + 12 + wA, ty);
      } else text(l, M + 12, ty);
      ty += 11;
    });
    y = ty + 8;
  });

  /* ---- since last meeting ---- */
  sectionTitle(p.lastMeeting ? `Since the last meeting (${fmtDate(p.lastMeeting)})` : "Since the last meeting");
  const deltas = [];
  if (!p.lastMeeting) deltas.push(["No completed meeting on record", "", ""]);
  else {
    const L = p.lastMeeting, Lm = `${L.getFullYear()}-${String(L.getMonth() + 1).padStart(2, "0")}`;
    if (p.ser) {
      const i = p.months.indexOf(Lm);
      const at = i >= 0 ? p.ser.balance[i] : p.ser.balance.find(v => v != null);
      if (at != null && p.balance != null) deltas.push(["Current account balance", gbp(p.balance - at, { sign: true }), `${gbp(at)} then, ${gbp(p.balance)} now`]);
      const moved = sum(p.ser.moved.slice(Math.max(0, i)));
      if (moved > 0) deltas.push(["Moved to another bank", gbp(moved), "Transfers to an account in the customer's name elsewhere"]);
      if (p.inflowChange3 != null) deltas.push(["Inflows, last 3 months", pct(p.inflowChange3, true), "Against the previous 3 months"]);
    }
    p.revolving.forEach(h => {
      const hist = utilHist[h.holding_id] || []; if (!hist.length) return;
      const back = Math.min(hist.length - 1, Math.max(0, Math.round(days(L, AS_OF) / 30.4))), then = hist[hist.length - 1 - back];
      if (then != null && Math.abs(h.utilisation_pct - then) >= 5) deltas.push([`${h.product} utilisation`, `${h.utilisation_pct >= then ? "+" : "-"}${Math.abs(h.utilisation_pct - then).toFixed(0)} pts`, `${then.toFixed(0)}% then, ${h.utilisation_pct.toFixed(0)}% now`]);
    });
    const nc = p.cases.filter(k => parseD(k.opened_date) > L);
    if (nc.length) deltas.push(["Service cases opened", String(nc.length), nc.map(k => k.category).join(", ")]);
    const no = p.opps.filter(o => parseD(o.created_date) > L);
    if (no.length) deltas.push(["New opportunities", String(no.length), no.map(o => o.product).join(", ")]);
    deltas.push(["Calls and emails since", String(p.touches.filter(t => parseD(t.interaction_date) > L).length), ""]);
    const ncon = p.contacts.filter(x => parseD(x.known_since) > L);
    if (ncon.length) deltas.push(["New contacts", String(ncon.length), ncon.map(x => `${x.contact_name} (${x.job_title})`).join(", ")]);
  }
  const colW = (CW - 20) / 2;
  for (let i = 0; i < deltas.length; i += 2) {
    const pair = deltas.slice(i, i + 2);
    const hs = pair.map(([, , s]) => { font("normal", 8, C.muted); return s ? wrap(s, colW).length * 10 : 0; });
    const h = 14 + Math.max(...hs) + 8;
    ensure(h);
    pair.forEach(([k, v, s], j) => {
      const x = M + j * (colW + 20);
      font("normal", 9, C.gray); text(k, x, y);
      font("semibold", 9, C.deepBlue); text(v, x + colW, y, { align: "right" });
      font("normal", 8, C.muted); wrap(s, colW).forEach((l, q) => text(l, x, y + 12 + q * 10));
      stroke(C.line); doc.setLineWidth(0.5); doc.line(x, y + h - 9, x + colW, y + h - 9);
    });
    y += h;
  }
  y += 6;

  /* ---- charts ---- */
  if (p.ser) {
    ensure(170);
    const lab = p.months.map(m => { const [yr, mo] = m.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1]} ${yr.slice(2)}`; });
    const cw = (CW - 24) / 2;
    lineChartPdf(M, y, cw, 140, "Current account balance (month-end, 24 months)", lab.slice(0, -1), [{ name: "Balance", values: p.ser.balance.slice(0, -1), rgb: C.green, area: true }]);
    lineChartPdf(M + cw + 24, y, cw, 140, "Inflows and operating spend (12 months)", lab.slice(-13, -1),
      [{ name: "Inflows", values: p.ser.credits.slice(-13, -1), rgb: C.green }, { name: "Operating spend", values: p.ser.spend.slice(-13, -1), rgb: C.gray }]);
    y += 160;
  }
  function lineChartPdf(x, yy, w, h, title, labels, series) {
    font("semibold", 9, C.deepBlue); text(title, x, yy);
    const all = series.flatMap(s => s.values.filter(v => v != null));
    if (!all.length) { font("normal", 8, C.muted); text("No account activity in this period.", x, yy + 16); return; }
    const top = yy + 10 + (series.length > 1 ? 12 : 0), left = x + 40, right = x + w - 4, bottom = yy + h - 14;
    if (series.length > 1) series.forEach((s, i) => {
      const lx = x + i * 92; doc.setLineWidth(1.6); stroke(s.rgb); doc.line(lx, yy + 14, lx + 12, yy + 14);
      font("normal", 7.5, C.gray); text(s.name, lx + 16, yy + 16.5);
    });
    let lo = Math.min(0, ...all), hi = Math.max(...all); if (hi === lo) hi = lo + 1;
    const step0 = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(v => v * mag).find(v => (hi - lo) / v <= 4) || 10 * mag;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const sx = i => left + (labels.length === 1 ? 0 : i * (right - left) / (labels.length - 1));
    const sy = v => bottom - (v - lo) / (hi - lo || 1) * (bottom - top);
    doc.setLineWidth(0.4);
    for (let v = lo; v <= hi + step / 2; v += step) {
      stroke(C.line); doc.line(left, sy(v), right, sy(v));
      font("normal", 6.5, C.muted); text(gbp(v), left - 4, sy(v) + 2, { align: "right" });
    }
    const every = Math.ceil(labels.length / 6);
    labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1 && (labels.length - 1) % every > every * 0.6) { font("normal", 6.5, C.muted); text(l, sx(i), bottom + 10, { align: i === 0 ? "left" : i === labels.length - 1 ? "right" : "center" }); } });
    series.forEach(s => {
      const pts = s.values.map((v, i) => v == null ? null : [sx(i), sy(v)]).filter(Boolean);
      if (pts.length < 2) return;
      if (s.area) {
        opacity(0.12); fill(s.rgb);
        const base = sy(Math.max(0, lo));
        const segs = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]]);
        doc.lines([...segs, [0, base - pts[pts.length - 1][1]], [pts[0][0] - pts[pts.length - 1][0], 0]], pts[0][0], pts[0][1], [1, 1], "F", true);
        opacity(1);
      }
      doc.setLineWidth(1.4); stroke(s.rgb); doc.setLineJoin("round");
      for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      const e = pts[pts.length - 1]; fill(s.rgb); doc.circle(e[0], e[1], 2.2, "F");
    });
  }

  /* ---- tables ---- */
  const tableStyle = {
    margin: { left: M, right: M, top: 92, bottom: 50 },
    styles: { font: "Inter", fontStyle: "normal", fontSize: 8, textColor: C.gray, cellPadding: { top: 4, right: 5, bottom: 4, left: 5 }, lineColor: C.line, lineWidth: 0 },
    headStyles: { font: "Inter", fontStyle: "semibold", fillColor: C.deepBlue, textColor: C.white, fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.tint },
    // a table that runs onto a new page gets the page header there too
    didDrawPage: d => { if (d.pageNumber > 1) { const keep = y; pageHeader(false); y = keep; } },
  };
  const table = (title, head, body, columnStyles = {}) => {
    sectionTitle(title);
    doc.autoTable({ ...tableStyle, startY: y - 6, head: [head], body: body.map(r => r.map(cleanCell)), columnStyles });
    y = doc.lastAutoTable.finalY + 22;
  };
  table("Products held", ["Product", "Balance / limit", "Drawn", "Matures", "Income a year", "Renewal"],
    p.holdings.map(h => {
      const mat = parseD(h.maturity_date), dl = mat ? days(AS_OF, mat) : null;
      const ren = !mat ? "" : h.has_open_renewal ? "In progress" : dl <= 120 ? "Not raised" : dl <= 270 ? `Due in ${Math.round(dl / 30)} months` : "";
      const drawn = h.utilisation_pct != null ? `${h.utilisation_pct.toFixed(0)}% of limit` : h.drawn_amount_gbp != null && h.category === "Lending" ? `${gbp(h.drawn_amount_gbp)} outstanding` : "";
      return [`${h.product}\n${h.category}`, gbp(h.amount_gbp), drawn, mat ? fmtDate(mat) : "-", gbp(h.annual_income_gbp), ren];
    }), { 1: { halign: "right" }, 4: { halign: "right" } });
  if (p.opps.length) table("Open opportunities", ["Opportunity", "Stage", "Days in stage", "Expected close", "Income a year", "Probability"],
    p.opps.map(o => [`${o.product}\n${o.opportunity_type}`, o.stage, String(days(parseD(o.stage_entered_date), AS_OF)), fmtDate(parseD(o.expected_close_date)), gbp(o.expected_annual_income_gbp), `${o.probability_pct ?? "-"}%`]),
    { 2: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } });
  table("People", ["Name", "Role", "Relationship", "Email", "Phone"],
    p.contacts.map(x => [`${x.contact_name}${x.is_primary ? " (primary)" : ""}`, `${x.job_title}${x.is_decision_maker ? "\nDecision maker" : ""}`, x.relationship_strength, x.email, x.phone]),
    { 4: { cellWidth: 76 }, 2: { cellWidth: 62 } });
  const openCases = p.cases.filter(k => k.status === "Open");
  if (openCases.length) table("Open service cases", ["Case", "Opened", "Priority", "Description"],
    openCases.map(k => [k.category, fmtDate(parseD(k.opened_date)), k.priority, k.description]));

  /* ---- recent meeting notes ---- */
  const notes = p.meetings.filter(m => m.status === "Completed" && m.notes).slice(0, 3);
  if (notes.length) {
    sectionTitle("Recent meeting notes");
    notes.forEach(m => {
      font("normal", 8.5, C.gray); const nl = wrap(m.notes, CW);
      ensure(16 + nl.length * 11 + 14);
      font("semibold", 9, C.deepBlue); text(`${fmtDate(m.startD)} · ${m.meeting_type}`, M, y);
      font("normal", 8, C.muted); text([m.channel, m.contactName, m.sentiment].filter(Boolean).join(" · "), W - M, y, { align: "right" });
      y += 13;
      font("normal", 8.5, C.gray); nl.forEach(l => { text(l, M, y); y += 11; });
      if (m.next_action) { font("semibold", 8, C.green); text(`Next action: ${m.next_action}`, M, y + 1); y += 12; }
      y += 10;
    });
  }

  /* ---- footer on every page ---- */
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    stroke(C.line); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
    font("normal", 7, C.muted);
    text(`Confidential · Meridian Bank (fictional) · Prepared for ${rmName} · Source: ${sourceLabel}, data as of ${fmtDate(AS_OF)}`, M, H - 22);
    text(`Page ${i} of ${pages}`, W - M, H - 22, { align: "right" });
  }
  const safe = p.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ");
  const stamp = `${AS_OF.getFullYear()}-${String(AS_OF.getMonth() + 1).padStart(2, "0")}-${String(AS_OF.getDate()).padStart(2, "0")}`;
  doc.save(`Meeting brief - ${safe} - ${stamp}.pdf`);
}
