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
  if (name !== currentView) navStack.push(currentView);
  currentView = name;
  ["dashboard", "devis-form", "preview", "history", "profile"].forEach((v) => {
    $("view-" + v).hidden = (v !== name);
  });
  $("btn-back").hidden = (name === "dashboard" || navStack.length === 0);
  window.scrollTo({ top: 0 });
}

function goBack() {
  const prev = navStack.pop() || "dashboard";
  currentView = prev;
  ["dashboard", "devis-form", "preview", "history", "profile"].forEach((v) => {
    $("view-" + v).hidden = (v !== prev);
  });
  $("btn-back").hidden = (prev === "dashboard" || navStack.length === 0);
  if (prev === "history") renderHistory();
  if (prev === "dashboard") renderDashboard();
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
  $("pv-pdf").addEventListener("click", () => printDevis(true));
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
}

/* ---------- Démarrage ---------- */
loadDB();
bindEvents();
renderDashboard();
showView("dashboard");
updateBackLabel();