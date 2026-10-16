/* =============================================================================
   Client IQ Demonstrator - Relationship Manager Portal
   ---------------------------------------------------------------------------
   The views never touch Qlik or files directly. They ask a provider for a
   normalised "book" (customers, holdings, meetings, ...). Two providers:

     QlikProvider  - signs in with OAuth (interactive, single-page app), opens the
                     demonstrator app, creates one hypercube per dataset as a
                     session object, selects the signed-in RM's rm_id and reads
                     the cubes. If selections change elsewhere (for example in
                     Qlik Sense in another tab) the cubes fire 'changed' and the
                     portal re-reads them.
     MockProvider  - reads data.json, the same extract the prototype used.

   For production, QlikProvider swaps "select rm_id in a shared app" for
   "create a session app with the RM's load script"; the rest stays the same.
   ============================================================================= */
import { MODE, QLIK, QLIK_API_URL } from "./config.js";

const DAY = 86400000;
const REVOLVING = new Set(["RCF", "INV", "TRD", "CARD"]);
let AS_OF = new Date(new Date().toDateString());

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const group = (rows, key) => rows.reduce((m, r) => ((m[r[key]] ||= []).push(r), m), {});
const parseD = s => s ? new Date(s.length > 10 ? s : s + "T00:00:00") : null;
const days = (a, b) => Math.round((b - a) / DAY);
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtDate = d => d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : "—";
const fmtShort = d => d ? `${d.getDate()} ${MON[d.getMonth()]}` : "—";
const fmtTime = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmtMonth = ym => { const [y, m] = ym.split("-"); return `${MON[+m - 1]} ${y.slice(2)}`; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = d => ymd(d).slice(0, 7);
function gbp(v, opts = {}) {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : (opts.sign && v > 0 ? "+" : "");
  if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e4) return `${s}£${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}£${(a / 1e3).toFixed(1)}k`;
  return `${s}£${Math.round(a)}`;
}
const pct = (v, sign) => v == null || !isFinite(v) ? "—" : `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(0)}%`;
const ago = n => n == null ? "never" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

/* ---------- coverage, signals, talking points ---------- */
const COVERAGE = [
  { key: "Overdue - not booked", c: "var(--critical)" },
  { key: "Overdue - booked", c: "var(--serious)" },
  { key: "Due soon - not booked", c: "var(--warning)" },
  { key: "Due soon - booked", c: "var(--qlik-casper)" },
  { key: "Within cadence", c: "var(--good)" }
];
const covColor = k => (COVERAGE.find(x => x.key === k) || {}).c || "var(--ink-3)";
// In production these become load-script flags or master measures, so the
// portal and Qlik Answers share one definition.
const SIGNALS = {
  covBreach:   { label: "Covenant breach", sev: "critical" },
  compHold:    { label: "Compliance hold", sev: "critical" },
  complaint:   { label: "Open complaint", sev: "critical" },
  moved:       { label: "Money moving out", sev: "critical" },
  renewal:     { label: "Renewal not raised", sev: "serious" },
  competitor:  { label: "Competitor mentioned", sev: "serious" },
  watchlist:   { label: "On watchlist", sev: "serious" },
  downgrade:   { label: "Credit grade down", sev: "serious" },
  covTight:    { label: "Covenant headroom tight", sev: "warning" },
  compAction:  { label: "Compliance action due", sev: "warning" },
  lowRoRWA:    { label: "Below RoRWA hurdle", sev: "warning" },
  inflowsDown: { label: "Inflows falling", sev: "warning" },
  utilHigh:    { label: "Facility near limit", sev: "warning" },
  cancels:     { label: "Meetings cancelled", sev: "warning" },
  stalled:     { label: "Deal stalled", sev: "warning" },
  fxGap:       { label: "FX opportunity", sev: "opportunity" },
  idleCash:    { label: "Surplus cash", sev: "opportunity" },
  growth:      { label: "Trading growth", sev: "opportunity" },
  utilLow:     { label: "Facility barely used", sev: "info" },
  newContact:  { label: "New key contact", sev: "info" },
  noMeeting:   { label: "Calls but no meeting", sev: "warning" },
  admin:       { label: "Annual review due", sev: "admin" }
};
const SEV_ORDER = ["critical", "serious", "warning", "opportunity", "info", "admin"];
const SEV_LABEL = { critical: "Critical", serious: "Serious", warning: "Watch", opportunity: "Opportunity", info: "Note", admin: "Admin" };
const SEV_COLOR = { critical: "var(--critical)", serious: "var(--serious)", warning: "var(--warning)", opportunity: "var(--opportunity)", info: "var(--qlik-casper)", admin: "var(--line-strong)" };
const chip = code => { const s = SIGNALS[code]; return `<span class="chip ${s.sev}"><i></i>${esc(s.label)}</span>`; };
const COMPETITOR = /approach from a competitor|another provider/i;
const COV_ORDER = ["Breach", "Tight", "Breach - waived", "Pass", "Not yet tested"];
const CHECK_ORDER = ["Under review", "Overdue", "Pending", "Clear"];
const GRADE_BAND = { 1: "Strong", 2: "Strong", 3: "Good", 4: "Good", 5: "Satisfactory", 6: "Satisfactory", 7: "Watch", 8: "Weak", 9: "Substandard", 10: "Default" };
const pct1 = v => v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;

/* =============================================================================
   BookProvider: shared logic. Subclasses fill this.idx (see shape below) and
   this.rms, then call this.buildBook(rmId).
   idx = { customers[], contacts{cid}, holdings{cid}, opps{cid}, cases{cid},
           meetings{cid}, touches{cid}, months[], series{cid}, utilHist{hid},
           revenue12m{cid}, lastMeetingEver{cid}, lastContact{cid} }
   ============================================================================= */
class BookProvider {
  constructor() { this.drafts = []; this.rms = []; this.idx = null; this.book = []; this.listeners = new Set(); }
  onChange(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach(fn => fn()); }

  buildBook(rmId) {
    this.rm = this.rms.find(r => r.id === rmId) || this.rms[0];
    this.book = this.idx.customers.filter(c => c.rm_id === this.rm.id).map(c => this.profile(c));
    this.drafts = this.drafts.filter(d => this.book.some(p => p.id === d.p.id));
  }

  profile(c) {
    const id = c.customer_id, ix = this.idx;
    const holdings = (ix.holdings[id] || []).slice().sort((a, b) => b.annual_income_gbp - a.annual_income_gbp);
    const meetings = (ix.meetings[id] || []).slice().sort((a, b) => b.startD - a.startD);
    const cases = (ix.cases[id] || []).slice().sort((a, b) => (b.opened_date > a.opened_date ? 1 : -1));
    const opps = ix.opps[id] || [];
    const contacts = (ix.contacts[id] || []).slice().sort((a, b) => b.is_primary - a.is_primary || b.is_decision_maker - a.is_decision_maker);
    const touches = (ix.touches[id] || []).slice().sort((a, b) => (b.interaction_date > a.interaction_date ? 1 : -1));
    const lastMeeting = parseD(ix.lastMeetingEver[id]);
    const draft = this.drafts.find(d => d.p.id === id);
    const next = meetings.filter(m => m.status === "Scheduled" && m.startD >= AS_OF).sort((a, b) => a.startD - b.startD)[0] || draft?.m || null;
    const active = c.status === "Active";
    const daysSince = lastMeeting ? days(lastMeeting, AS_OF) : null;
    const interval = c.interval;
    let coverage = null;
    if (active) {
      if (daysSince == null || daysSince > interval) coverage = next ? "Overdue - booked" : "Overdue - not booked";
      else if (daysSince > interval - 30) coverage = next ? "Due soon - booked" : "Due soon - not booked";
      else coverage = "Within cadence";
    }
    const lastContact = parseD(ix.lastContact[id]);
    const s = ix.series[id];
    const ser = s ? { balance: s[0], credits: s[1], spend: s[2], moved: s[3], intl: s[4] } : null;
    const lastN = (arr, n, off = 0) => arr ? arr.slice(Math.max(0, arr.length - n - off), arr.length - off) : [];
    const cr3 = ser ? sum(lastN(ser.credits, 3, 1)) : 0, cr3p = ser ? sum(lastN(ser.credits, 3, 4)) : 0;
    const cr6 = ser ? sum(lastN(ser.credits, 6, 1)) : 0, cr6p = ser ? sum(lastN(ser.credits, 6, 7)) : 0;
    const spend3 = ser ? sum(lastN(ser.spend, 3, 1)) / 3 : 0;
    const balance = ser ? ser.balance.filter(v => v != null).slice(-1)[0] ?? null : null;
    const moved6 = ser ? sum(lastN(ser.moved, 6)) : 0;
    const intl12 = ser ? sum(lastN(ser.intl, 12)) : 0;
    const income = sum(holdings.map(h => h.annual_income_gbp));
    const codes = new Set(holdings.map(h => h.code));
    const lending = holdings.filter(h => h.category === "Lending");
    const revolving = holdings.filter(h => REVOLVING.has(h.code) && h.utilisation_pct != null);
    const renewalsAtRisk = holdings.filter(h => { const m = parseD(h.maturity_date); return m && m > AS_OF && days(AS_OF, m) <= 120 && !h.has_open_renewal; });
    const openComplaints = cases.filter(k => k.status === "Open" && k.is_complaint);
    const since6 = new Date(AS_OF.getTime() - 183 * DAY);
    const notesRecent = [...meetings.filter(m => m.notes && m.startD >= since6 && m.startD < AS_OF).map(m => ({ d: m.startD, t: m.notes })),
                         ...touches.filter(t => parseD(t.interaction_date) >= since6).map(t => ({ d: parseD(t.interaction_date), t: t.notes || "" }))];
    const competitor = notesRecent.filter(n => COMPETITOR.test(n.t)).sort((a, b) => b.d - a.d)[0] || null;
    const cancels12 = meetings.filter(m => (m.status === "Cancelled" || m.status === "No-show") && m.startD < AS_OF && days(m.startD, AS_OF) <= 365);
    const newContact = contacts.find(x => x.relationship_strength === "New");
    const stalled = opps.filter(o => days(parseD(o.stage_entered_date), AS_OF) > 90);
    const arDue = parseD(c.next_annual_review_date), kyc = parseD(c.kyc_refresh_due_date);
    // business health (business customers only)
    const financials = (ix.financials?.[id] || []).slice().sort((a, b) => (a.period_end > b.period_end ? 1 : -1));
    const grades = (ix.grades?.[id] || []).slice().sort((a, b) => (a.effective_date > b.effective_date ? 1 : -1));
    const hById = Object.fromEntries(holdings.map(h => [h.holding_id, h]));
    const covenants = (ix.covenants?.[id] || []).map(k => ({ ...k, product: hById[k.holding_id]?.product || "Facility" }))
      .sort((a, b) => COV_ORDER.indexOf(a.result) - COV_ORDER.indexOf(b.result));
    // compliance
    const checks = (ix.compliance?.[id] || []).slice().sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status) || (b.raised_date > a.raised_date ? 1 : -1));
    const openChecks = checks.filter(k => k.status !== "Clear");
    // capital
    const rwa = sum(holdings.map(h => h.rwa_gbp || 0)), ead = sum(holdings.map(h => h.ead_gbp || 0));
    const p = {
      id, c, name: c.customer_name, segment: c.segment, active, interval, freqLabel: c.freqLabel || "", inPerson: c.inPerson,
      holdings, meetings, cases, opps, contacts, touches, months: ix.months, ser, next, lastMeeting, daysSince, coverage,
      lastContact, daysSinceContact: lastContact ? days(lastContact, AS_OF) : null,
      income, revenue12: ix.revenue12m[id] || 0, balance, moved6, intl12, codes, lending, revolving,
      inflowChange3: cr3p > 0 ? cr3 / cr3p - 1 : null, inflowChange6: cr6p > 0 ? cr6 / cr6p - 1 : null, spend3,
      renewalsAtRisk, openComplaints, competitor, cancels12, newContact, stalled, arDue, kyc,
      grade: c.credit_grade ?? null, gradeLabel: c.credit_grade_label || (c.credit_grade ? `${c.credit_grade} - ${GRADE_BAND[c.credit_grade]}` : null),
      gradeChange6m: c.grade_change_6m ?? null, extRating: c.external_rating || null, financials, grades, covenants,
      covBreach: covenants.filter(k => k.result === "Breach"), covTight: covenants.filter(k => k.result === "Tight"),
      checks, openChecks, blockers: openChecks.filter(k => k.blocks), complianceStatus: c.compliance_status || null,
      cdd: c.cdd_level || null, pep: c.is_pep === "Yes" || c.is_pep === 1, holds: opps.filter(o => o.compliance_hold),
      rwa, ead, rorwa: rwa > 0 ? income / rwa : null, capital: rwa * (ix.capital?.ratio ?? 13) / 100,
      hurdle: (ix.capital?.hurdle ?? 5) / 100, rwaHist: ix.rwaHist?.[id] || null
    };
    p.ideas = this.capitalIdeas(p);
    p.signals = this.signals(p);
    p.points = this.talkingPoints(p);
    p.score = this.priority(p);
    return p;
  }

  signals(p) {
    if (!p.active) return [];
    const s = [];
    if (p.covBreach.length) s.push("covBreach");
    if (p.blockers.length) s.push("compHold");
    if (p.openComplaints.length) s.push("complaint");
    if (p.moved6 > 0) s.push("moved");
    if (p.renewalsAtRisk.length) s.push("renewal");
    if (p.competitor) s.push("competitor");
    if (p.grade >= 8) s.push("watchlist");
    else if (p.gradeChange6m >= 1) s.push("downgrade");
    if (p.covTight.length) s.push("covTight");
    if (!p.blockers.length && p.openChecks.length) s.push("compAction");
    if (p.rorwa != null && p.rorwa < p.hurdle) s.push("lowRoRWA");
    if (p.inflowChange3 != null && p.inflowChange3 < -0.15) s.push("inflowsDown");
    if (p.revolving.some(h => h.utilisation_pct >= 85)) s.push("utilHigh");
    if (p.cancels12.length >= 2) s.push("cancels");
    if (p.stalled.length) s.push("stalled");
    if (p.intl12 > 0 && !p.codes.has("FX") && p.segment !== "Private Banking") s.push("fxGap");
    const deposit = p.segment === "Private Banking" ? (p.codes.has("PDP") || p.codes.has("DIM")) : p.codes.has("DEP");
    if (p.balance != null && p.spend3 > 0 && p.balance > (p.segment === "Private Banking" ? 6 : 3) * p.spend3 && !deposit) s.push("idleCash");
    if (p.inflowChange6 != null && p.inflowChange6 > 0.15 && !s.includes("moved")) s.push("growth");
    if (p.revolving.some(h => h.utilisation_pct <= 10)) s.push("utilLow");
    if (p.newContact) s.push("newContact");
    if (p.daysSinceContact != null && p.daysSinceContact <= 60 && (p.daysSince == null || p.daysSince > 365)) s.push("noMeeting");
    if ((p.arDue && p.arDue <= AS_OF) || (!p.checks.length && p.kyc && days(AS_OF, p.kyc) <= 60)) s.push("admin");
    return s;
  }

  talkingPoints(p) {
    if (!p.active) return [];
    const pts = [], add = (sev, title, ev, act) => pts.push({ sev, title, ev, act });
    const covVal = k => k.actual == null ? "n/m" : k.type.startsWith("Loan to value") ? `${k.actual.toFixed(0)}%` : `${k.actual.toFixed(1)}x`;
    const covLim = k => k.type.startsWith("Loan to value") ? `${k.threshold.toFixed(0)}%` : `${k.threshold.toFixed(2).replace(/0$/, "")}x`;
    const covName = k => k.type.replace(/ \(.*\)$/, "").toLowerCase();
    p.covBreach.forEach(k => add("critical", `${covName(k)[0].toUpperCase() + covName(k).slice(1)} covenant breached on the ${k.product}`,
      `${k.type}: ${covVal(k)} against a ${k.op === "Max" ? "maximum" : "minimum"} of ${covLim(k)} at ${fmtDate(parseD(k.period_end))}.`,
      "Agree the approach with Credit before the meeting: waiver, reset or a remedy plan."));
    p.blockers.forEach(k => {
      const screening = /screening|media/i.test(k.type);
      add("critical", screening ? `${k.type} alert under review: new business on hold` : `${k.type} overdue: new business on hold`,
        `${k.outcome || ""}${k.due_date ? ` Due ${fmtDate(parseD(k.due_date))}.` : ""}${p.holds.length ? ` ${p.holds.length} open opportunit${p.holds.length > 1 ? "ies" : "y"} on hold.` : ""}`,
        screening ? "Do not raise the alert with the customer. Check with the Financial Crime team before the meeting."
                  : "Collect the outstanding documents in this meeting; nothing new can complete until the review is signed off.");
    });
    p.openComplaints.forEach(k => add("critical", `Open complaint: ${String(k.category).replace("Complaint - ", "")}`,
      `Opened ${fmtDate(parseD(k.opened_date))} (${days(parseD(k.opened_date), AS_OF)} days ago, ${k.priority} priority). ${k.description}`,
      "Acknowledge it at the start of the meeting and confirm the resolution date with the service team beforehand."));
    if (p.moved6 > 0) add("critical", `${gbp(p.moved6)} moved to another bank in the last 6 months`,
      `Inflows ${pct(p.inflowChange3, true)} over the last 3 months against the 3 before.`,
      "Open a retention conversation: ask what the other provider offers and what would bring the balances back.");
    if (p.competitor) add("serious", "Competitor approach mentioned",
      `Recorded ${fmtDate(p.competitor.d)}: “${p.competitor.t.split(". ").find(x => COMPETITOR.test(x)) || ""}”`,
      "Agree pricing headroom with your sales manager before the meeting.");
    if (p.grade >= 8 || p.gradeChange6m >= 1) {
      const last = p.grades[p.grades.length - 1];
      add("serious", p.grade >= 10 ? "Customer is in default" : `Credit grade ${p.gradeChange6m >= 1 ? `down ${p.gradeChange6m} notch${p.gradeChange6m > 1 ? "es" : ""} to` : "is"} ${p.gradeLabel}`,
        `${last ? `${last.reason} (${fmtDate(parseD(last.effective_date))}).` : ""}${p.grade >= 8 ? " On the watchlist." : ""}`,
        p.grade >= 10 ? "Follow the recovery team's plan; do not offer new facilities." : "Talk through the drivers and ask for the latest management accounts and forecast.");
    }
    p.renewalsAtRisk.forEach(h => add("serious", `${h.product} matures ${fmtDate(parseD(h.maturity_date))}, no renewal raised`,
      `${gbp(h.amount_gbp)} facility earning ${gbp(h.annual_income_gbp)} a year; ${days(AS_OF, parseD(h.maturity_date))} days to maturity.`,
      "Raise the renewal opportunity and agree the timetable in the meeting."));
    p.revolving.filter(h => h.utilisation_pct >= 85).forEach(h => add("warning", `${h.product} at ${h.utilisation_pct.toFixed(0)}% of its limit`,
      `${gbp(h.drawn_amount_gbp)} drawn of ${gbp(h.amount_gbp)}.`, "Ask about working-capital pressure and whether a limit increase is needed."));
    if (p.inflowChange3 != null && p.inflowChange3 < -0.15 && p.moved6 <= 0) add("warning", `Inflows down ${pct(-p.inflowChange3)}`,
      "Last 3 complete months against the 3 before.", "Ask how trading is going and whether income is being paid elsewhere.");
    p.covTight.forEach(k => add("warning", `Tight ${covName(k)} headroom on the ${k.product}`,
      `${covVal(k)} against ${covLim(k)} (${k.headroom != null ? k.headroom.toFixed(0) + "% headroom" : "little headroom"}).`,
      "Ask about the trading outlook before the next test date."));
    p.openChecks.filter(k => !k.blocks).forEach(k => add("warning", `${k.type}: ${k.status.toLowerCase()}`,
      `${k.outcome || ""}${k.due_date ? ` Due ${fmtDate(parseD(k.due_date))}.` : ""}`,
      /ownership/i.test(k.type) ? "Collect ID and ownership details for the new controller." : /wealth/i.test(k.type) ? "Ask for evidence of the source of the funds." : "Collect any updated documents while you are with the customer."));
    if (p.rorwa != null && p.rorwa < p.hurdle) add("warning", `Return on RWA ${pct1(p.rorwa)} against a ${pct1(p.hurdle)} hurdle`,
      `${gbp(p.income)} income a year on ${gbp(p.rwa)} of risk weighted assets (${gbp(p.capital)} of capital).`,
      p.ideas[0] ? `${p.ideas[0].title}.` : "Review pricing and facility sizes before the next renewal.");
    if (p.cancels12.length >= 2) add("warning", `${p.cancels12.length} meetings cancelled or missed in 12 months`,
      p.cancels12.slice(0, 3).map(m => `${fmtDate(m.startD)}: ${m.cancellation_reason || m.status}`).join("; "),
      "Confirm this meeting the day before and keep it short and specific.");
    p.stalled.forEach(o => add("warning", `${o.product} stalled at ${o.stage}`,
      `${days(parseD(o.stage_entered_date), AS_OF)} days in stage; close date pushed ${o.close_date_pushes || 0} times.`, "Agree a decision date or close it out."));
    if (p.signals.includes("fxGap")) add("opportunity", `${gbp(p.intl12)} paid to overseas suppliers, no FX product`,
      "International payments in the last 12 months, all at standard rates.", "Introduce the FX & Markets specialist.");
    if (p.signals.includes("idleCash")) add("opportunity", `Surplus cash: ${gbp(p.balance)} in the current account`,
      `About ${(p.balance / p.spend3).toFixed(0)} months of operating spend, with no deposit or investment product.`, "Suggest a deposit sweep or investment conversation.");
    if (p.signals.includes("growth")) add("opportunity", `Inflows up ${pct(p.inflowChange6)} on the previous 6 months`,
      "Trading growth usually brings working-capital and investment needs.", "Ask about expansion plans and funding requirements.");
    p.revolving.filter(h => h.utilisation_pct <= 10).forEach(h => add("info", `${h.product} barely used (${h.utilisation_pct.toFixed(0)}%)`,
      `${gbp(h.amount_gbp)} limit with commitment fees.`, "Check it is still the right size before the customer raises the fee."));
    if (p.newContact) add("info", `New ${p.newContact.job_title}: ${p.newContact.contact_name}`,
      `Known since ${fmtDate(parseD(p.newContact.known_since))}.`, "Use the meeting to build the relationship and explain current facilities.");
    if (p.signals.includes("noMeeting")) add("warning", "Regular calls and emails, but no meeting for over a year",
      `Last meeting: ${p.lastMeeting ? fmtDate(p.lastMeeting) : "none on record"}. Last contact ${ago(p.daysSinceContact)}.`, "Make this a face-to-face meeting.");
    if (p.arDue && p.arDue <= AS_OF) add("admin", "Annual review overdue", `Was due ${fmtDate(p.arDue)}.`, "Complete the annual review in this meeting.");
    if (!p.checks.length && p.kyc && days(AS_OF, p.kyc) <= 60) add("admin", "KYC refresh due", `Due ${fmtDate(p.kyc)}.`, "Collect any updated documents while you are with the customer.");
    return pts.sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
  }

  priority(p) {
    if (!p.active) return 0;
    const w = { covBreach: 22, compHold: 18, watchlist: 12, downgrade: 8, covTight: 6, compAction: 4, lowRoRWA: 5, complaint: 20, moved: 25, renewal: 18, competitor: 10, inflowsDown: 8, utilHigh: 8, cancels: 10, stalled: 4,
      fxGap: 4, idleCash: 3, growth: 3, utilLow: 2, newContact: 6, noMeeting: 12, admin: 5 };
    let s = sum(p.signals.map(x => w[x] || 0));
    if (p.coverage === "Overdue - not booked") s += 30;
    else if (p.coverage === "Overdue - booked") s += 8;
    else if (p.coverage === "Due soon - not booked") s += 6;
    s *= 1 + Math.log10(1 + p.income / 50000) / 2;
    return Math.round(s);
  }

  // Ways to improve return on RWA. Simplified CRR logic, for discussion with the customer.
  capitalIdeas(p) {
    if (!p.active || !(p.rwa > 0)) return [];
    const ideas = [], H = p.hurdle, rwEff = h => h.ead_gbp > 0 ? h.rwa_gbp / h.ead_gbp : 0;
    p.holdings.filter(h => (h.code === "RCF" || h.code === "INV") && h.utilisation_pct != null && h.utilisation_pct <= 25 && h.rwa_gbp > 0).forEach(h => {
      const hist = (this.idx.utilHist[h.holding_id] || []).filter(v => v != null);
      const peak = Math.max(h.utilisation_pct, ...hist) / 100;
      const newLimit = Math.max(Math.ceil(h.amount_gbp * peak * 1.3 / 50000) * 50000, 50000);
      if (newLimit >= h.amount_gbp * 0.85) return;
      const save = (h.amount_gbp - newLimit) * 0.5 * rwEff(h);
      ideas.push({ kind: "resize", title: `Right-size the ${h.product} limit from ${gbp(h.amount_gbp)} to ${gbp(newLimit)}`,
        detail: `Peak use in the last 12 months was ${(peak * 100).toFixed(0)}% of the limit. The undrawn part still carries a 50% conversion factor.`,
        save, income: -h.annual_income_gbp * (1 - newLimit / h.amount_gbp) * 0.35 });
    });
    const unrated = p.holdings.filter(h => h.exposure_class === "Corporate - unrated" && h.rwa_gbp > 0);
    if (unrated.length && p.grade && p.grade <= 4) ideas.push({ kind: "rating", title: "An external credit rating would halve the risk weight",
      detail: `With a rating in credit quality step 2 (A+ to A-), corporate exposures are weighted at 50% rather than 100% under CRR.`,
      save: sum(unrated.map(h => h.rwa_gbp)) * 0.5, income: 0 });
    p.holdings.filter(h => h.code === "CRE" && h.ltv_pct > 55 && h.property_value_gbp > 0 && h.rwa_gbp > 0).forEach(h => {
      const half = 0.5 * h.property_value_gbp, after = half * 0.5 * (h.sme_factor || 1);
      if (h.rwa_gbp - after <= 0) return;
      ideas.push({ kind: "ltv", title: `Paying the ${h.product} down to 50% LTV would save ${gbp(h.rwa_gbp - after)} of RWA`,
        detail: `LTV is ${h.ltv_pct.toFixed(0)}%. Only the part up to 50% of the property value gets the 50% risk weight; the rest is weighted at the borrower's rate. Paydown needed: ${gbp((h.drawn_amount_gbp || 0) - half)}.`,
        save: h.rwa_gbp - after, income: -h.annual_income_gbp * (1 - half / Math.max(1, h.drawn_amount_gbp || 1)) });
    });
    p.holdings.filter(h => h.category === "Lending" && h.rwa_gbp > 0 && h.code !== "FX" && h.annual_income_gbp / h.rwa_gbp < H && (h.drawn_amount_gbp || 0) > 0)
      .sort((a, b) => b.rwa_gbp - a.rwa_gbp).slice(0, 2).forEach(h => {
        const extra = H * h.rwa_gbp - h.annual_income_gbp;
        ideas.push({ kind: "price", title: `Reprice the ${h.product}: +${Math.ceil(extra / h.drawn_amount_gbp * 1e4)} bps reaches the hurdle`,
          detail: `Earns ${gbp(h.annual_income_gbp)} a year on ${gbp(h.rwa_gbp)} of RWA (${pct1(h.annual_income_gbp / h.rwa_gbp)}). Raise at the next renewal or margin review.`,
          save: 0, income: extra });
      });
    if (p.signals?.includes?.("idleCash") || (p.balance != null && p.spend3 > 0 && p.balance > 3 * p.spend3 && !p.codes.has("DEP") && p.segment !== "Private Banking")) {
      const amt = Math.max(0, p.balance - 3 * p.spend3);
      if (amt > 50000) ideas.push({ kind: "deposit", title: `Move ${gbp(amt)} of surplus cash to a deposit`,
        detail: `Earns about ${gbp(amt * 0.008)} a year and uses no lending capital.`, save: 0, income: amt * 0.008 });
    }
    p.opps.filter(o => o.expected_rwa_gbp > 0 && o.expected_annual_income_gbp / o.expected_rwa_gbp < H).forEach(o => ideas.push({ kind: "deal",
      title: `Price the ${o.product} deal to the hurdle`,
      detail: `Expected ${gbp(o.expected_annual_income_gbp)} a year on ${gbp(o.expected_rwa_gbp)} of RWA (${pct1(o.expected_annual_income_gbp / o.expected_rwa_gbp)}). Needs ${gbp(H * o.expected_rwa_gbp)} a year.`,
      save: 0, income: 0, pipeline: true }));
    ideas.forEach(i => { i.after = (p.income + (i.income || 0)) / Math.max(1, p.rwa - (i.save || 0)); });
    return ideas.sort((a, b) => (b.after - a.after) || (b.save - a.save));
  }

  bookRows() { return this.book; }
  diaryRows(fromDays = 0, toDays = 13) {
    const from = new Date(AS_OF.getTime() + fromDays * DAY), to = new Date(AS_OF.getTime() + (toDays + 1) * DAY);
    const rows = [];
    for (const p of this.book) for (const m of p.meetings) if (m.status === "Scheduled" && m.startD >= from && m.startD < to) rows.push({ m, p });
    for (const d of this.drafts) if (d.m.startD >= from && d.m.startD < to) rows.push({ m: d.m, p: this.brief(d.p.id) || d.p });
    return rows.sort((a, b) => a.m.startD - b.m.startD);
  }
  brief(id) { return this.book.find(p => p.id === id) || null; }
  proposeMeeting(p) {
    // Phase 2: write to the bank's diary through an API or Qlik Automate.
    let d = new Date(AS_OF.getTime() + 2 * DAY);
    while (d.getDay() === 0 || d.getDay() === 6) d = new Date(d.getTime() + DAY);
    d.setHours(10, 0);
    const m = { meeting_id: "draft-" + p.id, startD: d, duration_mins: 60, meeting_type: "Relationship Review", channel: "In person",
      location: "To be confirmed", status: "Scheduled", draft: true, agenda: p.points.slice(0, 3).map(x => x.title).join("; ") || "Relationship review" };
    this.drafts.push({ m, p });
    const i = this.book.findIndex(b => b.id === p.id);
    if (i >= 0) this.book[i] = this.profile(p.c);
    return m;
  }
}

/* =============================================================================
   MockProvider - data.json (the prototype's extract)
   ============================================================================= */
class MockProvider extends BookProvider {
  get label() { return "Sample data"; }
  async connect(onStep) {
    onStep?.(["Loading sample data"], 0);
    const raw = await (await fetch("data.json")).json();
    AS_OF = parseD(raw.asOf);
    this.generated = raw.generated;
    const rows = (cols, arr) => arr.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    this.rms = raw.rms;
    const customers = rows(raw.customerCols, raw.customers).map(c => {
      const [interval, freqLabel, inPerson] = raw.policy[c.segment];
      return { ...c, interval, freqLabel, inPerson };
    });
    const meetings = rows(raw.meetingCols, raw.meetings).map(m => {
      const sp = m.specialist_id ? raw.specialists[m.specialist_id] : null;
      return { ...m, startD: parseD(m.start), origD: parseD(m.orig), specialistName: sp?.[0] || null, specialism: sp?.[1] || null };
    });
    const contacts = rows(raw.contactCols, raw.contacts);
    const byContact = Object.fromEntries(contacts.map(c => [c.contact_id, c]));
    meetings.forEach(m => { const ct = byContact[m.contact_id]; m.contactName = ct?.contact_name || null; m.contactTitle = ct?.job_title || null; });
    this.idx = {
      customers,
      contacts: group(contacts, "customer_id"),
      holdings: group(rows(raw.holdingCols, raw.holdings).map(h => { const [code, name, cat] = raw.products[h.product_id]; return { ...h, code, product: name, category: cat }; }), "customer_id"),
      opps: group(rows(raw.oppCols, raw.opps).map(o => ({ ...o, product: raw.products[o.product_id][1] })), "customer_id"),
      cases: group(rows(raw.caseCols, raw.cases), "customer_id"),
      meetings: group(meetings, "customer_id"),
      touches: group(rows(raw.touchCols, raw.touches), "customer_id"),
      months: raw.months, series: raw.series, utilHist: raw.utilHist, revenue12m: raw.revenue12m,
      lastMeetingEver: raw.lastMeetingEver, lastContact: raw.lastContact,
      financials: raw.financialCols ? group(rows(raw.financialCols, raw.financials), "customer_id") : {},
      grades: raw.gradeCols ? group(rows(raw.gradeCols, raw.grades), "customer_id") : {},
      covenants: raw.covenantCols ? group(rows(raw.covenantCols, raw.covenants), "customer_id") : {},
      compliance: raw.checkCols ? group(rows(raw.checkCols, raw.checks).map(k => ({ ...k, blocks: !!k.blocks })), "customer_id") : {},
      rwaHist: raw.rwaHist || {}, capital: raw.capital || null
    };
    onStep?.(["Loading sample data"], 1);
  }
  async openRm(rmId, onStep) {
    const rm = this.rms.find(r => r.id === rmId);
    const steps = ["Selecting relationship manager", `Reading ${rm.name}'s book`];
    onStep?.(steps, 0); await sleep(200); onStep?.(steps, 1); await sleep(250);
    this.buildBook(rmId); onStep?.(steps, 2);
  }
  defaultRm() {
    const busy = id => sum(Object.values(this.idx.meetings).flat().map(m => m.rm_id === id && m.status === "Scheduled" && m.startD < new Date(AS_OF.getTime() + 7 * DAY) ? 1 : 0));
    return this.rms.slice().sort((a, b) => busy(b.id) - busy(a.id))[0].id;
  }
}

/* =============================================================================
   QlikProvider - @qlik/api, OAuth2 single-page app, one hypercube per dataset
   ============================================================================= */
const OPSPEND = "Sum({<direction={'Debit'}, category-={'Loan repayment','Transfer to external account','Transfer to investments','Pension contribution'}>} txn_amount_gbp)";
export const QCUBES = {
  rms:          { dims: ["rm_id", "rm_name", "rm_region", "sales_manager", "rm_team"], measures: [] },
  customers:    { dims: ["customer_id", "customer_name", "segment", "industry", "customer_city", "rm_id", "customer_status", "risk_rating",
                         "onboarded_date", "last_annual_review_date", "next_annual_review_date", "kyc_refresh_due_date", "last_meeting_date",
                         "last_contact_date", "required_meeting_interval_days", "meeting_frequency", "required_in_person_per_year"],
                  measures: ["Max(annual_turnover_gbp)", "Max(net_worth_gbp)", "Only(credit_grade)", "Only(external_rating)", "Only(cdd_level)",
                             "Only(is_pep)", "Only(compliance_status)", "Max(grade_change_6m)"] },
  contacts:     { dims: ["contact_id", "customer_id", "contact_name", "contact_job_title", "contact_email", "contact_phone",
                         "contact_is_primary", "contact_is_decision_maker", "contact_relationship_strength", "contact_known_since"], measures: [] },
  holdings:     { dims: ["holding_id", "customer_id", "product_code", "product_name", "product_category", "holding_status", "holding_origin",
                         "open_date", "maturity_date"],
                  measures: ["Max(holding_amount_gbp)", "Max(drawn_amount_gbp)", "Max(holding_utilisation_pct)", "Max(holding_annual_income_gbp)", "Max(has_open_renewal)",
                             "Only(exposure_class)", "Max(holding_ead_gbp)", "Max(holding_risk_weight_pct)", "Max(holding_rwa_gbp)", "Max(holding_ltv_pct)",
                             "Max(property_value_gbp)", "Max(sme_factor)"] },
  opps:         { dims: ["opportunity_id", "customer_id", "opportunity_name", "opp_product_name", "opportunity_type", "opp_revenue_type",
                         "opp_stage", "opp_status", "stage_entered_date", "expected_close_date", "created_date"],
                  measures: ["Max(probability_pct)", "Max(expected_annual_income_gbp)", "Max(deal_amount_gbp)", "Max(close_date_pushes)",
                             "Max(opp_expected_rwa_gbp)", "Only(opp_compliance_hold)"] },
  cases:        { dims: ["case_id", "customer_id", "case_opened_date", "case_closed_date", "case_status", "case_category", "is_complaint",
                         "case_priority", "case_description"], measures: [] },
  meetings:     { dims: ["meeting_id", "customer_id", "meeting_start", "meeting_original_start", "meeting_type", "meeting_channel", "meeting_status",
                         "meeting_location", "meeting_agenda", "meeting_contact_name", "meeting_contact_title", "meeting_specialist",
                         "meeting_specialism", "meeting_cancelled_by", "meeting_cancellation_reason", "meeting_notes"],
                  measures: ["Max(meeting_duration_mins)", "Max(meeting_reschedule_count)"] },
  interactions: { dims: ["interaction_id", "customer_id", "interaction_date", "interaction_type", "interaction_subject", "interaction_sentiment",
                         "next_action", "interaction_meeting_id", "interaction_notes"], measures: [] },
  balances:     { dims: ["customer_id", "balance_month"], measures: ["Sum(closing_balance_gbp)", "Sum(total_credits_gbp)"] },
  flows:        { dims: ["customer_id", "txn_month"],
                  measures: [OPSPEND, "Sum({<category={'Transfer to external account'}>} txn_amount_gbp)", "Sum({<channel={'International Payment'}>} txn_amount_gbp)"] },
  utilisation:  { dims: ["holding_id", "utilisation_month"], measures: ["Max(facility_utilisation_pct)"] },
  financials:   { dims: ["customer_id", "statement_period_end", "statement_type"],
                  measures: ["Max(fs_turnover_gbp)", "Max(fs_ebitda_gbp)", "Max(fs_ebitda_margin_pct)", "Max(fs_net_debt_gbp)", "Max(fs_leverage_x)",
                             "Max(fs_interest_cover_x)", "Max(fs_current_ratio)", "Max(fs_debtor_days)", "Max(fs_cash_gbp)"] },
  grades:       { dims: ["grade_history_id", "customer_id", "grade_effective_date", "grade_change_reason"],
                  measures: ["Max(grade_history_grade)", "Max(grade_previous)"] },
  covenants:    { dims: ["covenant_id", "holding_id", "covenant_type", "covenant_operator", "covenant_latest_result"],
                  measures: ["Max(covenant_threshold)", "Max(covenant_latest_actual)", "Max(covenant_latest_headroom_pct)", "Max(covenant_period_end)"] },
  compliance:   { dims: ["check_id", "customer_id", "compliance_check_type", "compliance_check_status", "compliance_raised_date",
                         "compliance_due_date", "compliance_completed_date", "compliance_outcome", "compliance_blocks_new_business"], measures: [] },
  rwaHist:      { dims: ["customer_id", "rwa_month"], measures: ["Sum(rwa_month_rwa_gbp)"] },
  revenue:      { dims: ["customer_id"],
                  measures: ["Sum({<revenue_month={\">=$(=Date(AddMonths(MonthStart($(vAsOf)), -12), 'MMM YYYY'))\"}>} income_gbp)"] },
};
export function toHyperCubeDef(id, cube) {
  const width = cube.dims.length + cube.measures.length;
  return {
    qInfo: { qType: "rb-" + id },
    qHyperCubeDef: {
      qDimensions: cube.dims.map(f => ({ qDef: { qFieldDefs: [f] }, qNullSuppression: false })),
      qMeasures: cube.measures.map(m => ({ qDef: { qDef: m } })),
      qSuppressZero: false, qSuppressMissing: false,
      qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: width, qHeight: Math.floor(10000 / width) }]
    }
  };
}
// Qlik dates are day serials from 30 Dec 1899
const serialToDate = n => {
  if (n == null || isNaN(n)) return null;
  const ms = Math.round((n - 25569) * DAY);     // 25569 = 1 Jan 1970
  const u = new Date(ms);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
};
const cellText = c => (!c || c.qIsNull || c.qText == null) ? null : c.qText;
const cellNum = c => (!c || c.qIsNull || c.qNum === "NaN" || typeof c.qNum !== "number") ? null : c.qNum;
const cellDate = c => { const d = serialToDate(cellNum(c)); return d ? ymd(d) : null; };
const cellStamp = c => { const d = serialToDate(cellNum(c)); return d ? `${ymd(d)}T${fmtTime(d)}` : null; };

class QlikProvider extends BookProvider {
  get label() { return QLIK.authType === "anonymous" ? "Qlik Cloud (anonymous)" : "Qlik Cloud"; }
  async connect(onStep) {
    const steps = [QLIK.authType === "anonymous" ? "Connecting anonymously to Qlik Cloud" : "Signing in to Qlik Cloud", "Opening the app", "Creating data objects"];
    onStep?.(steps, 0);
    if (QLIK.authType === "anonymous" && [QLIK.host, QLIK.clientId, QLIK.accessCode, QLIK.appId].some(v => /^YOUR-/.test(v)))
      throw new Error("The anonymous tenant settings in config.js have not been filled in yet.");
    const { auth, qix } = await import(QLIK_API_URL);
    if (QLIK.authType === "anonymous") {
      auth.setDefaultHostConfig({ authType: "anonymous", host: QLIK.host, clientId: QLIK.clientId, accessCode: QLIK.accessCode });
    } else {
      auth.setDefaultHostConfig({
        authType: "oauth2", host: QLIK.host, clientId: QLIK.clientId, redirectUri: QLIK.redirectUri,
        accessTokenStorage: QLIK.accessTokenStorage, scope: "user_default",
      });
    }
    onStep?.(steps, 1);
    this.app = await qix.openAppSession(QLIK.appId).getDoc();
    this.generated = "live from Qlik Cloud";
    try {
      const a = await this.app.evaluate("Date($(vAsOf), 'YYYY-MM-DD')");
      if (/^\d{4}-\d{2}-\d{2}$/.test(a)) AS_OF = parseD(a);
    } catch (e) { console.warn("Could not read vAsOf; using today's date", e); }
    try {
      const h = parseFloat(await this.app.evaluate("$(vRoRWAHurdle)")), r = parseFloat(await this.app.evaluate("$(vCapitalRatio)"));
      this.capital = { hurdle: isFinite(h) ? h : 5, ratio: isFinite(r) ? r : 13 };
    } catch (e) { this.capital = { hurdle: 5, ratio: 13 }; }
    onStep?.(steps, 2);
    this.objs = {};
    for (const [id, cube] of Object.entries(QCUBES)) this.objs[id] = await this.app.createSessionObject(toHyperCubeDef(id, cube));
    // the full RM list, before any RM is selected
    await this.app.clearAll(false);
    this.rms = (await this.read("rms")).map(r => ({ id: cellNum(r[0]), name: cellText(r[1]), region: cellText(r[2]), manager: cellText(r[3]),
                                                     team: cellText(r[4]), teamOrder: cellNum(r[4]) }))
      .filter(r => r.id != null).sort((a, b) => a.name.localeCompare(b.name));
    // when selections change outside the portal, re-read the book
    this.objs.customers.on("changed", () => {
      // ignore the echo of the portal's own selections
      if (this.busy || Date.now() < (this.quietUntil || 0)) return;
      clearTimeout(this._t);
      this._t = setTimeout(async () => {
        if (this.busy || Date.now() < (this.quietUntil || 0)) return;
        this.busy = true;
        try { await this.readBook(); } finally { this.busy = false; this.quietUntil = Date.now() + 1000; }
        this.emit();
      }, 400);
    });
    onStep?.(steps, 3);
  }
  async read(id) {
    const obj = this.objs[id];
    const layout = await obj.getLayout();
    const hc = layout.qHyperCube;
    const width = hc.qSize.qcx, total = hc.qSize.qcy;
    let rows = hc.qDataPages?.[0]?.qMatrix || [];
    const pageH = Math.max(1, Math.floor(10000 / width));
    while (rows.length < total) {
      const pages = await obj.getHyperCubeData("/qHyperCubeDef", [{ qTop: rows.length, qLeft: 0, qWidth: width, qHeight: Math.min(pageH, total - rows.length) }]);
      const got = pages?.[0]?.qMatrix || [];
      if (!got.length) break;
      rows = rows.concat(got);
    }
    return rows;
  }
  async openRm(rmId, onStep) {
    const rm = this.rms.find(r => r.id === rmId);
    const steps = [`Selecting ${rm.name} in Qlik`, "Reading the book from the app"];
    this.busy = true;
    try {
      onStep?.(steps, 0);
      await this.app.clearAll(false);
      const f = await this.app.getField("rm_id");
      await f.selectValues([{ qText: String(rmId), qIsNumeric: true, qNumber: rmId }], false, false);
      onStep?.(steps, 1);
      await this.readBook();
      onStep?.(steps, 2);
    } finally { this.busy = false; this.quietUntil = Date.now() + 1500; }
  }
  async readBook() {
    const R = {};
    await Promise.all(Object.keys(QCUBES).filter(k => k !== "rms").map(async k => { R[k] = await this.read(k); }));
    const T = cellText, N = cellNum, D = cellDate;
    const customers = R.customers.map(r => ({
      customer_id: N(r[0]), customer_name: T(r[1]), segment: T(r[2]), industry: T(r[3]), city: T(r[4]), rm_id: N(r[5]),
      status: T(r[6]), risk_rating: T(r[7]), onboarded_date: D(r[8]), last_annual_review_date: D(r[9]), next_annual_review_date: D(r[10]),
      kyc_refresh_due_date: D(r[11]), _last_meeting: D(r[12]), _last_contact: D(r[13]), interval: N(r[14]), freqLabel: T(r[15]),
      inPerson: N(r[16]), annual_turnover_gbp: N(r[17]) || null, net_worth_gbp: N(r[18]) || null,
      credit_grade: N(r[19]), credit_grade_label: T(r[19]), external_rating: T(r[20]), cdd_level: T(r[21]), is_pep: T(r[22]),
      compliance_status: T(r[23]), grade_change_6m: N(r[24])
    })).filter(c => c.customer_id != null);
    const contacts = R.contacts.map(r => ({
      contact_id: N(r[0]), customer_id: N(r[1]), contact_name: T(r[2]), job_title: T(r[3]), email: T(r[4]), phone: T(r[5]),
      is_primary: T(r[6]) === "Yes" ? 1 : 0, is_decision_maker: T(r[7]) === "Yes" ? 1 : 0, relationship_strength: T(r[8]), known_since: D(r[9])
    })).filter(c => c.contact_id != null);
    const holdings = R.holdings.filter(r => T(r[5]) === "Active").map(r => ({
      holding_id: N(r[0]), customer_id: N(r[1]), code: T(r[2]), product: T(r[3]), category: T(r[4]), origin: T(r[6]),
      open_date: D(r[7]), maturity_date: D(r[8]), amount_gbp: N(r[9]) ?? 0, drawn_amount_gbp: N(r[10]), utilisation_pct: N(r[11]),
      annual_income_gbp: N(r[12]) ?? 0, has_open_renewal: N(r[13]) || 0, exposure_class: T(r[14]), ead_gbp: N(r[15]),
      risk_weight_pct: N(r[16]), rwa_gbp: N(r[17]), ltv_pct: N(r[18]), property_value_gbp: N(r[19]), sme_factor: N(r[20])
    }));
    const opps = R.opps.filter(r => T(r[7]) === "Open").map(r => ({
      opportunity_id: N(r[0]), customer_id: N(r[1]), opportunity_name: T(r[2]), product: T(r[3]), opportunity_type: T(r[4]),
      revenue_type: T(r[5]), stage: T(r[6]), stage_entered_date: D(r[8]), expected_close_date: D(r[9]), created_date: D(r[10]),
      probability_pct: N(r[11]), expected_annual_income_gbp: N(r[12]), deal_amount_gbp: N(r[13]), close_date_pushes: N(r[14]),
      expected_rwa_gbp: N(r[15]), compliance_hold: T(r[16]) === "Yes"
    }));
    const since12 = ymd(new Date(AS_OF.getTime() - 365 * DAY));
    const cases = R.cases.map(r => ({
      case_id: N(r[0]), customer_id: N(r[1]), opened_date: D(r[2]), closed_date: D(r[3]), status: T(r[4]), category: T(r[5]),
      is_complaint: N(r[6]) || 0, priority: T(r[7]), description: T(r[8])
    })).filter(k => k.case_id != null && (k.status === "Open" || k.opened_date >= since12));
    const inter = R.interactions.map(r => ({
      interaction_id: N(r[0]), customer_id: N(r[1]), interaction_date: D(r[2]), interaction_type: T(r[3]), subject: T(r[4]),
      sentiment: T(r[5]), next_action: T(r[6]), meeting_id: N(r[7]), notes: T(r[8])
    })).filter(x => x.interaction_id != null);
    const byMeeting = Object.fromEntries(inter.filter(x => x.meeting_id != null).map(x => [x.meeting_id, x]));
    const since18 = new Date(AS_OF.getTime() - 548 * DAY);
    const meetings = R.meetings.map(r => {
      const start = cellStamp(r[2]), orig = cellStamp(r[3]), id = N(r[0]), ix = byMeeting[id];
      return {
        meeting_id: id, customer_id: N(r[1]), start, orig, startD: parseD(start), origD: parseD(orig || start),
        meeting_type: T(r[4]), channel: T(r[5]), status: T(r[6]), location: T(r[7]), agenda: T(r[8]),
        contactName: T(r[9]), contactTitle: T(r[10]), specialistName: T(r[11]), specialism: T(r[12]),
        cancelled_by: T(r[13]), cancellation_reason: T(r[14]), notes: T(r[15]),
        duration_mins: N(r[16]), reschedule_count: N(r[17]) || 0, sentiment: ix?.sentiment || null, next_action: ix?.next_action || null
      };
    }).filter(m => m.meeting_id != null && m.startD && m.startD >= since18);
    // last completed meeting and last contact come from the customer coverage fields
    const lastMeetingEver = {}, lastContact = {};
    customers.forEach(c => { if (c._last_meeting) lastMeetingEver[c.customer_id] = c._last_meeting; if (c._last_contact) lastContact[c.customer_id] = c._last_contact; });
    // 24 months ending in the as-of month
    const months = [];
    for (let i = 23; i >= 0; i--) months.push(ym(new Date(AS_OF.getFullYear(), AS_OF.getMonth() - i, 1)));
    const mi = Object.fromEntries(months.map((m, i) => [m, i]));
    const series = {};
    const slot = cid => (series[cid] ||= [0, 1, 2, 3, 4].map(() => months.map(() => null)));
    R.balances.forEach(r => { const cid = N(r[0]), d = serialToDate(N(r[1])); if (cid == null || !d) return; const i = mi[ym(d)]; if (i == null) return; const s = slot(cid); s[0][i] = N(r[2]); s[1][i] = N(r[3]); });
    R.flows.forEach(r => { const cid = N(r[0]), d = serialToDate(N(r[1])); if (cid == null || !d) return; const i = mi[ym(d)]; if (i == null) return; const s = slot(cid); s[2][i] = N(r[2]) ?? 0; s[3][i] = N(r[3]) ?? 0; s[4][i] = N(r[4]) ?? 0; });
    Object.values(series).forEach(s => [2, 3, 4].forEach(k => { s[k] = s[k].map((v, i) => v ?? (s[1][i] != null ? 0 : null)); }));
    const utilHist = {};
    const from12 = ym(new Date(AS_OF.getFullYear(), AS_OF.getMonth() - 11, 1));
    R.utilisation.map(r => ({ h: N(r[0]), d: serialToDate(N(r[1])), v: N(r[2]) })).filter(x => x.h != null && x.d && ym(x.d) >= from12)
      .sort((a, b) => a.d - b.d).forEach(x => (utilHist[x.h] ||= []).push(x.v));
    const revenue12m = Object.fromEntries(R.revenue.map(r => [N(r[0]), N(r[1]) || 0]));
    const financials = R.financials.map(r => ({ customer_id: N(r[0]), period_end: D(r[1]), statement_type: T(r[2]), turnover: N(r[3]), ebitda: N(r[4]),
      margin: N(r[5]), net_debt: N(r[6]), leverage: N(r[7]), interest_cover: N(r[8]), current_ratio: N(r[9]), debtor_days: N(r[10]), cash: N(r[11]) }))
      .filter(f => f.customer_id != null && f.period_end);
    const grades = R.grades.map(r => ({ customer_id: N(r[1]), effective_date: D(r[2]), reason: T(r[3]), grade: N(r[4]), previous: N(r[5]) }))
      .filter(g => g.customer_id != null && g.effective_date);
    const holdingCust = Object.fromEntries(holdings.map(h => [h.holding_id, h.customer_id]));
    const covenants = R.covenants.map(r => ({ covenant_id: N(r[0]), holding_id: N(r[1]), customer_id: holdingCust[N(r[1])], type: T(r[2]), op: T(r[3]),
      result: T(r[4]), threshold: N(r[5]), actual: N(r[6]), headroom: N(r[7]), period_end: D(r[8]) })).filter(k => k.covenant_id != null && k.customer_id != null);
    const compliance = R.compliance.map(r => ({ check_id: N(r[0]), customer_id: N(r[1]), type: T(r[2]), status: T(r[3]), raised_date: D(r[4]),
      due_date: D(r[5]), completed_date: D(r[6]), outcome: T(r[7]), blocks: T(r[8]) === "Yes" })).filter(k => k.check_id != null);
    const rwaHist = {};
    R.rwaHist.forEach(r => { const cid = N(r[0]), d = serialToDate(N(r[1])); if (cid == null || !d) return; const i = mi[ym(d)]; if (i == null) return;
      (rwaHist[cid] ||= months.map(() => null))[i] = N(r[2]); });
    this.idx = {
      customers, contacts: group(contacts, "customer_id"), holdings: group(holdings, "customer_id"), opps: group(opps, "customer_id"),
      cases: group(cases, "customer_id"), meetings: group(meetings, "customer_id"),
      touches: group(inter.filter(x => x.meeting_id == null), "customer_id"),
      months, series, utilHist, revenue12m, lastMeetingEver, lastContact,
      financials: group(financials, "customer_id"), grades: group(grades, "customer_id"), covenants: group(covenants, "customer_id"),
      compliance: group(compliance, "customer_id"), rwaHist, capital: this.capital
    };
    // follow whichever RM the app is filtered to (it may have been changed in Qlik Sense)
    const rmIds = [...new Set(customers.map(c => c.rm_id))];
    const rmId = rmIds.length === 1 ? rmIds[0] : (this.rm?.id ?? rmIds[0]);
    this.buildBook(rmId);
    if (rmIds.length > 1) this.book = customers.map(c => this.profile(c));   // several RMs selected elsewhere: show them all
  }
  defaultRm() { return this.rms[0]?.id; }
}

/* =============================================================================
   Charts (plain SVG, fed from cube rows)
   ============================================================================= */
function niceTicks(min, max, n = 4) {
  if (min === max) max = min + 1;
  const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => span / x <= n) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(6));
  return t;
}
function lineChart(el, { labels, series, height = 200, area = false, fmt = gbp }) {
  const W = Math.max(280, el.clientWidth || 600), H = height, m = { t: 12, r: 16, b: 26, l: 52 };
  const all = series.flatMap(s => s.values.filter(v => v != null));
  if (!all.length) { el.innerHTML = `<p class="empty">No account activity in this period.</p>`; return; }
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = i => m.l + (labels.length === 1 ? 0 : i * (W - m.l - m.r) / (labels.length - 1));
  const y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0 || 1));
  let g = ticks.map(t => `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
  const every = Math.ceil(labels.length / Math.max(2, Math.floor((W - m.l) / 70)));
  const lastShown = Math.floor((labels.length - 1) / every) * every;
  g += labels.map((l, i) => i % every === 0 || (i === labels.length - 1 && i - lastShown >= every * 0.6) ? `<text class="axis-text" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}">${esc(l)}</text>` : "").join("");
  for (const s of series) {
    const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    if (!pts.length) continue;
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    if (area) g += `<path d="${path}L${pts[pts.length - 1][0]},${y(Math.max(0, y0))}L${pts[0][0]},${y(Math.max(0, y0))}Z" fill="${s.color}" fill-opacity="0.12" stroke="none"/>`;
    g += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const e = pts[pts.length - 1];
    g += `<circle cx="${e[0]}" cy="${e[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(" and "))} by month">${g}<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>${series.map(s => `<circle class="hov" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`).join("")}<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="tooltip" hidden></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tooltip"), cross = svg.querySelector(".cross"), hov = [...svg.querySelectorAll(".hov")];
  svg.addEventListener("pointermove", ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round((px - m.l) / ((W - m.l - m.r) / Math.max(1, labels.length - 1)))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    series.forEach((s, k) => { const v = s.values[i]; if (v == null) hov[k].setAttribute("visibility", "hidden"); else { hov[k].setAttribute("cx", x(i)); hov[k].setAttribute("cy", y(v)); hov[k].setAttribute("visibility", "visible"); } });
    tip.innerHTML = `<div class="t">${esc(labels[i])}</div>` + series.map(s => `<div class="row"><span class="sw" style="background:${s.color}"></span>${esc(s.name)} <b class="num">${fmt(s.values[i])}</b></div>`).join("");
    tip.hidden = false;
    const left = x(i) * r.width / W;
    tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, left + 12 - (left > r.width * 0.6 ? tip.offsetWidth + 24 : 0))) + "px";
    tip.style.top = "4px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); hov.forEach(h => h.setAttribute("visibility", "hidden")); });
}
function scatterChart(el, rows, onPick) {
  const W = Math.max(280, el.clientWidth || 600), H = 260, m = { t: 14, r: 16, b: 34, l: 46 };
  const pts = rows.filter(p => p.active && p.income > 0);
  if (!pts.length) { el.innerHTML = `<p class="empty">No customers match the current selections.</p>`; return; }
  const lx0 = Math.log10(Math.max(1000, Math.min(...pts.map(p => p.income)))), lx1 = Math.log10(Math.max(...pts.map(p => p.income)) * 1.1);
  const ratio = p => p.daysSince == null ? 3 : Math.min(3, p.daysSince / p.interval);
  const x = v => m.l + (Math.log10(Math.max(1000, v)) - lx0) / (lx1 - lx0 || 1) * (W - m.l - m.r);
  const y = r => m.t + (H - m.t - m.b) * (1 - r / 3);
  let g = [0, 1, 2, 3].map(t => `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t === 3 ? "3×+" : t + "×"}</text>`).join("");
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(1)}" y2="${y(1)}" stroke="var(--critical)" stroke-width="1" stroke-dasharray="5 4"/><text class="label-text" x="${W - m.r}" y="${y(1) - 6}" text-anchor="end">Meeting policy interval</text>`;
  const xt = [1e4, 3e4, 1e5, 3e5, 1e6, 3e6].filter(v => Math.log10(v) >= lx0 && Math.log10(v) <= lx1);
  g += xt.map(v => `<text class="axis-text" x="${x(v)}" y="${H - 16}" text-anchor="middle">${gbp(v)}</text>`).join("");
  g += `<text class="axis-text" x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">Annual income from products held (log scale)</text>`;
  g += `<text class="axis-text" transform="translate(11 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">Time since last meeting ÷ policy</text>`;
  g += pts.map(p => `<circle data-id="${p.id}" cx="${x(p.income).toFixed(1)}" cy="${y(ratio(p)).toFixed(1)}" r="5" fill="${covColor(p.coverage)}" fill-opacity="0.85" stroke="var(--surface)" stroke-width="1.5" style="cursor:pointer"/>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Customers by value and time since last meeting">${g}</svg><div class="tooltip" hidden></div>`;
  const tip = el.querySelector(".tooltip"), svg = el.querySelector("svg");
  svg.addEventListener("pointerover", ev => {
    const c = ev.target.closest("circle[data-id]"); if (!c) return;
    const p = pts.find(q => q.id === +c.dataset.id), r = svg.getBoundingClientRect();
    tip.innerHTML = `<div><b>${esc(p.name)}</b></div><div class="t">${esc(p.segment)} · ${gbp(p.income)} a year</div><div class="t">Last met ${p.daysSince == null ? "never" : p.daysSince + " days ago"} · policy ${p.interval} days</div>`;
    tip.hidden = false;
    const cx = +c.getAttribute("cx") * r.width / W, cy = +c.getAttribute("cy") * r.height / H;
    tip.style.left = Math.min(r.width - tip.offsetWidth, cx + 10) + "px"; tip.style.top = Math.max(0, cy - tip.offsetHeight - 8) + "px";
  });
  svg.addEventListener("pointerout", ev => { if (ev.target.closest("circle[data-id]")) tip.hidden = true; });
  svg.addEventListener("click", ev => { const c = ev.target.closest("circle[data-id]"); if (c) onPick(+c.dataset.id); });
}
function utilBar(h) {
  if (h.utilisation_pct == null) return "";
  const u = h.utilisation_pct, c = u >= 85 ? "var(--critical)" : u <= 10 ? "var(--qlik-casper)" : "var(--qlik-ocean)";
  const hist = provider.idx.utilHist[h.holding_id] || [];
  let spark = "";
  if (hist.length > 1) {
    const W = 56, H = 16;
    const d = hist.map((v, i) => `${i ? "L" : "M"}${(i * W / (hist.length - 1)).toFixed(1)},${(H - (v || 0) / 100 * H).toFixed(1)}`).join("");
    spark = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="Utilisation over 12 months" style="flex:none"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
  }
  return `<div class="util" title="${u.toFixed(0)}% of limit drawn"><div class="util-track"><div class="util-fill" style="width:${Math.min(100, u)}%;--c:${c}"></div><div class="util-tick"></div></div><span class="num small">${u.toFixed(0)}%</span>${spark}</div>`;
}

/* =============================================================================
   App state, routing and views
   ============================================================================= */
const urlMode = new URLSearchParams(location.search).get("mode");
const mode = urlMode === "mock" || urlMode === "qlik" ? urlMode : MODE;
const provider = mode === "mock" ? new MockProvider() : new QlikProvider();
const state = { view: "week", briefId: null, from: "week", sel: { segment: new Set(), coverage: new Set(), signal: new Set() }, search: "", sort: { key: "score", dir: -1 }, ready: false };

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3600); }
function go(view, id) {
  if (view === "brief") { state.from = state.view === "brief" ? state.from : state.view; state.briefId = id; location.hash = "c-" + id; }
  else location.hash = view;
}
function route() {
  const h = location.hash.replace("#", "");
  if (/^c-\d+$/.test(h)) { state.view = "brief"; state.briefId = +h.slice(2); }
  else state.view = h === "book" ? "book" : "week";
  render();
}
function render() {
  if (!state.ready) return;
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-current", t.dataset.nav === state.view || (state.view === "brief" && t.dataset.nav === state.from) ? "page" : "false"));
  const app = $("#app");
  if (state.view === "book") app.innerHTML = viewBook();
  else if (state.view === "brief") app.innerHTML = viewBrief(provider.brief(state.briefId));
  else app.innerHTML = viewWeek();
  app.insertAdjacentHTML("beforeend", aboutPanel());
  drawCharts();
}

/* ---------- My week ---------- */
function meetingRow({ m, p }) {
  const flags = p.signals.filter(s => SIGNALS[s].sev !== "admin").slice(0, 3).map(chip).join("");
  return `<div class="mtg">
    <div class="mtg-time">${fmtTime(m.startD)}<span>${m.duration_mins || 60} min</span></div>
    <div class="mtg-main">
      <div><button class="linkish" data-brief="${p.id}">${esc(p.name)}</button><span class="type-tag">${esc(m.draft ? "Draft · " + m.meeting_type : m.meeting_type)}</span>${p.active ? "" : `<span class="type-tag">Prospect</span>`}</div>
      <div class="mtg-line">${esc(m.channel)} · ${esc(m.location)}${m.contactName ? ` · with ${esc(m.contactName)}, ${esc(m.contactTitle)}` : ""}${m.specialistName ? ` · ${esc(m.specialistName)} (${esc(m.specialism)})` : ""}${m.reschedule_count ? ` · moved ${m.reschedule_count}×` : ""}</div>
      ${m.agenda ? `<div class="mtg-line muted">${esc(m.agenda)}</div>` : ""}
      ${flags ? `<div class="chips">${flags}</div>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><button class="btn small" data-brief="${p.id}">Open brief</button>${p.active ? `<button class="btn small" data-pdf="${p.id}">PDF</button>` : ""}</div>
  </div>`;
}
function viewWeek() {
  const book = provider.bookRows(), act = book.filter(p => p.active);
  const diary = provider.diaryRows(0, 13);
  const sameDay = d => days(AS_OF, new Date(d.getFullYear(), d.getMonth(), d.getDate())) === 0;
  const today = diary.filter(r => sameDay(r.m.startD));
  const next7 = provider.diaryRows(0, 6);
  const overdueUnbooked = act.filter(p => p.coverage === "Overdue - not booked");
  const renewals = sum(act.map(p => p.renewalsAtRisk.length));
  const complaints = act.filter(p => p.openComplaints.length).length;
  const covered = act.filter(p => !p.coverage.startsWith("Overdue")).length;
  const byDay = {};
  diary.forEach(r => { const k = r.m.startD.toDateString(); (byDay[k] ||= []).push(r); });
  const attention = act.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  const rank = p => p.blockers.length ? 0 : p.openChecks.some(k => k.status === "Overdue") ? 1 : p.openChecks.length ? 2 : 3;
  const admin = act.filter(p => p.openChecks.length || p.signals.includes("admin")).sort((a, b) => rank(a) - rank(b) || (a.kyc || 0) - (b.kyc || 0)).slice(0, 8);
  const adminLine = p => [
    ...p.openChecks.map(k => `<span class="chip ${k.blocks ? "critical" : k.status === "Overdue" ? "serious" : "warning"}"><i></i>${esc(k.type)}: ${esc(k.status.toLowerCase())}</span>`),
    p.arDue && p.arDue <= AS_OF ? `<span class="chip"><i></i>Annual review overdue since ${fmtShort(p.arDue)}</span>` : "",
    !p.checks.length && p.kyc && days(AS_OF, p.kyc) <= 60 ? `<span class="chip"><i></i>KYC due ${fmtShort(p.kyc)}</span>` : ""].join("");
  const first = (provider.rm?.name || "").replace(/^(Mr|Mrs|Miss|Ms|Dr)\s+/, "").split(" ")[0];
  return `
  <div class="view-head"><div><div class="eyebrow">${WD[AS_OF.getDay()]} ${fmtDate(AS_OF)}</div><h1>Good morning, <em>${esc(first)}</em></h1><div class="contrail short" aria-hidden="true"></div></div>
    <div class="muted small">${act.length} customers · ${book.length - act.length} prospects · ${esc(provider.rm?.region || "")}</div></div>
  <div class="stats">
    <div class="stat"><span class="stat-value">${today.length}</span><span class="stat-label">Meetings today</span></div>
    <div class="stat"><span class="stat-value">${next7.length}</span><span class="stat-label">Meetings in the next 7 days</span></div>
    <button class="stat" data-filter="coverage" data-value="Overdue - not booked"><span class="stat-value">${overdueUnbooked.length}</span><span class="stat-label">Overdue, nothing booked</span><span class="stat-note">Open in My book</span></button>
    <button class="stat" data-filter="signal" data-value="renewal"><span class="stat-value">${renewals}</span><span class="stat-label">Renewals not raised (120 days)</span><span class="stat-note">Open in My book</span></button>
    <button class="stat" data-filter="signal" data-value="complaint"><span class="stat-value">${complaints}</span><span class="stat-label">Customers with open complaints</span><span class="stat-note">Open in My book</span></button>
    <div class="stat"><span class="stat-value">${pct(covered / Math.max(1, act.length))}</span><span class="stat-label">Book seen within policy</span></div>
  </div>
  <div class="grid">
    <section class="panel span-7"><div class="panel-head"><h2>Diary · next two weeks</h2><span class="muted small">${diary.length} meetings</span></div>
      <div class="panel-body flush">${Object.keys(byDay).length ? Object.values(byDay).map(rows => {
        const d = rows[0].m.startD, isToday = sameDay(d);
        return `<div class="day"><div class="day-head ${isToday ? "today" : ""}"><span>${isToday ? "Today · " : ""}${WD[d.getDay()]} ${fmtShort(d)}</span><span>${rows.length} meeting${rows.length > 1 ? "s" : ""}</span></div>${rows.map(meetingRow).join("")}</div>`;
      }).join("") : `<p class="empty" style="padding:16px">No meetings booked in the next two weeks.</p>`}</div></section>
    <div class="span-5" style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <section class="panel"><div class="panel-head"><h2>Needs your attention</h2><span class="muted small">Ranked by risk, coverage and value</span></div>
        <div class="panel-body flush">${attention.map(p => `<div class="att">
          <div style="min-width:0"><button class="linkish" data-brief="${p.id}">${esc(p.name)}</button>
            <div class="att-meta">${esc(p.segment)} · ${gbp(p.income)} a year · <span class="pill" style="--c:${covColor(p.coverage)}">${esc(p.coverage)}</span></div>
            <div class="att-meta">Last met ${p.lastMeeting ? fmtDate(p.lastMeeting) : "never"}${p.next ? ` · next ${fmtShort(p.next.startD)}` : ""}</div>
            <div class="chips" style="margin-top:4px">${p.signals.filter(s => SIGNALS[s].sev !== "admin").slice(0, 4).map(chip).join("")}</div></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="score" title="Priority score">${p.score}</span>
            ${p.next ? "" : `<button class="btn small" data-propose="${p.id}">Propose meeting</button>`}</div>
        </div>`).join("") || `<p class="empty" style="padding:16px">Nothing needs attention.</p>`}</div></section>
      <section class="panel"><div class="panel-head"><h2>Compliance and reviews</h2><span class="muted small">Holds first, then overdue and due items</span></div>
        <div class="panel-body">${admin.length ? admin.map(p => `<div class="comp-row"><div><button class="linkish" data-brief="${p.id}">${esc(p.name)}</button>${p.holds.length ? ` <span class="muted small">· ${p.holds.length} deal${p.holds.length > 1 ? "s" : ""} on hold</span>` : ""}</div><div class="chips">${adminLine(p)}</div></div>`).join("") : `<p class="empty">Nothing due.</p>`}</div></section>
    </div>
  </div>`;
}

/* ---------- My book ---------- */
function bookFiltered(ignore) {
  const s = state.sel, q = state.search.trim().toLowerCase();
  return provider.bookRows().filter(p =>
    (ignore === "segment" || !s.segment.size || s.segment.has(p.segment)) &&
    (ignore === "coverage" || !s.coverage.size || s.coverage.has(p.coverage || "Prospect")) &&
    (ignore === "signal" || !s.signal.size || [...s.signal].every(x => p.signals.includes(x))) &&
    (!q || p.name.toLowerCase().includes(q)));
}
// KPI strip for My book; follows the current selections and search
function bookKpis(rows) {
  const act = rows.filter(p => p.active);
  const overdue = act.filter(p => (p.coverage || "").startsWith("Overdue"));
  const unbooked = act.filter(p => p.coverage === "Overdue - not booked").length;
  const within = act.filter(p => p.coverage && !p.coverage.startsWith("Overdue")).length;
  const rwa = sum(act.map(p => p.rwa || 0)), below = act.filter(p => p.signals.includes("lowRoRWA")).length;
  return `<div class="stats">
    <div class="stat"><span class="stat-value">${act.length}</span><span class="stat-label">Active customers</span>${rows.length > act.length ? `<span class="stat-note muted">plus ${rows.length - act.length} prospects</span>` : ""}</div>
    <div class="stat"><span class="stat-value">${gbp(sum(act.map(p => p.income || 0)))}</span><span class="stat-label">Annual income, products held</span></div>
    <div class="stat"><span class="stat-value">${gbp(sum(act.map(p => p.revenue12 || 0)))}</span><span class="stat-label">Revenue, last 12 months</span></div>
    <button class="stat" data-toggle="coverage" data-value="Overdue - not booked"><span class="stat-value">${overdue.length}</span><span class="stat-label">Overdue a meeting</span><span class="stat-note">${unbooked} with nothing booked</span></button>
    <div class="stat"><span class="stat-value">${pct(within / Math.max(1, act.length))}</span><span class="stat-label">Book seen within policy</span></div>
    <div class="stat"><span class="stat-value">${gbp(rwa)}</span><span class="stat-label">Risk weighted assets</span><span class="stat-note muted">${gbp(rwa * (provider.idx.capital?.ratio ?? 13) / 100)} of capital</span></div>
    <button class="stat" data-toggle="signal" data-value="lowRoRWA"><span class="stat-value">${pct1(rwa > 0 ? sum(act.map(p => p.income || 0)) / rwa : null)}</span><span class="stat-label">Return on RWA</span><span class="stat-note">${below} below the ${pct1((provider.idx.capital?.hurdle ?? 5) / 100)} hurdle</span></button>
  </div>`;
}
function viewBook() {
  const rows = bookFiltered().slice();
  const k = state.sort.key, dir = state.sort.dir;
  const val = p => k === "name" ? p.name : k === "income" ? p.income : k === "last" ? (p.daysSince ?? 99999) : k === "next" ? (p.next ? p.next.startD.getTime() : Infinity) : k === "coverage" ? (COVERAGE.findIndex(c => c.key === p.coverage) + 1 || 9) : p.score;
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const segRows = bookFiltered("segment"), covRows = bookFiltered("coverage"), sigRows = bookFiltered("signal");
  const segs = ["Corporate", "Commercial", "SME", "Private Banking"];
  const sigCodes = ["covBreach", "compHold", "complaint", "moved", "renewal", "competitor", "watchlist", "downgrade", "covTight", "compAction", "lowRoRWA",
                    "inflowsDown", "utilHigh", "cancels", "noMeeting", "fxGap", "idleCash", "growth", "newContact"];
  const tog = (field, v, label, n) => `<button class="toggle" data-toggle="${field}" data-value="${esc(v)}" aria-pressed="${state.sel[field].has(v)}">${esc(label)}<span class="n">${n}</span></button>`;
  const covCounts = COVERAGE.map(c => ({ ...c, n: covRows.filter(p => p.coverage === c.key).length }));
  const totalCov = sum(covCounts.map(c => c.n)) || 1;
  const sels = Object.entries(state.sel).filter(([, v]) => v.size);
  const head = (key, label, cls = "") => `<th class="${cls}"><button data-sort="${key}">${label}${state.sort.key === key ? (dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  const vis = p => p.signals.filter(s => SIGNALS[s].sev !== "admin");
  return `
  <div class="view-head"><div><div class="eyebrow">${esc(provider.rm?.name || "")}</div><h1>My book</h1><div class="contrail short" aria-hidden="true"></div></div>
    <input id="book-search" class="search" type="search" placeholder="Search customers" value="${esc(state.search)}" aria-label="Search customers"></div>
  <div class="selbar" aria-label="Current selections"><span class="label">Selections</span>
    ${sels.length ? sels.map(([f, v]) => `<span class="sel"><b>${f === "signal" ? "Signal" : f === "segment" ? "Segment" : "Coverage"}:</b> ${esc([...v].map(x => f === "signal" ? SIGNALS[x].label : x).join(", "))}<button data-clear="${f}" aria-label="Clear ${f}">×</button></span>`).join("") + `<button class="btn small" data-clear="all">Clear all</button>` : `<span class="muted small">None. Click a coverage band, segment or signal to filter.</span>`}
  </div>
  ${bookKpis(bookFiltered())}
  <div class="grid" style="margin-bottom:16px">
    <section class="panel span-5"><div class="panel-head"><h2>Meeting coverage</h2><span class="muted small">Active customers against the contact policy</span></div>
      <div class="panel-body"><div class="covbar">${covCounts.filter(c => c.n).map(c => `<button data-toggle="coverage" data-value="${esc(c.key)}" aria-pressed="${state.sel.coverage.has(c.key)}" class="${state.sel.coverage.size && !state.sel.coverage.has(c.key) ? "dim" : ""}" style="--c:${c.c};flex:${c.n}" title="${esc(c.key)}: ${c.n}" aria-label="${esc(c.key)}: ${c.n} customers"></button>`).join("")}</div>
        <div class="cov-legend">${covCounts.map(c => `<button data-toggle="coverage" data-value="${esc(c.key)}"><span class="pill" style="--c:${c.c}">${esc(c.key)}</span> <span class="num muted small">${c.n} · ${pct(c.n / totalCov)}</span></button>`).join("")}</div>
        <p class="muted small" style="margin:12px 0 0">Policy: Corporate and Private Banking quarterly, Commercial every 4 months, SME every 6 months.</p></div></section>
    <section class="panel span-7"><div class="panel-head"><h2>Value against attention</h2><span class="muted small">Above the dashed line = overdue. Click a customer to open the brief.</span></div>
      <div class="panel-body"><div class="chart" id="chart-scatter"></div></div></section>
  </div>
  <div class="filters">
    <div class="filter-group"><span class="eyebrow">Segment</span><div class="chips">${segs.map(s => tog("segment", s, s, segRows.filter(p => p.segment === s).length)).join("")}</div></div>
    <div class="filter-group" style="min-width:0"><span class="eyebrow">Signals</span><div class="chips">${sigCodes.map(s => tog("signal", s, SIGNALS[s].label, sigRows.filter(p => p.signals.includes(s)).length)).join("")}</div></div>
  </div>
  <section class="panel"><div class="panel-head"><h2>${rows.length} customer${rows.length === 1 ? "" : "s"}</h2><span class="muted small">Sorted by ${{ score: "priority", name: "name", income: "income", last: "last meeting", next: "next meeting", coverage: "coverage" }[k]}</span></div>
    <div class="panel-body flush"><div class="table-wrap book-scroll"><table>
      <thead><tr>${head("name", "Customer")}${head("income", "Income a year", "r")}${head("last", "Last met")}${head("next", "Next meeting")}${head("coverage", "Coverage")}<th>Signals</th>${head("score", "Priority", "r")}</tr></thead>
      <tbody>${rows.map(p => `<tr class="clickable" data-brief="${p.id}">
        <td><b>${esc(p.name)}</b><div class="muted small">${esc(p.segment)}${p.c.industry && p.segment !== "Private Banking" ? " · " + esc(p.c.industry) : ""} · ${esc(p.c.city)}</div></td>
        <td class="r num">${p.active ? gbp(p.income) : "—"}</td>
        <td class="small">${p.lastMeeting ? fmtDate(p.lastMeeting) + `<div class="muted">${p.daysSince} days</div>` : `<span class="muted">${p.active ? "None on record" : "Prospect"}</span>`}</td>
        <td class="small">${p.next ? `${fmtShort(p.next.startD)} ${fmtTime(p.next.startD)}<div class="muted">${esc(p.next.meeting_type)}</div>` : `<span class="muted">Nothing booked</span>`}</td>
        <td>${p.coverage ? `<span class="pill" style="--c:${covColor(p.coverage)}">${esc(p.coverage)}</span>` : `<span class="muted small">Prospect</span>`}</td>
        <td><div class="chips">${vis(p).slice(0, 3).map(chip).join("")}${vis(p).length > 3 ? `<span class="chip">+${vis(p).length - 3}</span>` : ""}</div></td>
        <td class="r num">${p.score || ""}</td></tr>`).join("")}</tbody></table></div></div></section>`;
}

/* ---------- Customer brief ---------- */
function sinceLastMeeting(p) {
  if (!p.lastMeeting) return `<p class="empty">No completed meeting on record, so everything below is new to this relationship.</p>`;
  const L = p.lastMeeting, Lm = ym(L);
  const out = [];
  if (p.ser) {
    const i = p.months.indexOf(Lm);
    const at = i >= 0 ? p.ser.balance[i] : p.ser.balance.find(v => v != null);
    if (at != null && p.balance != null) {
      const ch = p.balance - at;
      out.push(`<div class="delta"><span>Current account balance</span><span class="v ${ch >= 0 ? "up" : "down"}">${gbp(ch, { sign: true })}</span><span class="sub">${gbp(at)} at the end of ${fmtMonth(Lm)}, ${gbp(p.balance)} now</span></div>`);
    }
    const moved = sum(p.ser.moved.slice(Math.max(0, i)));
    if (moved > 0) out.push(`<div class="delta"><span>Moved to another bank</span><span class="v down">${gbp(moved)}</span><span class="sub">Transfers to an account in the customer's name elsewhere</span></div>`);
    if (p.inflowChange3 != null) out.push(`<div class="delta"><span>Inflows, last 3 months</span><span class="v ${p.inflowChange3 >= 0 ? "up" : "down"}">${pct(p.inflowChange3, true)}</span><span class="sub">Against the previous 3 months</span></div>`);
  }
  p.revolving.forEach(h => {
    const hist = provider.idx.utilHist[h.holding_id] || [];
    if (!hist.length) return;
    const back = Math.min(hist.length - 1, Math.max(0, Math.round(days(L, AS_OF) / 30.4)));
    const then = hist[hist.length - 1 - back];
    if (then != null) { const d = h.utilisation_pct - then; if (Math.abs(d) >= 5) out.push(`<div class="delta"><span>${esc(h.product)} utilisation</span><span class="v ${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)} pts</span><span class="sub">${then.toFixed(0)}% then, ${h.utilisation_pct.toFixed(0)}% now</span></div>`); }
  });
  const newCases = p.cases.filter(k => parseD(k.opened_date) > L);
  if (newCases.length) out.push(`<div class="delta"><span>Service cases opened</span><span class="v">${newCases.length}</span><span class="sub">${esc(newCases.map(k => k.category).join(", "))}</span></div>`);
  const newOpps = p.opps.filter(o => parseD(o.created_date) > L);
  if (newOpps.length) out.push(`<div class="delta"><span>New opportunities</span><span class="v">${newOpps.length}</span><span class="sub">${esc(newOpps.map(o => o.product).join(", "))}</span></div>`);
  const calls = p.touches.filter(t => parseD(t.interaction_date) > L).length;
  out.push(`<div class="delta"><span>Calls and emails since</span><span class="v">${calls}</span></div>`);
  const nc = p.contacts.filter(x => parseD(x.known_since) > L);
  if (nc.length) out.push(`<div class="delta"><span>New contacts</span><span class="v">${nc.length}</span><span class="sub">${esc(nc.map(x => `${x.contact_name} (${x.job_title})`).join(", "))}</span></div>`);
  return out.join("");
}
// business health: ratios by period, grade history and covenants
function healthPanel(p) {
  const f = p.financials, cols = f.map(x => x.statement_type === "Management accounts" ? `Latest<div class="muted small">${fmtMonth(x.period_end.slice(0, 7))} mgmt</div>` : `FY ${x.period_end.slice(0, 4)}`);
  const x1 = v => v == null ? "n/m" : `${v.toFixed(1)}x`;
  const rows = [["Turnover", x => gbp(x.turnover)], ["EBITDA", x => gbp(x.ebitda)], ["EBITDA margin", x => x.margin == null ? "—" : `${x.margin.toFixed(1)}%`],
    ["Net debt", x => gbp(x.net_debt)], ["Leverage (net debt / EBITDA)", x => x1(x.leverage)], ["Interest cover", x => x1(x.interest_cover)],
    ["Current ratio", x => x.current_ratio == null ? "—" : x.current_ratio.toFixed(2)], ["Debtor days", x => x.debtor_days ?? "—"]];
  const g = p.grades.slice(-3).reverse();
  const covLim = k => k.type.startsWith("Loan to value") ? `${k.threshold.toFixed(0)}%` : `${k.threshold}x`;
  const covAct = k => k.actual == null ? "n/m" : k.type.startsWith("Loan to value") ? `${k.actual.toFixed(0)}%` : `${k.actual.toFixed(2)}x`;
  const resChip = r => `<span class="chip ${r === "Breach" ? "critical" : r === "Tight" ? "warning" : r === "Breach - waived" ? "serious" : "good"}"><i></i>${esc(r)}</span>`;
  return `<section class="panel span-7"><div class="panel-head"><h2>Business health</h2><span class="muted small">Grade ${esc(p.gradeLabel || "—")}${p.extRating ? ` · external rating ${esc(p.extRating)}` : ""}</span></div>
    <div class="panel-body flush"><div class="table-wrap"><table class="ratios"><thead><tr><th></th>${cols.map(c => `<th class="r">${c}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><td>${label}</td>${f.map(x => `<td class="r num">${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${p.covenants.length ? `<div class="sub-head">Covenants</div><div class="table-wrap"><table><thead><tr><th>Facility</th><th>Covenant</th><th class="r">Limit</th><th class="r">Latest</th><th class="r">Headroom</th><th>Result</th></tr></thead>
      <tbody>${p.covenants.map(k => `<tr><td>${esc(k.product)}</td><td class="small">${esc(k.type)}</td><td class="r num">${k.op === "Max" ? "≤" : "≥"} ${covLim(k)}</td><td class="r num">${covAct(k)}</td><td class="r num">${k.headroom == null ? "—" : k.headroom.toFixed(0) + "%"}</td><td>${resChip(k.result)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${g.length ? `<div class="sub-head">Credit grade history</div><div class="panel-body" style="padding-top:0">${g.map(x => `<div class="delta"><span>${esc(x.reason)}</span><span class="v">${x.grade}${x.previous ? ` <span class="muted small">from ${x.previous}</span>` : ""}</span><span class="sub">${fmtDate(parseD(x.effective_date))}</span></div>`).join("")}</div>` : ""}
    </div></section>`;
}
// capital: RWA by holding and ways to improve return on RWA
function capitalPanel(p, span) {
  const lend = p.holdings.filter(h => h.rwa_gbp > 0).sort((a, b) => b.rwa_gbp - a.rwa_gbp);
  const meter = Math.min(1, p.rorwa / (p.hurdle * 2)), mark = 0.5;
  return `<section class="panel ${span}"><div class="panel-head"><h2>Capital and return</h2><span class="muted small">Simplified UK CRR standardised approach</span></div>
    <div class="panel-body">
      <div class="rorwa"><div class="rorwa-top"><span class="stat-value" style="font-size:24px;color:${p.rorwa < p.hurdle ? "var(--critical)" : "var(--qlik-deep-blue)"}">${pct1(p.rorwa)}</span><span class="muted small">return on RWA · hurdle ${pct1(p.hurdle)}</span></div>
        <div class="rorwa-track"><div class="rorwa-fill" style="width:${(meter * 100).toFixed(0)}%;--c:${p.rorwa < p.hurdle ? "var(--critical)" : "var(--good)"}"></div><div class="rorwa-mark" style="left:${mark * 100}%"></div></div>
        <div class="muted small">${gbp(p.income)} income a year · ${gbp(p.ead)} exposure · ${gbp(p.rwa)} RWA · ${gbp(p.capital)} capital</div></div>
      <table class="compact"><thead><tr><th>Holding</th><th>Exposure class</th><th class="r">Risk weight</th><th class="r">RWA</th><th class="r">Return</th></tr></thead>
        <tbody>${lend.map(h => `<tr><td>${esc(h.product)}${h.ltv_pct != null ? `<div class="muted small">LTV ${h.ltv_pct.toFixed(0)}%</div>` : ""}</td><td class="small">${esc(h.exposure_class || "")}</td><td class="r num">${h.risk_weight_pct != null ? h.risk_weight_pct.toFixed(0) + "%" : "—"}${h.sme_factor && h.sme_factor < 1 ? `<div class="muted small">× ${h.sme_factor.toFixed(2)} SME</div>` : ""}</td><td class="r num">${gbp(h.rwa_gbp)}</td><td class="r num" style="color:${h.annual_income_gbp / h.rwa_gbp < p.hurdle ? "var(--critical)" : "inherit"}">${pct1(h.annual_income_gbp / h.rwa_gbp)}</td></tr>`).join("")}</tbody></table>
      ${p.ideas.length ? `<div class="sub-head" style="padding-left:0">Ways to improve the return</div>${p.ideas.slice(0, 4).map(i => `<div class="idea"><b>${esc(i.title)}</b><div class="muted small">${esc(i.detail)}</div>
        <div class="small">${i.pipeline ? "Pipeline deal" : `${i.save > 0 ? `Saves ${gbp(i.save)} RWA · ` : ""}${i.income ? `${i.income > 0 ? "+" : "−"}${gbp(Math.abs(i.income))} income · ` : ""}return on RWA ${pct1(p.rorwa)} → <b>${pct1(i.after)}</b>`}</div></div>`).join("")}` : ""}
    </div></section>`;
}
function complianceList(p) {
  const tone = k => k.blocks ? "critical" : k.status === "Overdue" ? "serious" : k.status === "Clear" ? "good" : "warning";
  const recent = p.checks.filter(k => k.status === "Clear").slice(0, 3);
  const list = [...p.openChecks, ...recent];
  if (!list.length) return `<p class="empty">No compliance checks on record.</p>`;
  return list.map(k => `<div class="delta"><span><b>${esc(k.type)}</b></span><span><span class="chip ${tone(k)}"><i></i>${esc(k.status)}</span></span>
    <span class="sub">${esc(k.outcome || "")}${k.status === "Clear" && k.completed_date ? ` · completed ${fmtDate(parseD(k.completed_date))}` : k.due_date ? ` · due ${fmtDate(parseD(k.due_date))}` : ""}${k.blocks ? " · new business on hold" : ""}</span></div>`).join("");
}
function briefText(p) {
  const lines = [`${p.name} - meeting brief (${fmtDate(AS_OF)})`, `${p.segment} · ${p.c.city} · RM ${provider.rm?.name || ""}`];
  if (p.next) lines.push(`Next meeting: ${fmtDate(p.next.startD)} ${fmtTime(p.next.startD)}, ${p.next.meeting_type}, ${p.next.channel}`);
  lines.push(`Last met: ${p.lastMeeting ? fmtDate(p.lastMeeting) : "never"} · policy ${p.freqLabel.toLowerCase()}`, "", "Talking points:");
  p.points.forEach(t => lines.push(`- [${SEV_LABEL[t.sev]}] ${t.title}. ${t.act}`));
  lines.push("", "Products:");
  p.holdings.forEach(h => lines.push(`- ${h.product}: ${gbp(h.amount_gbp)}${h.utilisation_pct != null ? `, ${h.utilisation_pct.toFixed(0)}% drawn` : ""}${h.maturity_date ? `, matures ${fmtDate(parseD(h.maturity_date))}` : ""}`));
  return lines.join("\n");
}
function viewBrief(p) {
  if (!p) return `<div class="back"><button class="btn small" data-nav="${state.from}">← Back</button></div><p class="empty">This customer is not in ${esc(provider.rm?.name || "this")}'s book.</p>`;
  const c = p.c, n = p.next;
  const size = c.annual_turnover_gbp ? `Turnover ${gbp(c.annual_turnover_gbp)}` : c.net_worth_gbp ? `Net worth ${gbp(c.net_worth_gbp)}` : "";
  const deposits = sum(p.holdings.filter(h => h.category === "Deposits" || h.category === "Transaction Banking").map(h => h.amount_gbp));
  const lendLimit = sum(p.lending.map(h => h.amount_gbp)), lendDrawn = sum(p.lending.map(h => h.drawn_amount_gbp));
  const wealth = sum(p.holdings.filter(h => h.category === "Wealth").map(h => h.amount_gbp));
  const hist = [...p.meetings.filter(m => m.status !== "Scheduled").map(m => ({ d: m.startD, kind: "m", m })),
                ...p.touches.map(t => ({ d: parseD(t.interaction_date), kind: "t", t }))].sort((a, b) => b.d - a.d).slice(0, 10);
  const lastNotes = p.meetings.find(m => m.status === "Completed" && m.notes);
  return `
  <div class="back"><button class="btn small" data-nav="${state.from}">← ${state.from === "book" ? "My book" : "My week"}</button></div>
  <div class="brief-head">
    <div class="who">
      <div class="eyebrow green">Meeting brief · prepared ${fmtDate(AS_OF)}</div>
      <h1>${esc(p.name)}</h1><div class="contrail short" aria-hidden="true"></div>
      <div class="who-meta"><span>${esc(p.segment)}${p.segment !== "Private Banking" && c.industry ? " · " + esc(c.industry) : ""}</span><span>${esc(c.city)}</span>${size ? `<span>${size}</span>` : ""}${c.onboarded_date ? `<span>Client since ${parseD(c.onboarded_date).getFullYear()}</span>` : `<span>Prospect</span>`}<span>Risk rating: ${esc(c.risk_rating)}</span></div>
      <div class="who-meta">${p.coverage ? `<span class="pill" style="--c:${covColor(p.coverage)}">${esc(p.coverage)}</span>` : ""}${p.freqLabel ? `<span>Policy: ${esc(p.freqLabel.toLowerCase())}</span>` : ""}<span>Last met ${p.lastMeeting ? `${fmtDate(p.lastMeeting)} (${p.daysSince} days)` : "never"}</span><span>Last contact ${ago(p.daysSinceContact)}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><button class="btn primary" data-pdf="${p.id}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v8.5m0 0L4.5 6.5M8 10l3.5-3.5M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Download PDF brief</button><button class="btn" data-copy="${p.id}">Copy as text</button><button class="btn" disabled title="Phase 2: write-back to the bank's CRM">Log meeting notes</button></div>
    </div>
    ${n ? `<section class="panel next-card"><div class="eyebrow">${n.draft ? "Proposed meeting (draft)" : "Next meeting"}</div>
      <div style="font:600 18px/1.2 var(--font-head)">${WD[n.startD.getDay()]} ${fmtDate(n.startD)} · ${fmtTime(n.startD)}</div>
      <dl class="kv"><dt>Type</dt><dd>${esc(n.meeting_type)} · ${n.duration_mins || 60} min</dd><dt>Where</dt><dd>${esc(n.channel)} · ${esc(n.location)}</dd>
      ${n.contactName ? `<dt>With</dt><dd>${esc(n.contactName)}, ${esc(n.contactTitle)}</dd>` : ""}${n.specialistName ? `<dt>Specialist</dt><dd>${esc(n.specialistName)} (${esc(n.specialism)})</dd>` : ""}
      ${n.reschedule_count ? `<dt>Moved</dt><dd>${n.reschedule_count}× (originally ${fmtShort(n.origD)})</dd>` : ""}
      <dt>Agenda</dt><dd>${esc(n.agenda)}</dd></dl></section>`
    : p.active ? `<section class="panel next-card none"><div class="eyebrow">Next meeting</div><div style="font:600 17px/1.25 var(--font-head)">Nothing booked</div>
      <p class="muted small" style="margin:0">${p.daysSince == null ? "No meeting on record." : p.daysSince > p.interval ? `Overdue by ${p.daysSince - p.interval} days against the ${p.interval}-day policy.` : `Due within ${p.interval - p.daysSince} days.`}</p>
      <div><button class="btn primary small" data-propose="${p.id}">Propose meeting</button></div></section>` : `<section class="panel next-card"><div class="eyebrow">Prospect</div><p class="muted small" style="margin:0">Not yet a customer; no meeting booked.</p></section>`}
  </div>

  <div class="tiles">
    <div class="stat"><span class="stat-value">${gbp(p.income)}</span><span class="stat-label">Annual income, products held</span></div>
    <div class="stat"><span class="stat-value">${gbp(p.revenue12)}</span><span class="stat-label">Revenue, last 12 months</span></div>
    <div class="stat"><span class="stat-value">${p.holdings.length}</span><span class="stat-label">Products held</span></div>
    <div class="stat"><span class="stat-value">${gbp(deposits)}</span><span class="stat-label">Deposits and current accounts</span></div>
    <div class="stat"><span class="stat-value">${lendLimit ? gbp(lendDrawn) : "—"}</span><span class="stat-label">Lending drawn${lendLimit ? ` of ${gbp(lendLimit)}` : ""}</span></div>
    ${wealth ? `<div class="stat"><span class="stat-value">${gbp(wealth)}</span><span class="stat-label">Wealth assets</span></div>` : ""}
    ${p.rwa > 0 ? `<div class="stat"><span class="stat-value">${gbp(p.rwa)}</span><span class="stat-label">Risk weighted assets</span></div>
    <div class="stat"><span class="stat-value" style="color:${p.rorwa < p.hurdle ? "var(--critical)" : "var(--qlik-deep-blue)"}">${pct1(p.rorwa)}</span><span class="stat-label">Return on RWA (hurdle ${pct1(p.hurdle)})</span></div>` : ""}
    ${p.grade ? `<div class="stat"><span class="stat-value">${p.grade}</span><span class="stat-label">Credit grade · ${esc(GRADE_BAND[p.grade])}${p.extRating ? ` · rated ${esc(p.extRating)}` : ""}</span></div>` : ""}
  </div>

  <div class="grid">
    <section class="panel span-8"><div class="panel-head"><h2>Talking points</h2><span class="muted small">${p.points.length} from today's data, most urgent first</span></div>
      <div class="panel-body">${p.points.length ? p.points.map(t => `<div class="tp"><div class="tp-bar" style="--c:${SEV_COLOR[t.sev]}"></div><div><div class="tp-title"><span class="tp-sev">${SEV_LABEL[t.sev]}</span>${esc(t.title)}</div><div class="tp-ev">${esc(t.ev)}</div><div class="tp-act">${esc(t.act)}</div></div></div>`).join("") : `<p class="empty">Nothing flagged. A good meeting to ask about plans and introduce new products.</p>`}</div></section>
    <section class="panel span-4"><div class="panel-head"><h2>Since the last meeting</h2><span class="muted small">${p.lastMeeting ? fmtDate(p.lastMeeting) : ""}</span></div>
      <div class="panel-body">${sinceLastMeeting(p)}</div></section>

    <section class="panel span-6"><div class="panel-head"><h2>Current account balance</h2><span class="muted small">Month-end, 24 months</span></div>
      <div class="panel-body"><div class="chart" id="chart-balance"></div></div></section>
    <section class="panel span-6"><div class="panel-head"><h2>Inflows and spending</h2><span class="muted small">12 months; spending excludes loan repayments and transfers</span></div>
      <div class="panel-body"><div class="legend"><span><i style="background:var(--series-1)"></i>Inflows</span><span><i style="background:var(--series-2)"></i>Operating spend</span></div><div class="chart" id="chart-flows"></div></div></section>

    <section class="panel span-12"><div class="panel-head"><h2>Products held</h2><span class="muted small">Utilisation tick marks 85% of the limit</span></div>
      <div class="panel-body flush"><div class="table-wrap"><table><thead><tr><th>Product</th><th class="r">Balance / limit</th><th>Utilisation</th><th>Opened</th><th>Matures</th><th class="r">Income a year</th><th>Renewal</th></tr></thead>
      <tbody>${p.holdings.map(h => { const mat = parseD(h.maturity_date), dl = mat ? days(AS_OF, mat) : null;
        const ren = !mat ? "" : h.has_open_renewal ? `<span class="chip good"><i></i>In progress</span>` : dl <= 120 ? `<span class="chip serious"><i></i>Not raised</span>` : dl <= 270 ? `<span class="chip"><i></i>Due in ${Math.round(dl / 30)} months</span>` : "";
        return `<tr><td><b>${esc(h.product)}</b><div class="muted small">${esc(h.category)}${h.origin && h.origin !== "Existing book" ? " · " + esc(h.origin) : ""}</div></td><td class="r num">${gbp(h.amount_gbp)}${h.drawn_amount_gbp != null && h.utilisation_pct == null && h.category === "Lending" ? `<div class="muted small">${gbp(h.drawn_amount_gbp)} outstanding</div>` : ""}</td><td>${utilBar(h)}</td><td class="small">${fmtDate(parseD(h.open_date))}</td><td class="small">${mat ? fmtDate(mat) : "—"}</td><td class="r num">${gbp(h.annual_income_gbp)}</td><td>${ren}</td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">No products held.</td></tr>`}</tbody></table></div></div></section>

    ${p.financials.length ? healthPanel(p) : ""}
    ${p.rwa > 0 ? capitalPanel(p, p.financials.length ? "span-5" : "span-12") : ""}

    <section class="panel span-7"><div class="panel-head"><h2>Meetings and contact history</h2><span class="muted small">Latest 10</span></div>
      <div class="panel-body">${hist.map(x => x.kind === "m" ? `<div class="timeline-item"><div class="timeline-date">${fmtDate(x.d)}</div><div class="timeline-body"><b>${esc(x.m.meeting_type)}</b> <span class="muted small">${esc(x.m.channel)}</span>${x.m.status !== "Completed" ? ` <span class="chip warning"><i></i>${esc(x.m.status)}${x.m.cancelled_by ? " by " + esc(x.m.cancelled_by.toLowerCase()) : ""}</span>` : ""}${x.m.sentiment ? ` <span class="sent">· ${esc(x.m.sentiment)}</span>` : ""}
        ${x.m.notes ? `<p>${esc(x.m.notes)}</p>` : x.m.cancellation_reason ? `<p>${esc(x.m.cancellation_reason)}</p>` : ""}${x.m.next_action ? `<p class="small">Next action: ${esc(x.m.next_action)}</p>` : ""}</div></div>`
        : `<div class="timeline-item"><div class="timeline-date">${fmtDate(x.d)}</div><div class="timeline-body">${esc(x.t.interaction_type)}: ${esc(x.t.subject)} <span class="sent">· ${esc(x.t.sentiment)}</span></div></div>`).join("") || `<p class="empty">No contact on record.</p>`}</div></section>
    <div class="span-5" style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <section class="panel"><div class="panel-head"><h2>People</h2><span class="muted small">${p.contacts.length} contact${p.contacts.length === 1 ? "" : "s"}</span></div>
        <div class="panel-body">${p.contacts.map(x => `<div class="person"><div><b>${esc(x.contact_name)}</b> <span class="muted">${esc(x.job_title)}</span></div><div class="chips">${x.is_primary ? `<span class="chip"><i></i>Primary</span>` : ""}${x.is_decision_maker ? `<span class="chip"><i></i>Decision maker</span>` : ""}<span class="chip ${x.relationship_strength === "Weak" ? "warning" : x.relationship_strength === "New" ? "opportunity" : x.relationship_strength === "Strong" ? "good" : ""}"><i></i>${esc(x.relationship_strength)}</span></div><div class="contact"><span>${esc(x.email)}</span><span>${esc(x.phone)}</span></div></div>`).join("") || `<p class="empty">No contacts on record.</p>`}</div></section>
      <section class="panel"><div class="panel-head"><h2>Open opportunities</h2></div>
        <div class="panel-body">${p.opps.length ? `<table><tbody>${p.opps.map(o => `<tr><td><b>${esc(o.product)}</b>${o.compliance_hold ? ` <span class="chip critical"><i></i>On hold: compliance</span>` : ""}<div class="muted small">${esc(o.opportunity_type)} · ${esc(o.stage)} · ${days(parseD(o.stage_entered_date), AS_OF)} days in stage${o.expected_rwa_gbp > 0 ? ` · ${gbp(o.expected_rwa_gbp)} RWA if won` : ""}</div></td><td class="r num">${gbp(o.expected_annual_income_gbp)}<div class="muted small">${o.probability_pct ?? "—"}%</div></td></tr>`).join("")}</tbody></table>` : `<p class="empty">No open opportunities.</p>`}</div></section>
      <section class="panel"><div class="panel-head"><h2>Service cases</h2><span class="muted small">Open, and last 12 months</span></div>
        <div class="panel-body">${p.cases.length ? `<table><tbody>${p.cases.map(k => `<tr><td><b>${esc(k.category)}</b><div class="muted small">${esc(k.description)}</div></td><td class="small">${k.status === "Open" ? `<span class="chip ${k.is_complaint ? "critical" : "warning"}"><i></i>Open</span>` : "Closed"}<div class="muted">${fmtShort(parseD(k.opened_date))}</div></td></tr>`).join("")}</tbody></table>` : `<p class="empty">No cases in the last 12 months.</p>`}</div></section>
      <section class="panel"><div class="panel-head"><h2>Compliance</h2><span class="muted small">${p.complianceStatus ? esc(p.complianceStatus) : ""}${p.cdd ? ` · ${esc(p.cdd)} due diligence` : ""}${p.pep ? " · PEP" : ""}</span></div>
        <div class="panel-body">${complianceList(p)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Admin</h2></div>
        <div class="panel-body"><dl class="kv"><dt>Annual review</dt><dd>${c.last_annual_review_date ? `Last ${fmtDate(parseD(c.last_annual_review_date))}` : "None on record"}${p.arDue ? ` · next ${fmtDate(p.arDue)}${p.arDue <= AS_OF ? " (overdue)" : ""}` : ""}</dd>
          <dt>KYC refresh</dt><dd>${p.kyc ? fmtDate(p.kyc) : "—"}</dd>${p.inPerson != null ? `<dt>In-person policy</dt><dd>${p.inPerson} a year</dd>` : ""}${lastNotes ? `<dt>Last notes</dt><dd>${fmtDate(lastNotes.startD)}</dd>` : ""}</dl></div></section>
    </div>
  </div>`;
}

/* ---------- About ---------- */
function aboutPanel() {
  return `<details class="about"><summary>Data objects this page reads from the Qlik app</summary>
    <p class="muted small" style="max-width:70ch">Each dataset is a hypercube created with <span class="num">createSessionObject()</span> and read in pages of up to 10,000 cells. Choosing a relationship manager selects <span class="num">rm_id</span> in the app; the cubes then return that RM's book. Signals, talking points and coverage are worked out in the page from the cube rows.</p>
    <div class="about-grid">${Object.entries(QCUBES).map(([id, c]) => `<div><h3>${id}</h3><pre>${esc(JSON.stringify(toHyperCubeDef(id, c), null, 2))}</pre></div>`).join("")}</div>
  </details>
  <p class="foot">Client IQ Demonstrator · synthetic data. Source: <span class="mode-tag">${esc(provider.label)}</span> · data as of ${fmtDate(AS_OF)}${provider.generated ? ` · ${esc(provider.generated)}` : ""}. Proposed meetings stay in this page only.</p>`;
}
function drawCharts() {
  const sc = $("#chart-scatter");
  if (sc) scatterChart(sc, bookFiltered(), id => go("brief", id));
  const p = state.view === "brief" ? provider.brief(state.briefId) : null;
  if (p && p.ser) {
    const lab = p.months.map(fmtMonth);
    const bal = $("#chart-balance"); if (bal) lineChart(bal, { labels: lab.slice(0, -1), series: [{ name: "Balance", values: p.ser.balance.slice(0, -1), color: "var(--series-1)" }], area: true });
    const fl = $("#chart-flows"); if (fl) lineChart(fl, { labels: lab.slice(-13, -1), series: [{ name: "Inflows", values: p.ser.credits.slice(-13, -1), color: "var(--series-1)" }, { name: "Operating spend", values: p.ser.spend.slice(-13, -1), color: "var(--series-2)" }] });
  } else if (p) {
    ["#chart-balance", "#chart-flows"].forEach(s => { const el = $(s); if (el) el.innerHTML = `<p class="empty">No current account held.</p>`; });
  }
}

/* ---------- events ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("[data-brief],[data-nav],[data-toggle],[data-clear],[data-sort],[data-filter],[data-propose],[data-copy],[data-pdf]");
  if (!t || t.disabled) return;
  if (t.dataset.pdf) {
    ev.stopPropagation();
    const p = provider.brief(+t.dataset.pdf);
    if (!p) return;
    const label = t.innerHTML; t.disabled = true; t.textContent = "Preparing…";
    try {
      const { downloadBriefPdf } = await import("./brief-pdf.js");
      await downloadBriefPdf(p, { AS_OF, rmName: provider.rm?.name || "", sourceLabel: provider.label, fmtDate, fmtShort, fmtTime, gbp, pct, ago, parseD, days, sum,
        utilHist: provider.idx.utilHist, SEV_LABEL, WD });
      toast(`Brief for ${p.name} downloaded.`);
    } catch (e) { console.error(e); toast("Could not create the PDF. See the browser console for details."); }
    finally { t.disabled = false; t.innerHTML = label; }
    return;
  }
  if (t.dataset.propose) {
    ev.stopPropagation();
    const p = provider.brief(+t.dataset.propose), m = provider.proposeMeeting(p);
    toast(`Draft meeting with ${p.name} on ${fmtShort(m.startD)} at ${fmtTime(m.startD)}. It is not sent to the diary in this demonstrator.`);
    render(); return;
  }
  if (t.dataset.copy) {
    const text = briefText(provider.brief(+t.dataset.copy));
    try { await navigator.clipboard.writeText(text); toast("Brief copied as text."); }
    catch (e) { toast("Copy was blocked by the browser."); }
    return;
  }
  if (t.dataset.brief) return go("brief", +t.dataset.brief);
  if (t.dataset.nav) return go(t.dataset.nav);
  if (t.dataset.filter) {
    Object.values(state.sel).forEach(s => s.clear()); state.search = "";
    state.sel[t.dataset.filter].add(t.dataset.value); state.sort = { key: "score", dir: -1 };
    return location.hash === "#book" ? render() : go("book");
  }
  if (t.dataset.toggle) { const s = state.sel[t.dataset.toggle], v = t.dataset.value; s.has(v) ? s.delete(v) : s.add(v); return render(); }
  if (t.dataset.clear) { if (t.dataset.clear === "all") Object.values(state.sel).forEach(s => s.clear()); else state.sel[t.dataset.clear].clear(); return render(); }
  if (t.dataset.sort) { const k = t.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "name" || k === "next" || k === "coverage" ? 1 : -1) }; return render(); }
});
document.addEventListener("input", ev => {
  if (ev.target.id !== "book-search") return;
  state.search = ev.target.value;
  const pos = ev.target.selectionStart;
  render();
  const s = $("#book-search"); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
});
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawCharts, 150); });
window.addEventListener("hashchange", route);

/* ---------- session lifecycle ---------- */
const steps = (list, i) => { $("#ov-steps").innerHTML = list.map((s, k) => `<li class="${k < i ? "done" : k === i ? "active" : ""}">${esc(s)}</li>`).join(""); };
function setStatus(busy, text) { $("#session-status").innerHTML = `<span class="dot ${busy ? "busy" : ""}"></span><span>${esc(text)}</span>`; }
function showError(where, e) {
  console.error(e);
  const msg = (e && (e.message || e.code || String(e))) || "Unknown error";
  $("#ov-title").textContent = `Could not ${where}`;
  const hints = mode === "qlik" ? `<p>Check that:</p><ul>
    <li>the app ID in <span class="num">config.js</span> is set (currently <span class="num">${esc(QLIK.appId)}</span>);</li>
    ${QLIK.authType === "anonymous"
      ? `<li>the host, client ID, access code and app ID for the anonymous tenant are filled in in <span class="num">config.js</span>;</li>
         <li>the Anonymous embed OAuth client lists <span class="num">${esc(location.origin)}</span> as an allowed origin;</li>
         <li>the app is published to a managed space with <b>Anyone with the link</b> switched on;</li>
         <li>anonymous sessions end after 15 minutes: reload the page to start a new one;</li>`
      : `<li>the OAuth client lists <span class="num">${esc(QLIK.redirectUri)}</span> as a redirect URL and <span class="num">${esc(location.origin)}</span> as an allowed origin;</li>`}
    <li>you can open the app in Qlik Sense with the same account;</li>
    <li>the app has been reloaded with the v4 load script.</li></ul>
    <p><a href="?mode=mock">Open with sample data instead</a></p>` : "";
  const box = $("#ov-error"); box.hidden = false;
  box.innerHTML = `<pre>${esc(msg)}</pre>${hints}`;
  $("#overlay").hidden = false;
  setStatus(true, "Not connected");
}

// RM picker: one group per team (Region - Team), in team order, when the data has teams
function rmOptions(rms) {
  const opt = r => `<option value="${r.id}">${esc(r.name)}</option>`;
  if (!rms.some(r => r.team)) return rms.map(opt).join("");
  const groups = new Map();
  for (const r of rms) {
    const key = `${r.region} - ${r.team}`;
    if (!groups.has(key)) groups.set(key, { order: Number.isFinite(r.teamOrder) ? r.teamOrder : 1e9, label: key, rms: [] });
    groups.get(key).rms.push(r);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(g => `<optgroup label="${esc(g.label)}">${g.rms.map(opt).join("")}</optgroup>`).join("");
}

async function selectRm(rmId) {
  state.ready = false;
  setStatus(true, "Reading book…");
  $("#ov-title").textContent = "Loading the book"; $("#ov-error").hidden = true; $("#overlay").hidden = false;
  try { await provider.openRm(rmId, steps); }
  catch (e) { return showError("load this book", e); }
  $("#overlay").hidden = true;
  store("rb-rm", String(rmId));
  Object.values(state.sel).forEach(s => s.clear()); state.search = "";
  state.ready = true;
  setStatus(false, `${provider.label} · ${provider.book.filter(p => p.active).length} customers · data as of ${fmtDate(AS_OF)}`);
  route();
}
(async function init() {
  $("#ov-title").textContent = mode === "qlik" ? "Connecting to Qlik Cloud" : "Loading sample data";
  $("#overlay").hidden = false;
  setStatus(true, mode === "qlik" ? "Connecting to Qlik Cloud…" : "Loading sample data…");
  try { await provider.connect(steps); }
  catch (e) { return showError(mode === "qlik" ? "connect to Qlik Cloud" : "load the sample data", e); }
  const sel = $("#rm-pick");
  sel.innerHTML = rmOptions(provider.rms);
  const saved = +store("rb-rm");
  const start = provider.rms.some(r => r.id === saved) ? saved : provider.defaultRm();
  sel.value = start;
  sel.addEventListener("change", () => { if (location.hash.startsWith("#c-")) location.hash = "week"; selectRm(+sel.value); });
  // selections changed in Qlik Sense: re-render, and follow the RM if it changed
  provider.onChange(() => {
    if (!state.ready) return;
    if (provider.rm) sel.value = provider.rm.id;
    setStatus(false, `${provider.label} · synced with app selections · ${provider.book.filter(p => p.active).length} customers`);
    render();
  });
  await selectRm(start);
})();
