/* ============================================================
   JardinDevis — application de devis pour jardiniers
   Données stockées localement sur l'appareil (localStorage).
   Aucune donnée n'est envoyée sur Internet.
   ============================================================ */
"use strict";

/* ---------- Constantes ---------- */
const LS_KEY = "jardindevis.v1";

const CATEGORIES = [
  "Tonte de pelouse",
  "Taille de haies",
  "Débroussaillage",
  "Désherbage",
  "Nettoyage de jardin",
  "Ramassage de feuilles",
  "Évacuation des déchets verts",
  "Plantation d'arbustes",
  "Entretien régulier de jardin",
  "Autres prestations personnalisées"
];

const UNITS = ["heure", "m²", "mètre linéaire", "forfait", "unité"];

const REGIMES = {
  franchise:   { label: "Franchise en base de TVA", rate: 0 },
  reduit10:    { label: "TVA réduite",              rate: 10 },
  normal20:    { label: "TVA normale",              rate: 20 },
  personnalise:{ label: "Taux personnalisé",        rate: null }
};

const STATUSES = {
  brouillon: { label: "Brouillon", cls: "st-brouillon" },
  envoye:    { label: "Envoyé",    cls: "st-envoye" },
  accepte:   { label: "Accepté",   cls: "st-accepte" },
  refuse:    { label: "Refusé",    cls: "st-refuse" },
  termine:   { label: "Terminé",   cls: "st-termine" }
};

const CONDITIONS_DEFAUT = "Paiement à 30 jours après acceptation du devis, par virement bancaire ou chèque.";

const DEFAULT_PROFILE = {
  entreprise: "", nom: "", adresse: "", tel: "", email: "",
  siret: "", facturation: "", regime: "franchise", mentions: "", logo: ""
};

/* ---------- État ---------- */
let db = { profile: { ...DEFAULT_PROFILE }, devis: [], seq: 0, seqYear: new Date().getFullYear() };
let editingId = null;      // devis en cours de modification dans le formulaire (null = nouveau)
let editingStatus = "brouillon";
let previewId = null;      // devis affiché dans l'aperçu
let currentView = "dashboard";
let navStack = [];

/* ---------- Utilitaires ---------- */
const $ = (id) => document.getElementById(id);

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const euro = (v) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(r2(v || 0));

const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString("fr-FR");
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const addDaysISO = (iso, days) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

let toastTimer = null;
function showToast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ---------- Sauvegarde locale ---------- */
function loadDB() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;
    db.profile = { ...DEFAULT_PROFILE, ...(data.profile || {}) };
    db.devis = Array.isArray(data.devis) ? data.devis : [];
    db.seq = Number(data.seq) || 0;
    db.seqYear = Number(data.seqYear) || new Date().getFullYear();
  } catch (e) {
    console.warn("Impossible de lire les données locales :", e);
    showToast("Attention : les données locales n'ont pas pu être lues.", true);
  }
}

function saveDB() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    showToast("Erreur : impossible d'enregistrer sur cet appareil (stockage plein ?).", true);
    return false;
  }
}

function nextNumber() {
  const year = new Date().getFullYear();
  if (db.seqYear !== year) { db.seqYear = year; db.seq = 0; }
  db.seq += 1;
  return "DEV-" + year + "-" + String(db.seq).padStart(3, "0");
}

/* ---------- Navigation ---------- */
function showView(name) {
  if (name !== "abonnement" && !aboActive()) name = "abonnement";
  if (name !== currentView) navStack.push(currentView);
  currentView = name;
  ["dashboard", "devis-form", "preview", "history", "profile", "abonnement"].forEach((v) => {
    $("view-" + v).hidden = (v !== name);
  });
  $("btn-back").hidden = (name === "dashboard" || name === "abonnement" || navStack.length === 0);
  if (name === "abonnement") updateAboUI();
  window.scrollTo({ top: 0 });
}

function goBack() {
  let prev = navStack.pop() || "dashboard";
  if (prev !== "abonnement" && !aboActive()) prev = "abonnement";
  currentView = prev;
  ["dashboard", "devis-form", "preview", "history", "profile", "abonnement"].forEach((v) => {
    $("view-" + v).hidden = (v !== prev);
  });
  $("btn-back").hidden = (prev === "dashboard" || prev === "abonnement" || navStack.length === 0);
  if (prev === "history") renderHistory();
  if (prev === "dashboard") renderDashboard();
  if (prev === "abonnement") updateAboUI();
  updateBackLabel();
  window.scrollTo({ top: 0 });
}

function updateBackLabel() {
  $("btn-back").textContent = (navStack[navStack.length - 1] === "history") ? "← Mes devis" : "← Accueil";
}

/* ---------- Calculs ---------- */
function rateFor(regime, customRate) {
  if (regime === "franchise") return 0;
  if (regime === "reduit10") return 10;
  if (regime === "normal20") return 20;
  const r = parseFloat(customRate);
  return isNaN(r) ? 0 : r;
}

function calcDevis(d) {
  const lines = (d.items || []).map((it) => {
    const qty = parseFloat(it.qty);
    const price = parseFloat(it.price);
    return {
      ...it,
      qtyNum: isNaN(qty) ? 0 : qty,
      priceNum: isNaN(price) ? 0 : price,
      total: r2((isNaN(qty) ? 0 : qty) * (isNaN(price) ? 0 : price))
    };
  });

  const totalPrestations = r2(lines.reduce((s, l) => s + l.total, 0));
  const move = r2(parseFloat(d.moveCost) || 0);
  const material = r2(parseFloat(d.materialCost) || 0);
  const evac = r2(parseFloat(d.evacCost) || 0);
  const extras = r2(move + material + evac);

  const remise = r2(Math.max(0, Math.min(parseFloat(d.discount) || 0, totalPrestations + extras)));
  const totalHT = r2(Math.max(0, totalPrestations + extras - remise));

  const rate = rateFor(d.regime, d.tvaRate);
  const tva = rate > 0 ? r2(totalHT * rate / 100) : 0;
  const totalTTC = r2(totalHT + tva);

  return { lines, totalPrestations, move, material, evac, extras, remise, totalHT, rate, tva, totalTTC };
}

/* ---------- Formulaire devis : lignes de prestation ---------- */
function itemRowHTML(item = {}) {
  const cat = CATEGORIES.includes(item.category) ? item.category : CATEGORIES[0];
  const opts = CATEGORIES.map((c) =>
    '<option value="' + esc(c) + '"' + (c === cat ? " selected" : "") + ">" + esc(c) + "</option>"
  ).join("");
  return (
    '<div class="item-row">' +
      '<div class="item-grid">' +
        '<label>Catégorie<select class="i-cat">' + opts + "</select></label>" +
        '<label>Description<textarea class="i-desc" rows="2" placeholder="Ex. tonte avec bordure le long de l\'allée">' + esc(item.description || "") + "</textarea></label>" +
        '<label>Quantité<input type="number" class="i-qty" min="0" step="any" inputmode="decimal" value="' + esc(item.qty != null ? item.qty : "") + '"></label>' +
        '<label>Unité<input class="i-unit" list="unit-list" placeholder="heure, m², forfait…" value="' + esc(item.unit || "") + '"></label>' +
        '<label>Prix unitaire HT (€)<input type="number" class="i-price" min="0" step="any" inputmode="decimal" value="' + esc(item.price != null ? item.price : "") + '"></label>' +
      "</div>" +
      '<div class="item-foot">' +
        '<span class="i-total">Total : 0,00 €</span>' +
        '<button type="button" class="btn btn-danger btn-small i-del">Supprimer</button>' +
      "</div>" +
    "</div>"
  );
}

function addEmptyItem() {
  $("items-container").insertAdjacentHTML("beforeend", itemRowHTML());
  updateLiveTotal();
}

function refreshItemTotals() {
  document.querySelectorAll("#items-container .item-row").forEach((row) => {
    const qty = parseFloat(row.querySelector(".i-qty").value);
    const price = parseFloat(row.querySelector(".i-price").value);
    const t = (isNaN(qty) ? 0 : qty) * (isNaN(price) ? 0 : price);
    row.querySelector(".i-total").textContent = "Total : " + euro(t);
  });
}

/* ---------- Formulaire devis : lecture / écriture ---------- */
function collectForm() {
  const items = Array.from(document.querySelectorAll("#items-container .item-row")).map((row) => ({
    category: row.querySelector(".i-cat").value,
    description: row.querySelector(".i-desc").value.trim(),
    qty: row.querySelector(".i-qty").value,
    unit: row.querySelector(".i-unit").value.trim(),
    price: row.querySelector(".i-price").value
  }));
  return {
    client: {
      nom: $("cli-nom").value.trim(),
      adresse: $("cli-adresse").value.trim(),
      tel: $("cli-tel").value.trim(),
      email: $("cli-email").value.trim()
    },
    items,
    moveCost: $("dei-move").value,
    materialCost: $("dei-material").value,
    evacCost: $("dei-evac").value,
    discount: $("dei-remise").value,
    regime: $("dei-regime").value,
    tvaRate: $("dei-rate").value,
    date: $("dei-date").value || todayISO(),
    validity: $("dei-validity").value,
    conditions: $("dei-conditions").value.trim(),
    notes: $("dei-notes").value.trim()
  };
}

function validateDevisData(data) {
  const errors = [];
  const mark = (id) => $(id).classList.add("field-error");

  if (!data.client.nom) { errors.push({ id: "cli-nom", msg: "Le nom du client est obligatoire." }); mark("cli-nom"); }

  const validItems = data.items.filter((it) =>
    (parseFloat(it.qty) || 0) > 0 && (parseFloat(it.price) || 0) >= 0
  );
  if (validItems.length === 0) {
    errors.push({ id: null, msg: "Ajoutez au moins une prestation avec une quantité et un prix." });
  }
  data.items.forEach((it, i) => {
    const row = document.querySelectorAll("#items-container .item-row")[i];
    if (row && (parseFloat(it.qty) || 0) < 0) row.querySelector(".i-qty").classList.add("field-error");
    if (row && (parseFloat(it.price) || 0) < 0) row.querySelector(".i-price").classList.add("field-error");
  });

  const remise = parseFloat(data.discount) || 0;
  const brut = data.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0), 0)
    + (parseFloat(data.moveCost) || 0) + (parseFloat(data.materialCost) || 0) + (parseFloat(data.evacCost) || 0);
  if (remise > brut) { errors.push({ id: "dei-remise", msg: "La remise dépasse le total du devis." }); mark("dei-remise"); }

  if (data.regime === "personnalise") {
    const r = parseFloat(data.tvaRate);
    if (isNaN(r) || r < 0 || r > 100) { errors.push({ id: "dei-rate", msg: "Saisissez un taux de TVA entre 0 et 100." }); mark("dei-rate"); }
  }
  return errors;
}

function clearErrors() {
  document.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
}

function saveDevis(andPreview) {
  clearErrors();
  const data = collectForm();
  const errors = validateDevisData(data);
  if (errors.length) {
    showToast(errors[0].msg, true);
    return false;
  }

  let d;
  if (editingId) {
    d = db.devis.find((x) => x.id === editingId);
    if (!d) { showToast("Devis introuvable.", true); return false; }
    Object.assign(d, data);
    d.updatedAt = Date.now();
  } else {
    d = { ...data, id: "d" + Date.now() + Math.random().toString(36).slice(2, 7) };
    d.number = nextNumber();
    d.status = "brouillon";
    d.createdAt = Date.now();
    d.updatedAt = Date.now();
    db.devis.push(d);
    editingId = d.id;
    editingStatus = d.status;
    $("form-title").textContent = "Devis " + d.number;
  }

  if (!saveDB()) return false;
  showToast("Devis " + d.number + " enregistré (" + STATUSES[d.status].label.toLowerCase() + ").");
  if (andPreview) renderPreview(d.id);
  return true;
}

function openNewDevis() {
  editingId = null;
  editingStatus = "brouillon";
  $("form-title").textContent = "Nouveau devis";
  $("devis-form").reset();
  clearErrors();
  $("cli-nom").value = "";
  $("cli-adresse").value = "";
  $("cli-tel").value = "";
  $("cli-email").value = "";
  $("dei-move").value = "";
  $("dei-material").value = "";
  $("dei-evac").value = "";
  $("dei-remise").value = "";
  $("dei-regime").value = db.profile.regime || "franchise";
  applyRegimeUI();
  $("dei-date").value = todayISO();
  $("dei-validity").value = "30";
  $("dei-conditions").value = db.profile.conditions || CONDITIONS_DEFAUT;
  $("dei-notes").value = "";
  $("items-container").innerHTML = "";
  addEmptyItem();
  showView("devis-form");
}

function openEditDevis(id) {
  const d = db.devis.find((x) => x.id === id);
  if (!d) { showToast("Devis introuvable.", true); return; }
  editingId = d.id;
  editingStatus = d.status;
  $("form-title").textContent = "Modifier le devis " + d.number;
  clearErrors();
  $("cli-nom").value = d.client.nom || "";
  $("cli-adresse").value = (d.client.adresse || "");
  $("cli-tel").value = d.client.tel || "";
  $("cli-email").value = d.client.email || "";
  $("items-container").innerHTML = "";
  (d.items && d.items.length ? d.items : [{}]).forEach((it) => {
    $("items-container").insertAdjacentHTML("beforeend", itemRowHTML(it));
  });
  $("dei-move").value = d.moveCost || "";
  $("dei-material").value = d.materialCost || "";
  $("dei-evac").value = d.evacCost || "";
  $("dei-remise").value = d.discount || "";
  $("dei-regime").value = d.regime || "franchise";
  applyRegimeUI();
  $("dei-rate").value = d.tvaRate || "";
  $("dei-date").value = d.date || todayISO();
  $("dei-validity").value = d.validity || "30";
  $("dei-conditions").value = d.conditions || CONDITIONS_DEFAUT;
  $("dei-notes").value = d.notes || "";
  refreshItemTotals();
  updateLiveTotal();
  showView("devis-form");
}

function duplicateDevis(id) {
  const d = db.devis.find((x) => x.id === id);
  if (!d) return;
  editingId = null;
  editingStatus = "brouillon";
  $("form-title").textContent = "Nouveau devis (à partir de " + d.number + ")";
  clearErrors();
  $("cli-nom").value = d.client.nom || "";
  $("cli-adresse").value = d.client.adresse || "";
  $("cli-tel").value = d.client.tel || "";
  $("cli-email").value = d.client.email || "";
  $("items-container").innerHTML = "";
  (d.items && d.items.length ? d.items : [{}]).forEach((it) => {
    $("items-container").insertAdjacentHTML("beforeend", itemRowHTML(it));
  });
  $("dei-move").value = d.moveCost || "";
  $("dei-material").value = d.materialCost || "";
  $("dei-evac").value = d.evacCost || "";
  $("dei-remise").value = d.discount || "";
  $("dei-regime").value = d.regime || "franchise";
  applyRegimeUI();
  $("dei-rate").value = d.tvaRate || "";
  $("dei-date").value = todayISO();
  $("dei-validity").value = d.validity || "30";
  $("dei-conditions").value = d.conditions || CONDITIONS_DEFAUT;
  $("dei-notes").value = d.notes || "";
  refreshItemTotals();
  updateLiveTotal();
  showView("devis-form");
  showToast("Modifiez puis enregistrez : un nouveau numéro sera créé.");
}

/* ---------- TVA / régime ---------- */
function applyRegimeUI() {
  const regime = $("dei-regime").value;
  const wrap = $("rate-wrap");
  const rateInput = $("dei-rate");
  if (regime === "personnalise") {
    wrap.hidden = false;
    rateInput.disabled = false;
  } else {
    wrap.hidden = true;
    rateInput.value = REGIMES[regime].rate;
    rateInput.disabled = true;
  }
}

/* ---------- Total en direct ---------- */
function updateLiveTotal() {
  const data = collectForm();
  const c = calcDevis(data);
  const regimeLabel = REGIMES[data.regime] ? REGIMES[data.regime].label : data.regime;
  let txt = "Sous-total prestations : " + euro(c.totalPrestations) + "\n";
  if (c.extras > 0) txt += "Frais (déplacement, matériel, évacuation) : " + euro(c.extras) + "\n";
  if (c.remise > 0) txt += "Remise : −" + euro(c.remise) + "\n";
  txt += "Total HT : " + euro(c.totalHT) + "\n";
  txt += c.rate > 0
    ? "TVA " + c.rate + " % (" + regimeLabel + ") : " + euro(c.tva) + "\n"
    : "TVA : non applicable — " + regimeLabel + "\n";
  txt += "TOTAL TTC : " + euro(c.totalTTC);
  $("form-total").textContent = txt;
}

/* ---------- Aperçu du document ---------- */
function findDevis(id) { return db.devis.find((x) => x.id === id); }

function renderPreview(id) {
  const d = findDevis(id);
  if (!d) { showToast("Devis introuvable.", true); return; }
  previewId = id;
  $("pv-status").value = d.status;
  $("devis-doc").innerHTML = buildDocHTML(d);
  ensureJsPDF().catch(() => {}); // précharge la bibliothèque PDF en silence
  showView("preview");
  updateBackLabel();
}

function buildDocHTML(d) {
  const p = db.profile;
  const c = calcDevis(d);

  const logoHTML = p.logo ? '<img class="logo" src="' + p.logo + '" alt="Logo de l\'entreprise">' : "";
  const siret = p.siret ? "SIRET : " + esc(p.siret) + "<br>" : "";
  const factu = p.facturation ? esc(p.facturation).replace(/\n/g, "<br>") + "<br>" : "";

  const clientLines = [
    esc(d.client.nom),
    d.client.adresse ? esc(d.client.adresse).replace(/\n/g, "<br>") : "",
    [d.client.tel, d.client.email].filter(Boolean).map(esc).join(" · ")
  ].filter(Boolean).join("<br>");

  const itemRows = c.lines.map((l) => {
    const desc = (l.category === "Autres prestations personnalisées" ? "" : "<strong>" + esc(l.category) + "</strong>" + (l.description ? " — " : ""));
    const descFull = desc + esc(l.description || "");
    return (
      "<tr>" +
        '<td>' + (descFull || "Prestation") + "</td>" +
        '<td class="num">' + esc(l.qty || "0") + "</td>" +
        "<td>" + esc(l.unit || "—") + "</td>" +
        '<td class="num">' + euro(l.priceNum) + "</td>" +
        '<td class="num">' + euro(l.total) + "</td>" +
      "</tr>"
    );
  }).join("");

  const extraRows = [];
  if (c.move > 0) extraRows.push(["Frais de déplacement", c.move]);
  if (c.material > 0) extraRows.push(["Frais de matériel", c.material]);
  if (c.evac > 0) extraRows.push(["Frais d'évacuation des déchets verts", c.evac]);
  const extrasHTML = extraRows.map(([label, val]) =>
    '<tr class="extra"><td colspan="4">' + label + '</td><td class="num">' + euro(val) + "</td></tr>"
  ).join("");
  const remiseHTML = c.remise > 0
    ? '<tr class="remise"><td colspan="4">Remise</td><td class="num">−' + euro(c.remise) + "</td></tr>"
    : "";

  const tvaHTML = c.rate > 0
    ? "<tr><td>TVA " + c.rate + " %</td><td class=\"num\">" + euro(c.tva) + "</td></tr>"
    : '<tr><td>TVA</td><td class="num">Non applicable</td></tr>';

  const validite = d.validity ? fmtDate(addDaysISO(d.date, d.validity)) : "";

  const mentions = [];
  if (c.rate === 0) mentions.push("TVA non applicable, art. 293 B du CGI (franchise en base de TVA).");
  if (p.mentions) mentions.push(esc(p.mentions).replace(/\n/g, "<br>"));

  return (
    '<div class="doc-head">' +
      '<div class="doc-company">' + logoHTML +
        "<strong>" + esc(p.entreprise || "Votre entreprise") + "</strong>" +
        (p.nom ? esc(p.nom) + "<br>" : "") +
        (p.adresse ? esc(p.adresse).replace(/\n/g, "<br>") + "<br>" : "") +
        (p.tel ? "Tél. : " + esc(p.tel) + "<br>" : "") +
        (p.email ? esc(p.email) + "<br>" : "") +
        siret +
      "</div>" +
      '<div class="doc-meta">' +
        '<div class="doc-title">DEVIS</div>' +
        '<div class="doc-num">N° ' + esc(d.number) + "</div>" +
        '<div>Date : ' + fmtDate(d.date) + "</div>" +
        (validite ? '<div>Valable jusqu\'au ' + validite + "</div>" : "") +
      "</div>" +
    "</div>" +

    '<div class="doc-client">' +
      '<div class="doc-label">Client</div>' +
      clientLines +
    "</div>" +

    '<table class="doc-table">' +
      "<thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead>" +
      "<tbody>" + itemRows + extrasHTML + remiseHTML + "</tbody>" +
    "</table>" +

    '<table class="doc-totals">' +
      '<tr><td>Total HT</td><td class="num">' + euro(c.totalHT) + "</td></tr>" +
      tvaHTML +
      '<tr class="grand"><td>TOTAL à payer</td><td class="num">' + euro(c.totalTTC) + "</td></tr>" +
    "</table>" +

    (d.conditions ? '<div class="doc-block"><strong>Conditions de paiement :</strong> ' + esc(d.conditions).replace(/\n/g, "<br>") + "</div>" : "") +
    (p.facturation ? '<div class="doc-block"><strong>Coordonnées bancaires :</strong> ' + esc(p.facturation).replace(/\n/g, "<br>") + "</div>" : "") +
    (d.notes ? '<div class="doc-block"><strong>Notes :</strong> ' + esc(d.notes).replace(/\n/g, "<br>") + "</div>" : "") +

    (mentions.length ? '<div class="doc-mentions">' + mentions.join("<br>") + "</div>" : "") +

    '<div class="doc-sign">' +
      '<div class="sig-box"><strong>Bon pour accord du client</strong>' +
        '<p class="sig-line">Date et signature du client :</p>' +
        '<p class="sig-line">« J\'accepte le devis ci-dessus et ses conditions. »</p>' +
      "</div>" +
    "</div>" +

    '<div class="doc-note-acceptation">Le présent devis doit être accepté (signature du client) avant le début des travaux.</div>'
  );
}

/* ---------- Impression / PDF / partage ---------- */
function printDevis(asPdf) {
  const d = previewId && findDevis(previewId);
  if (!d) { showToast("Ouvrez d'abord un devis.", true); return; }
  if (asPdf) {
    showToast('Dans la fenêtre d\'impression, choisissez « Enregistrer au format PDF » comme destination.');
    setTimeout(() => window.print(), 350);
  } else {
    window.print();
  }
}

async function shareDevis() {
  const d = previewId && findDevis(previewId);
  if (!d) return;
  const c = calcDevis(d);
  const text =
    "Devis n° " + d.number + " — " + (db.profile.entreprise || "JardinDevis") + "\n" +
    "Client : " + d.client.nom + "\n" +
    "Date : " + fmtDate(d.date) +
    (d.validity ? " — valable jusqu'au " + fmtDate(addDaysISO(d.date, d.validity)) : "") + "\n" +
    "Total " + (c.rate > 0 ? "TTC" : "à payer") + " : " + euro(c.totalTTC);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Devis " + d.number, text });
      return;
    } catch (e) { /* annulé ou non pris en charge : on continue */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Résumé du devis copié dans le presse-papiers.");
  } catch (e) {
    showToast("Le partage n'est pas disponible sur cet appareil. Utilisez « Télécharger PDF ».", true);
  }
}

/* ---------- Export PDF réel (jsPDF, chargé à la demande) ---------- */
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js";
let jsPDFPromise = null;

function ensureJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPDFPromise) {
    jsPDFPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSPDF_CDN;
      s.onload = () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jsPDF absent après chargement"));
      };
      s.onerror = () => reject(new Error("Chargement de jsPDF impossible"));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("Chargement de jsPDF trop long")), 12000);
    }).catch((e) => {
      jsPDFPromise = null; // permet une nouvelle tentative plus tard
      throw e;
    });
  }
  return jsPDFPromise;
}

// Les polices standard de jsPDF ne couvrent que le WinAnsi : on retire
// espaces fines, signe moins typographique et tout caractère hors Latin-1
// (emojis, etc.) pour éviter un PDF illisible ou une erreur.
const WINANSI_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178
]);

function pdfText(s) {
  return String(s == null ? "" : s)
    .replace(/\u2212/g, "-")
    .replace(/[\u202F\u00A0]/g, " ")
    .split("")
    .filter((ch) => ch.codePointAt(0) < 256 || WINANSI_EXTRA.has(ch.codePointAt(0)))
    .join("");
}

function pdfMoney(v) {
  return euro(v).replace(/[\u202F\u00A0]/g, " ");
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function prepareLogo() {
  const src = db.profile.logo;
  if (!src || !/^data:image\/(png|jpeg)/i.test(src)) return null;
  const img = await loadImage(src);
  if (!img || !img.naturalWidth) return null;
  const maxW = 40, maxH = 22;
  let w = maxW;
  let h = maxW * (img.naturalHeight / img.naturalWidth);
  if (h > maxH) {
    h = maxH;
    w = maxH * (img.naturalWidth / img.naturalHeight);
  }
  return { data: src, fmt: /^data:image\/png/i.test(src) ? "PNG" : "JPEG", w: w, h: h };
}

async function downloadPdf() {
  const d = previewId && findDevis(previewId);
  if (!d) { showToast("Ouvrez d'abord un devis.", true); return; }
  showToast("Préparation du PDF…");
  let JSPDF;
  try {
    JSPDF = await ensureJsPDF();
  } catch (e) {
    showToast("PDF indisponible sans connexion : utilisez « Imprimer » puis « Enregistrer au format PDF ».", true);
    return;
  }
  try {
    const logo = await prepareLogo();
    const doc = buildPdf(JSPDF, d, logo);
    const filename = "Devis-" + pdfText(d.number) + ".pdf";
    const blob = doc.output("blob");
    // Sur iPhone/Android : fiche de partage native (Fichiers, e-mail, WhatsApp…)
    if (blob && navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Devis " + d.number });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return; // annulé par l'utilisateur
          // sinon : téléchargement direct
        }
      }
    }
    doc.save(filename);
    showToast("PDF créé : " + filename);
  } catch (e) {
    console.error("Erreur PDF :", e);
    showToast("Impossible de créer le PDF. Utilisez « Imprimer » pour l'enregistrer en PDF.", true);
  }
}

function buildPdf(JSPDF, d, logo) {
  const p = db.profile;
  const c = calcDevis(d);
  const doc = new JSPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 14;
  const MR = 14;
  const CW = PW - ML - MR;
  const GREEN = [30, 86, 49];
  const GREY = [110, 124, 112];
  const INK = [43, 58, 48];
  const GREENBG = [232, 243, 236];
  const LINE = [220, 232, 224];
  const RED = [192, 57, 43];
  let y = 14;

  function font(style, size, col) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(col[0], col[1], col[2]);
  }

  function space(h) {
    if (y + h > PH - 18) {
      doc.addPage();
      y = 18;
    }
  }

  function para(title, body) {
    if (!body) return;
    font("normal", 8, INK);
    const lines = doc.splitTextToSize(pdfText(body), CW - 6);
    const h = (title ? 5 : 0) + lines.length * 4 + 4;
    space(h);
    doc.setFillColor(245, 248, 246);
    doc.roundedRect(ML, y, CW, h, 1.5, 1.5, "F");
    let ty = y + 4.5;
    if (title) {
      font("bold", 8.5, GREEN);
      doc.text(pdfText(title), ML + 3, ty);
      ty += 5;
      font("normal", 8, INK);
    }
    lines.forEach((t, i) => doc.text(t, ML + 3, ty + i * 4));
    y += h + 3;
  }

  /* ---- En-tête ---- */
  if (logo) {
    try {
      doc.addImage(logo.data, logo.fmt, ML, y, logo.w, logo.h);
      y += logo.h + 2;
    } catch (e) { /* logo illisible : on continue sans */ }
  }
  font("bold", 15, GREEN);
  doc.text(pdfText(p.entreprise || "Votre entreprise"), ML, y + 4);
  font("bold", 20, GREEN);
  doc.text("DEVIS", PW - MR, y + 4, { align: "right" });
  y += 8;

  font("normal", 8.5, GREY);
  const compLines = [];
  if (p.nom) compLines.push(pdfText(p.nom));
  (p.adresse ? p.adresse.split(/\r?\n/) : []).forEach((t) => compLines.push(pdfText(t)));
  if (p.tel) compLines.push("Tél. : " + pdfText(p.tel));
  if (p.email) compLines.push(pdfText(p.email));
  if (p.siret) compLines.push("SIRET : " + pdfText(p.siret));
  const metaLines = [
    "N° " + pdfText(d.number),
    "Date : " + fmtDate(d.date),
    d.validity ? "Valable jusqu'au " + fmtDate(addDaysISO(d.date, d.validity)) : null
  ].filter(Boolean);
  compLines.forEach((t, i) => doc.text(t, ML, y + i * 4));
  metaLines.forEach((t, i) => doc.text(t, PW - MR, y + i * 4, { align: "right" }));
  y += Math.max(compLines.length, metaLines.length, 1) * 4 + 3;
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.8);
  doc.line(ML, y, PW - MR, y);
  y += 6;

  /* ---- Client ---- */
  const clientRows = [];
  clientRows.push(pdfText(d.client.nom || "—"));
  (d.client.adresse ? d.client.adresse.split(/\r?\n/) : []).forEach((t) => clientRows.push(pdfText(t)));
  if (d.client.tel || d.client.email) {
    clientRows.push([d.client.tel, d.client.email].filter(Boolean).map(pdfText).join(" · "));
  }
  font("normal", 9, INK);
  const clientWrapped = [];
  clientRows.forEach((t) => {
    clientWrapped.push(...doc.splitTextToSize(t, CW - 8));
  });
  const boxH = 8 + clientWrapped.length * 4.5 + 3;
  space(boxH + 2);
  doc.setFillColor(GREENBG[0], GREENBG[1], GREENBG[2]);
  doc.roundedRect(ML, y, CW, boxH, 2, 2, "F");
  font("bold", 7, GREEN);
  doc.text("CLIENT", ML + 4, y + 5);
  font("normal", 9, INK);
  clientWrapped.forEach((t, i) => doc.text(t, ML + 4, y + 9 + i * 4.5));
  y += boxH + 5;

  /* ---- Prestations ---- */
  const colDesc = ML;
  const colDescW = 84;
  const colQtyR = 112;
  const colUnit = 116;
  const colPUR = 160;
  const colTotR = PW - MR;
  space(9);
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(ML, y, CW, 7, "F");
  font("bold", 8, [255, 255, 255]);
  doc.text("Désignation", ML + 1.5, y + 4.8);
  doc.text("Qté", colQtyR, y + 4.8, { align: "right" });
  doc.text("Unité", colUnit, y + 4.8);
  doc.text("Prix unitaire HT", colPUR, y + 4.8, { align: "right" });
  doc.text("Total HT", colTotR, y + 4.8, { align: "right" });
  y += 7;

  c.lines.forEach((l) => {
    let label = l.category === "Autres prestations personnalisées" ? "" : l.category;
    if (label && l.description) label += " — ";
    label = (label + (l.description || "")).trim();
    if (!label) label = "Prestation";
    font("normal", 8.5, INK);
    const descLines = doc.splitTextToSize(pdfText(label), colDescW);
    const rowH = Math.max(6, descLines.length * 4 + 2.5);
    space(rowH + 1);
    font("normal", 8.5, INK);
    descLines.forEach((t, i) => doc.text(t, ML + 1.5, y + 4 + i * 4));
    doc.text(pdfText(l.qty || "0"), colQtyR, y + 4, { align: "right" });
    doc.text(pdfText(l.unit || "—"), colUnit, y + 4);
    doc.text(pdfMoney(l.priceNum), colPUR, y + 4, { align: "right" });
    doc.text(pdfMoney(l.total), colTotR, y + 4, { align: "right" });
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(ML, y + rowH, PW - MR, y + rowH);
    y += rowH;
  });

  const extras = [];
  if (c.move > 0) extras.push(["Frais de déplacement", c.move]);
  if (c.material > 0) extras.push(["Frais de matériel", c.material]);
  if (c.evac > 0) extras.push(["Frais d'évacuation des déchets verts", c.evac]);
  extras.forEach((e) => {
    space(7);
    font("normal", 8.5, INK);
    doc.text(pdfText(e[0]), ML + 1.5, y + 4);
    doc.text(pdfMoney(e[1]), colTotR, y + 4, { align: "right" });
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(ML, y + 6, PW - MR, y + 6);
    y += 6;
  });
  if (c.remise > 0) {
    space(7);
    font("normal", 8.5, RED);
    doc.text("Remise", ML + 1.5, y + 4);
    doc.text("-" + pdfMoney(c.remise), colTotR, y + 4, { align: "right" });
    y += 6;
  }
  y += 3;

  /* ---- Totaux ---- */
  const tw = 75;
  const tx = PW - MR - tw;
  const totRows = [
    ["Total HT", pdfMoney(c.totalHT), false],
    c.rate > 0 ? ["TVA " + c.rate + " %", pdfMoney(c.tva), false] : ["TVA", "Non applicable", false],
    ["TOTAL à payer", pdfMoney(c.totalTTC), true]
  ];
  space(totRows.length * 6 + 4);
  totRows.forEach((r) => {
    if (r[2]) {
      doc.setFillColor(GREENBG[0], GREENBG[1], GREENBG[2]);
      doc.rect(tx, y, tw, 7, "F");
      font("bold", 9, GREEN);
    } else {
      font("normal", 8.5, INK);
    }
    doc.text(pdfText(r[0]), tx + 2, y + 4.8);
    doc.text(r[1], PW - MR - 2, y + 4.8, { align: "right" });
    y += r[2] ? 7 : 6;
  });
  y += 4;

  para("Conditions de paiement :", d.conditions);
  para("Coordonnées bancaires :", p.facturation);
  para("Notes :", d.notes);

  const mentions = [];
  if (c.rate === 0) mentions.push("TVA non applicable, art. 293 B du CGI (franchise en base de TVA).");
  if (p.mentions) mentions.push(pdfText(p.mentions));
  if (mentions.length) {
    font("normal", 7, GREY);
    const wrapped = doc.splitTextToSize(mentions.join("  "), CW);
    space(wrapped.length * 3.5 + 2);
    font("normal", 7, GREY);
    wrapped.forEach((t, i) => doc.text(t, ML, y + i * 3.5));
    y += wrapped.length * 3.5 + 4;
  }

  /* ---- Signature ---- */
  space(32);
  doc.setDrawColor(169, 196, 178);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.roundedRect(ML, y, CW, 26, 2, 2);
  doc.setLineDashPattern([], 0);
  font("bold", 8.5, INK);
  doc.text("Bon pour accord du client", ML + 3, y + 5);
  font("normal", 7.5, GREY);
  doc.text("Date et signature du client :", ML + 3, y + 10);
  doc.text("« J'accepte le devis ci-dessus et ses conditions. »", ML + 3, y + 14.5);
  y += 30;

  space(10);
  doc.setFillColor(GREENBG[0], GREENBG[1], GREENBG[2]);
  doc.roundedRect(ML, y, CW, 8, 1.5, 1.5, "F");
  font("bold", 7.5, GREEN);
  doc.text("Le présent devis doit être accepté (signature du client) avant le début des travaux.", ML + 2.5, y + 5);

  return doc;
}

/* ---------- Historique ---------- */
function renderHistory() {
  const q = ($("history-search").value || "").trim().toLowerCase();
  const list = $("history-list");
  const devis = db.devis
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filtered = devis.filter((d) => {
    if (!q) return true;
    return (d.client.nom || "").toLowerCase().includes(q) || (d.number || "").toLowerCase().includes(q);
  });

  if (devis.length === 0) {
    list.innerHTML = '<li class="empty-state">Aucun devis pour le moment.<br>Créez votre premier devis depuis l\'accueil.</li>';
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = '<li class="empty-state">Aucun devis ne correspond à « ' + esc(q) + ' ».</li>';
    return;
  }

  list.innerHTML = filtered.map((d) => {
    const c = calcDevis(d);
    const st = STATUSES[d.status] || STATUSES.brouillon;
    return (
      '<li class="history-item" data-id="' + esc(d.id) + '">' +
        '<div class="hi-main" data-action="open">' +
          '<span class="hi-num">' + esc(d.number) + "</span> " +
          '<span class="badge ' + st.cls + '">' + st.label + "</span>" +
          '<div class="hi-client">' + esc(d.client.nom || "Sans nom") + "</div>" +
          '<div class="hi-meta">' + fmtDate(d.date) + " · " + euro(c.totalTTC) +
            (c.rate > 0 ? " TTC" : "") +
            ((d.items || []).length ? " · " + d.items.length + " prestation" + (d.items.length > 1 ? "s" : "") : "") +
          "</div>" +
        "</div>" +
        '<div class="hi-actions">' +
          '<button type="button" class="btn btn-outline btn-small" data-action="open">Ouvrir</button>' +
          '<button type="button" class="btn btn-outline btn-small" data-action="duplicate">Dupliquer</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-action="delete">Supprimer</button>' +
        "</div>" +
      "</li>"
    );
  }).join("");
}

/* ---------- Tableau de bord ---------- */
function renderDashboard() {
  const n = db.devis.length;
  const acceptes = db.devis.filter((d) => d.status === "accepte" || d.status === "termine");
  const totalAccepte = acceptes.reduce((s, d) => s + calcDevis(d).totalTTC, 0);
  $("dashboard-stats").textContent = n === 0
    ? "Vous n'avez pas encore de devis."
    : n + " devis enregistré" + (n > 1 ? "s" : "") + " · " + acceptes.length + " accepté" + (acceptes.length > 1 ? "s" : "") +
      (acceptes.length ? " · " + euro(totalAccepte) : "");
  const b = $("abo-banner");
  if (aboActive()) {
    const isTrial = (abo.plan || "").indexOf("essai-") === 0;
    const days = aboDaysLeft();
    const jTxt = days + " jour" + (days > 1 ? "s" : "");
    b.textContent = isTrial
      ? "Essai gratuit — " + jTxt + " restant" + (days > 1 ? "s" : "") + ". Touchez pour voir les formules."
      : "Abonnement " + (abo.plan === "mensuel" ? "mensuel" : "annuel") + " actif — " + jTxt + " restant" + (days > 1 ? "s" : "") + ".";
  } else {
    b.textContent = "Accès limité : abonnement requis. Touchez pour vous abonner.";
  }
}

/* ---------- Profil ---------- */
function fillProfileForm() {
  const p = db.profile;
  $("pro-entreprise").value = p.entreprise;
  $("pro-nom").value = p.nom;
  $("pro-adresse").value = p.adresse;
  $("pro-tel").value = p.tel;
  $("pro-email").value = p.email;
  $("pro-siret").value = p.siret;
  $("pro-facturation").value = p.facturation;
  $("pro-regime").value = p.regime || "franchise";
  $("pro-mentions").value = p.mentions;
  updateLogoPreview();
}

function updateLogoPreview() {
  const wrap = $("logo-preview-wrap");
  if (db.profile.logo) {
    $("logo-preview").src = db.profile.logo;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

function saveProfile(e) {
  e.preventDefault();
  const entreprise = $("pro-entreprise").value.trim();
  if (!entreprise) {
    $("pro-entreprise").classList.add("field-error");
    showToast("Le nom de l'entreprise est obligatoire.", true);
    return;
  }
  $("pro-entreprise").classList.remove("field-error");
  db.profile = {
    ...db.profile,
    entreprise,
    nom: $("pro-nom").value.trim(),
    adresse: $("pro-adresse").value.trim(),
    tel: $("pro-tel").value.trim(),
    email: $("pro-email").value.trim(),
    siret: $("pro-siret").value.trim(),
    facturation: $("pro-facturation").value.trim(),
    regime: $("pro-regime").value,
    mentions: $("pro-mentions").value.trim()
  };
  if (saveDB()) showToast("Profil de l'entreprise enregistré.");
}

function handleLogoFile(file) {
  if (!file) return;
  if (file.size > 400 * 1024) {
    showToast("Logo trop volumineux : choisissez une image de moins de 400 Ko.", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    db.profile.logo = String(reader.result);
    if (saveDB()) {
      updateLogoPreview();
      showToast("Logo enregistré.");
    }
  };
  reader.readAsDataURL(file);
}

/* ---------- Sauvegarde / restauration ---------- */
function exportBackup() {
  try {
    const payload = JSON.stringify({ app: "JardinDevis", version: 1, exportedAt: new Date().toISOString(), data: db }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jardindevis-sauvegarde-" + todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Sauvegarde téléchargée. Conservez-la en lieu sûr.");
  } catch (e) {
    showToast("Impossible de créer la sauvegarde.", true);
  }
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const data = parsed && parsed.data ? parsed.data : null;
      if (!data || !data.profile || !Array.isArray(data.devis)) {
        throw new Error("format invalide");
      }
      if (!confirm("Restaurer cette sauvegarde ? Les devis actuels de cet appareil seront remplacés.")) return;
      db = {
        profile: { ...DEFAULT_PROFILE, ...data.profile },
        devis: data.devis,
        seq: Number(data.seq) || 0,
        seqYear: Number(data.seqYear) || new Date().getFullYear()
      };
      if (saveDB()) {
        fillProfileForm();
        renderDashboard();
        showToast("Sauvegarde restaurée : " + db.devis.length + " devis.");
      }
    } catch (e) {
      showToast("Fichier de sauvegarde invalide.", true);
    }
  };
  reader.readAsText(file);
}

/* ---------- Abonnement ---------- */
const ABO_LS_KEY = "jardindevis.abo.v1";
// Clé secrète contenue dans les liens d'activation après paiement.
// IMPORTANT : changez-la avant de vendre l'application, et utilisez la même
// dans les URLs de redirection Stripe (voir README, section Abonnement).
const ABO_SECRET = "JARDINDEVIS-2025";
// Liens de paiement Stripe (Payment Links, gratuits à créer sur stripe.com).
// Laissez vide tant que Stripe n'est pas configuré : le bouton « S'abonner »
// préviendra alors l'utilisateur. Voir README pour la configuration.
const STRIPE_LINK_MENSUEL = "";
const STRIPE_LINK_ANNUEL = "";
// Essais gratuits : 1 jour sur l'offre mensuelle, 3 jours sur l'offre annuelle.
const TRIAL_DAYS = { mensuel: 1, annuel: 3 };
// Durée d'un abonnement payé, en mois.
const ABO_DURATION = { mensuel: 1, annuel: 12 };

let abo = { plan: null, end: 0, trials: {} };

function loadAbo() {
  try {
    const raw = localStorage.getItem(ABO_LS_KEY);
    if (!raw) return;
    const a = JSON.parse(raw);
    if (a && typeof a === "object") {
      abo.plan = typeof a.plan === "string" ? a.plan : null;
      abo.end = Number(a.end) || 0;
      abo.trials = a.trials && typeof a.trials === "object" ? a.trials : {};
    }
  } catch (e) {
    /* abonnement illisible : considéré inactif */
  }
}

function saveAbo() {
  try {
    localStorage.setItem(ABO_LS_KEY, JSON.stringify(abo));
  } catch (e) {
    /* stockage indisponible : l'abonnement ne sera pas mémorisé */
  }
}

function aboActive() {
  return !!abo.plan && Date.now() < abo.end;
}

function aboDaysLeft() {
  return Math.max(0, Math.ceil((abo.end - Date.now()) / (24 * 60 * 60 * 1000)));
}

function aboLabel(plan) {
  if (plan === "mensuel") return "Abonnement mensuel";
  if (plan === "annuel") return "Abonnement annuel";
  if (plan === "essai-mensuel") return "Essai mensuel";
  if (plan === "essai-annuel") return "Essai annuel";
  return "";
}

function addMonths(timestamp, m) {
  const d = new Date(timestamp);
  d.setMonth(d.getMonth() + m);
  return d.getTime();
}

function activate(plan) {
  const base = Math.max(Date.now(), aboActive() ? abo.end : 0);
  abo.plan = plan;
  abo.end = addMonths(base, ABO_DURATION[plan]);
  saveAbo();
}

function startTrial(plan) {
  if (aboActive()) {
    showToast("Votre abonnement est déjà actif.");
    showView("dashboard");
    return;
  }
  if (abo.trials[plan]) {
    showToast("Cet essai gratuit a déjà été utilisé sur cet appareil.", true);
    return;
  }
  const days = TRIAL_DAYS[plan];
  abo.plan = "essai-" + plan;
  abo.end = Date.now() + days * 24 * 60 * 60 * 1000;
  abo.trials[plan] = true;
  saveAbo();
  navStack.length = 0;
  showToast("Essai gratuit de " + days + " jour" + (days > 1 ? "s" : "") + " activé ! Bon travail !");
  updateAboUI();
  showView("dashboard");
}

function buySubscription(plan) {
  const url = plan === "mensuel" ? STRIPE_LINK_MENSUEL : STRIPE_LINK_ANNUEL;
  if (!url) {
    showToast("Le paiement en ligne n'est pas encore configuré. L'essai gratuit reste disponible.", true);
    return;
  }
  window.open(url, "_blank");
}

// Après paiement sur Stripe, l'utilisateur revient avec un lien du type
// ...?abonnement=mensuel&cle=... : on active alors son abonnement.
function handleActivationParam() {
  const params = new URLSearchParams(location.search);
  const plan = params.get("abonnement");
  if (!plan || !(plan in ABO_DURATION)) return;
  const cle = params.get("cle");
  if (ABO_SECRET && cle !== ABO_SECRET) {
    showToast("Lien d'activation invalide.", true);
  } else {
    activate(plan);
    navStack.length = 0;
    showToast("Abonnement " + (plan === "mensuel" ? "mensuel" : "annuel") + " activé ! Merci !");
  }
  params.delete("abonnement");
  params.delete("cle");
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

function updateAboUI() {
  const st = $("abo-status");
  const cont = $("abo-continue");
  if (aboActive()) {
    const isTrial = (abo.plan || "").indexOf("essai-") === 0;
    const days = aboDaysLeft();
    const endTxt = new Date(abo.end).toLocaleDateString("fr-FR");
    st.innerHTML = isTrial
      ? '<span class="badge st-envoye">Essai actif</span> Il vous reste ' + days + " jour" + (days > 1 ? "s" : "") +
        " (jusqu'au " + endTxt + "). Choisissez votre formule pour continuer après l'essai."
      : '<span class="badge st-accepte">' + esc(aboLabel(abo.plan)) + " actif</span> Valide jusqu'au " + endTxt + ".";
    cont.hidden = false;
  } else if (abo.plan) {
    st.innerHTML = '<span class="badge st-refuse">Abonnement expiré</span> Renouvelez pour continuer à créer des devis.';
    cont.hidden = true;
  } else {
    st.textContent = "Choisissez votre formule. Des essais gratuits sont disponibles.";
    cont.hidden = true;
  }
  $("abo-trial-mensuel").disabled = !!abo.trials.mensuel;
  $("abo-trial-annuel").disabled = !!abo.trials.annuel;
}

/* ---------- Événements ---------- */
function bindEvents() {
  // Navigation par boutons data-nav
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const nav = el.getAttribute("data-nav");
      if (nav === "new-devis") openNewDevis();
      else showView(nav);
      updateBackLabel();
    });
  });
  $("btn-back").addEventListener("click", goBack);

  // Formulaire devis
  $("btn-add-item").addEventListener("click", addEmptyItem);
  $("items-container").addEventListener("click", (e) => {
    if (e.target.classList.contains("i-del")) {
      e.target.closest(".item-row").remove();
      updateLiveTotal();
    }
  });
  $("devis-form").addEventListener("input", () => { refreshItemTotals(); updateLiveTotal(); });
  $("dei-regime").addEventListener("change", () => { applyRegimeUI(); updateLiveTotal(); });
  $("btn-save").addEventListener("click", () => saveDevis(false));
  $("btn-save-preview").addEventListener("click", () => saveDevis(true));
  $("btn-cancel-form").addEventListener("click", () => {
    if (confirm("Annuler ? Les modifications non enregistrées seront perdues.")) goBack();
  });

  // Aperçu
  $("pv-pdf").addEventListener("click", downloadPdf);
  $("pv-print").addEventListener("click", () => printDevis(false));
  $("pv-share").addEventListener("click", shareDevis);
  $("pv-edit").addEventListener("click", () => { if (previewId) openEditDevis(previewId); });
  $("pv-duplicate").addEventListener("click", () => { if (previewId) duplicateDevis(previewId); });
  $("pv-status").addEventListener("change", () => {
    const d = previewId && findDevis(previewId);
    if (!d) return;
    d.status = $("pv-status").value;
    d.updatedAt = Date.now();
    if (saveDB()) showToast("Statut mis à jour : " + STATUSES[d.status].label + ".");
  });

  // Historique
  $("history-search").addEventListener("input", renderHistory);
  $("history-list").addEventListener("click", (e) => {
    const li = e.target.closest(".history-item");
    if (!li) return;
    const id = li.getAttribute("data-id");
    const actionEl = e.target.closest("[data-action]");
    const action = actionEl ? actionEl.getAttribute("data-action") : "open";
    if (action === "delete") {
      if (confirm("Supprimer définitivement ce devis ?")) {
        db.devis = db.devis.filter((x) => x.id !== id);
        if (saveDB()) { renderHistory(); renderDashboard(); showToast("Devis supprimé."); }
      }
      return;
    }
    if (action === "duplicate") { duplicateDevis(id); return; }
    renderPreview(id);
  });

  // Profil
  $("profile-form").addEventListener("submit", saveProfile);
  $("pro-logo-input").addEventListener("change", (e) => handleLogoFile(e.target.files[0]));
  $("btn-logo-remove").addEventListener("click", () => {
    db.profile.logo = "";
    if (saveDB()) { updateLogoPreview(); showToast("Logo retiré."); }
  });
  $("btn-export").addEventListener("click", exportBackup);
  $("btn-import").addEventListener("change", (e) => { importBackup(e.target.files[0]); e.target.value = ""; });

  // Abonnement
  $("abo-trial-mensuel").addEventListener("click", () => startTrial("mensuel"));
  $("abo-trial-annuel").addEventListener("click", () => startTrial("annuel"));
  $("abo-buy-mensuel").addEventListener("click", () => buySubscription("mensuel"));
  $("abo-buy-annuel").addEventListener("click", () => buySubscription("annuel"));
  $("abo-continue").addEventListener("click", () => showView("dashboard"));
}

/* ---------- Démarrage ---------- */
loadDB();
loadAbo();
handleActivationParam();
bindEvents();
renderDashboard();
showView(aboActive() ? "dashboard" : "abonnement");
updateBackLabel();