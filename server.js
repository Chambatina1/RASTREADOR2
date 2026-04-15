import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-session-id"] }));
app.use(express.json({ limit: "2mb" }));

// ================= CONTEXTO DEL CHAT =================
const BUSINESS_CONTEXT = `
ASISTENTE OFICIAL CHAMBATINA - LOGÍSTICA Y ENVÍOS A CUBA.
Responde siempre en español claro, directo y profesional.
No inventes precios ni condiciones.

PRECIOS: 1.99 por libra + 25 por equipo.
Bicicletas: niño sin empacar $25, niño empacada $15, adulto sin empacar $45, adulto empacada $25, eléctrica en caja $35, eléctrica sin caja $50.
Oficina: 7523 Aloma Ave, Winter Park, FL 32792, Suite 112.
Tiempos: 18 a 30 días una vez que toca puerto.
`;

// ================= BASE DE DATOS LOCAL SIMPLIFICADA (solo ejemplos) =================
const RAW_TRACKING_SOURCE = `
CHAMBATINA MIAMI	GEO MIA		CPK-0255139	ENTREGADO	Sí		ENVIO	MISCELANEA		2026-03-09	ELSA BARRIOS	86012204812
CHAMBATINA MIAMI	GEO MIA		CPK-0253092	EN DISTRIBUCION	Sí		ENVIO	MISCELANEA		2026-03-01	ANNIA CARABALLO	83032106338
CHAMBATINA MIAMI	GEO MIA		CPK-0264373	EN AGENCIA	No		ENVIO	GENERADOR DELTA 3		2026-04-07	PABLO CABRERA	00012068886
`;

// ================= UTILIDADES =================
function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }
function primerNombre(nombre) { return String(nombre || "").trim().split(/\s+/)[0] || ""; }
function parseFechaSegura(fechaTexto) {
  const m = String(fechaTexto || "").match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function diasNaturalesEntre(desdeTexto, hastaFecha = new Date()) {
  const desde = parseFechaSegura(desdeTexto);
  if (!desde) return 0;
  const hasta = new Date(hastaFecha);
  desde.setHours(0,0,0,0);
  hasta.setHours(0,0,0,0);
  return Math.max(0, Math.floor((hasta - desde) / 86400000));
}
function normalizarLinea(linea) { return String(linea || "").replace(/\r/g, "").trim(); }
function normalizarCPK(texto) { return soloDigitos(texto); }
function construirSaludo(embarcador, consignatario, estado) {
  const nombre = primerNombre(embarcador);
  return nombre ? `Hola ${nombre}, tu mercancía se encuentra en: ${estado}.` : `Hola, tu mercancía se encuentra en: ${estado}.`;
}

// ================= ESTADOS LOGÍSTICOS (original detallado) =================
const ETAPAS = {
  ENTREGADO: "ENTREGADO",
  EN_AGENCIA: "EN AGENCIA",
  PREPARACION_EMBARQUE: "EN PREPARACIÓN DE EMBARQUE",
  EN_CONTENEDOR: "EN CONTENEDOR",
  EN_PUERTO: "EN PUERTO",
  PROCESO_PORTUARIO: "EN PROCESO PORTUARIO",
  EN_ADUANA: "EN ADUANA",
  VALIDACION_DESPACHO: "EN VALIDACIÓN PARA DESPACHO",
  REVISION_LOGISTICA: "EN REVISIÓN LOGÍSTICA",
  PROCESO_INTERNO: "EN PROCESOS OPERATIVOS INTERNOS",
  CLASIFICACION: "EN PROCESO DE CLASIFICACIÓN",
  TRASLADO_PROVINCIA: "TRASLADO HACIA PROVINCIA",
  ALMACEN_PROVINCIA: "EN ALMACÉN DE DESTINO",
  LISTO_DISTRIBUCION: "LISTO PARA DISTRIBUCIÓN",
  REORGANIZACION_DISTRIBUCION: "REORGANIZACIÓN DE DISTRIBUCIÓN",
  DISTRIBUCION: "EN DISTRIBUCIÓN",
  DEMORA_LOGISTICA: "DEMORA POR PROCESOS LOGÍSTICOS",
  ATRASO_COMBUSTIBLE: "ATRASO POR PROBLEMAS DE COMBUSTIBLE",
  EN_PROCESO: "EN PROCESO"
};

function mapearEstadoTexto(estadoTexto) {
  const e = String(estadoTexto || "").toUpperCase();
  if (e.includes("ENTREGADO")) return ETAPAS.ENTREGADO;
  if (e.includes("DISTRIBUC")) return ETAPAS.DISTRIBUCION;
  if (e.includes("CLASIFIC")) return ETAPAS.CLASIFICACION;
  if (e.includes("ADUANA")) return ETAPAS.EN_ADUANA;
  if (e.includes("PUERTO")) return ETAPAS.EN_PUERTO;
  if (e.includes("CONTENEDOR")) return ETAPAS.EN_CONTENEDOR;
  if (e.includes("EMBARQUE")) return ETAPAS.PREPARACION_EMBARQUE;
  if (e.includes("AGENCIA")) return ETAPAS.EN_AGENCIA;
  return "";
}

function estadoPorTiempo(fechaTexto) {
  if (!fechaTexto) return ETAPAS.EN_PROCESO;
  const dias = diasNaturalesEntre(fechaTexto);
  if (dias >= 39) return ETAPAS.ATRASO_COMBUSTIBLE;
  if (dias >= 35) return ETAPAS.DEMORA_LOGISTICA;
  if (dias >= 33) return ETAPAS.REORGANIZACION_DISTRIBUCION;
  if (dias >= 29) return ETAPAS.LISTO_DISTRIBUCION;
  if (dias >= 28) return ETAPAS.ALMACEN_PROVINCIA;
  if (dias >= 25) return ETAPAS.TRASLADO_PROVINCIA;
  if (dias >= 23) return ETAPAS.CLASIFICACION;
  if (dias >= 19) return ETAPAS.PROCESO_INTERNO;
  if (dias >= 17) return ETAPAS.REVISION_LOGISTICA;
  if (dias >= 15) return ETAPAS.VALIDACION_DESPACHO;
  if (dias >= 13) return ETAPAS.EN_ADUANA;
  if (dias >= 11) return ETAPAS.PROCESO_PORTUARIO;
  if (dias >= 9) return ETAPAS.EN_PUERTO;
  if (dias >= 7) return ETAPAS.EN_CONTENEDOR;
  if (dias >= 5) return ETAPAS.PREPARACION_EMBARQUE;
  if (dias >= 3) return ETAPAS.EN_AGENCIA;
  return ETAPAS.EN_PROCESO;
}

// ================= PARSER DE TRACKING =================
function extraerCPKDesdeLinea(linea) {
  const m = String(linea).match(/CPK[-\s]?(\d{6,10})/i);
  return m ? m[1] : "";
}
function extraerFechaDesdeLinea(linea) {
  const m = String(linea).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1] : "";
}
function extraerEstadoDesdeLinea(linea) {
  const up = String(linea).toUpperCase();
  if (up.includes("ENTREGADO")) return "ENTREGADO";
  if (up.includes("DISTRIBUCION")) return "DISTRIBUCION";
  if (up.includes("AGENCIA")) return "EN AGENCIA";
  return "";
}
function extraerNombreProbable(linea, fecha) {
  if (!fecha) return "";
  const idx = String(linea).indexOf(fecha);
  if (idx === -1) return "";
  const resto = String(linea).slice(idx + fecha.length).trim();
  const parts = resto.split(/\t+/).filter(p => /^[A-ZÁÉÍÓÚÑ ]{4,}$/i.test(p) && !/\d/.test(p));
  return parts[0] || "";
}
function extraerDescripcionProbable(linea) {
  const parts = String(linea).split(/\t+/);
  for (const p of parts) {
    if (p && !p.match(/^(CPK|ENTREGADO|AGENCIA|DISTRIBUCION|SI|NO|ENVIO|\d+)/i) && p.length > 3) return p;
  }
  return "Sin descripción";
}
function parseTrackingSource(raw) {
  const db = {};
  const lineas = String(raw).split("\n").map(normalizarLinea).filter(Boolean);
  for (const linea of lineas) {
    const cpk = extraerCPKDesdeLinea(linea);
    if (!cpk) continue;
    const fecha = extraerFechaDesdeLinea(linea);
    const estadoDir = extraerEstadoDesdeLinea(linea);
    const estado = mapearEstadoTexto(estadoDir) || estadoPorTiempo(fecha);
    const embarcador = extraerNombreProbable(linea, fecha);
    const descripcion = extraerDescripcionProbable(linea);
    db[cpk] = { cpk, fecha, estado, descripcion, embarcador, consignatario: "" };
  }
  return db;
}
let TRACKING_DB = parseTrackingSource(RAW_TRACKING_SOURCE);
function getTrackingDb() { return TRACKING_DB; }

// ================= MEMORIA =================
const MEMORIA = new Map();
function getSessionKey(req) { return req.headers["x-session-id"] || req.ip || "anon"; }
function getMemory(key) {
  const item = MEMORIA.get(key);
  if (!item) return {};
  if (Date.now() - (item.ts || 0) > 600000) MEMORIA.delete(key);
  return item;
}
function setMemory(key, patch) {
  const prev = getMemory(key);
  MEMORIA.set(key, { ...prev, ...patch, ts: Date.now() });
}

// ================= DETECCIÓN DE INTENCIÓN =================
function detectarPeso(texto) {
  const m = String(texto).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(lb|libras?)/);
  return m ? Number(m[1]) : null;
}
function detectarIntencion(texto) {
  const t = String(texto).toLowerCase();
  const cpk = normalizarCPK(t);
  if (cpk) return { intent: "rastreo", cpk };
  if (/(bicicleta|bici)/.test(t)) return { intent: "bicicleta", tipo: "bicicleta" };
  if (/(ecoflow|delta|river)/.test(t)) return { intent: "ecoflow" };
  if (/(precio|costo|calcular)/.test(t) && detectarPeso(t)) return { intent: "calculo", peso: detectarPeso(t) };
  if (/(dirección|oficina|suite|aloma)/.test(t)) return { intent: "direccion" };
  if (/(tiempo|demora|tarda)/.test(t)) return { intent: "tiempo" };
  if (/(caja|12x12|15x15|16x16)/.test(t)) return { intent: "cajas" };
  return { intent: "chat" };
}

// ================= CÁLCULOS =================
function calcularEnvio(peso) {
  const base = peso * 1.99;
  const total = base + 25;
  return `${peso} lb × 1.99 = $${base.toFixed(2)} + $25 = $${total.toFixed(2)}`;
}
function responderEcoflow(peso) {
  return `EcoFlow es un sistema solar portátil.${peso ? ` Envío: ${calcularEnvio(peso)}` : " Indíqueme el peso para calcular el envío."}`;
}

// ================= ENDPOINTS =================
app.get("/api/health", (req, res) => res.json({ ok: true, totalCPK: Object.keys(getTrackingDb()).length }));
app.get("/api/rastreo/:cpk", (req, res) => {
  const cpk = normalizarCPK(req.params.cpk);
  const item = getTrackingDb()[cpk];
  if (!item) return res.json({ ok: false, mensaje: "CPK no encontrado" });
  res.json({ ok: true, cpk, estado: item.estado, fecha: item.fecha, descripcion: item.descripcion, saludo: construirSaludo(item.embarcador, "", item.estado) });
});
app.get("/api/buscar/:termino", async (req, res) => {
  const term = soloDigitos(req.params.termino);
  if (!term) return res.status(400).json({ ok: false });
  const item = getTrackingDb()[term];
  if (item) return res.json({ ok: true, tipo: "cpk", ...item });
  // fallback a Kanguro (opcional)
  try {
    const resp = await axios.post("https://www.solvedc.com/tracking/kanguro/", new URLSearchParams({ ci: term, hbl: "" }), { timeout: 10000 });
    const $ = cheerio.load(resp.data);
    const row = $("table tr").eq(1);
    const tds = row.find("td");
    if (tds.length) {
      return res.json({ ok: true, tipo: "kanguro", cpk: tds.eq(1).text(), estado: tds.eq(2).text(), fecha: tds.eq(3).text() });
    }
  } catch (e) {}
  res.status(404).json({ ok: false, mensaje: "No encontrado" });
});
app.post("/api/chat", async (req, res) => {
  const mensaje = String(req.body.mensaje || "").trim();
  if (!mensaje) return res.status(400).json({ ok: false });
  const session = getSessionKey(req);
  const mem = getMemory(session);
  const intent = detectarIntencion(mensaje);
  if (intent.intent === "rastreo") {
    const item = getTrackingDb()[intent.cpk];
    if (!item) return res.json({ ok: false, mensaje: "CPK no existe" });
    setMemory(session, { lastCPK: intent.cpk });
    return res.json({ ok: true, respuesta: `${construirSaludo(item.embarcador, "", item.estado)}\nFecha: ${item.fecha}\n${item.descripcion}` });
  }
  if (intent.intent === "calculo") {
    const respuesta = calcularEnvio(intent.peso);
    setMemory(session, { lastWeight: intent.peso });
    return res.json({ ok: true, respuesta });
  }
  if (intent.intent === "ecoflow") {
    const peso = intent.peso || mem.lastWeight;
    return res.json({ ok: true, respuesta: responderEcoflow(peso) });
  }
  if (intent.intent === "bicicleta") {
    return res.json({ ok: true, respuesta: "Bicicleta de niño sin empacar: $25, adulto sin empacar: $45, eléctrica en caja: $35. ¿Cuál necesitas?" });
  }
  if (intent.intent === "direccion") return res.json({ ok: true, respuesta: "7523 Aloma Ave, Winter Park, FL 32792, Suite 112" });
  if (intent.intent === "tiempo") return res.json({ ok: true, respuesta: "18 a 30 días después de tocar puerto." });
  if (intent.intent === "cajas") return res.json({ ok: true, respuesta: "Caja 12x12x12: $45, 15x15x15: $65, 16x16x16: $85" });
  // OpenAI fallback
  if (!process.env.OPENAI_API_KEY) return res.json({ ok: true, respuesta: "Escribe 'rastreo CPK-xxxx', 'calcular 10 lb', 'bicicleta', 'dirección' o 'tiempo'." });
  const openai = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: BUSINESS_CONTEXT }, { role: "user", content: mensaje }], temperature: 0.3 })
  });
  const data = await openai.json();
  const respuesta = data.choices?.[0]?.message?.content || "No entendí.";
  res.json({ ok: true, respuesta });
});

// ================= INICIO =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor en puerto ${PORT}`));
