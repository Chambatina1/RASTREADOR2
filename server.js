import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-session-id"] }));
app.use(express.json({ limit: "2mb" }));

// 🔧 middlewares (siempre van primero)

app.use(express.urlencoded({ extended: true }));

// ✅ AQUÍ pegas tu ruta raíz
app.get('/', (req, res) => {
  res.send('Servidor funcionando 🚀');
});

// 🚀 levantar servidor (siempre al final)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
// ================= CONTEXTO DEL CHAT (mejorado, más cálido) =================
const BUSINESS_CONTEXT = `
ASISTENTE OFICIAL CHAMBATINA - LOGÍSTICA Y ENVÍOS A CUBA.
Eres amable, proactivo y siempre ofreces ayuda adicional. Responde en español claro, con emojis cuando sea apropiado.
No inventes precios ni condiciones.

PRECIOS: 1.99 por libra + 25 por equipo.
Bicicletas: niño sin empacar $25, niño empacada $15, adulto sin empacar $45, adulto empacada $25, eléctrica en caja $35, eléctrica sin caja $50.
Oficina: 7523 Aloma Ave, Winter Park, FL 32792, Suite 112.
Tiempos: 18 a 30 días una vez que toca puerto.

Siempre que respondas, ofrece al final una sugerencia útil: "¿Necesitas saber el estado de otro paquete? Envíame el CPK", o "¿Quieres calcular el costo de otro peso?".
`;

// ================= BASE DE DATOS DESORGANIZADA (TAL CUAL LA TENÍAS) =================
const RAW_TRACKING_SOURCE = `
CHAMBATINA MIAMI	GEO MIA		CPK-0255139	ENTREGADO	Sí		ENVIO	MISCELANEA		2026-03-09	ELSA BARRIOS	86012204812
CHAMBATINA MIAMI	GEO MIA		CPK-0255139	ENTREGADO	Sí	140(CPK-309)	REGULA/(BSIU 9722526)/(CWPS26167603)	ENVIO	MISCELANEA	10916	2026-03-09	ELSA BARRIOS PEREZ		86012204812	AVE 25 # 3017 Rpto. LA SIERRA e/ 30 y 34, PLAYA, LA HABANA	53358593	ERISBEL FORNARIS			0	0	1	19.8	0.579	0	0	0
CHAMBATINA MIAMI	GEO MIA		CPK-0266860	EN AGENCIA	No	ENVIOS FACTURADOS	ENVIOS FACTURADOS/()/(ENVIOS FACTURADOS)	ENVIO	GENERADOR ELECTRICO 2400 W		2026-04-14	JULIO SÁNCHEZ HERNANDEZ		50092905351	CALLE PASEO DE LA PAZ # 362 Rpto. CHAMBERY e/ NUEVA GERONA y PRIMERA DEL OESTE, SANTA CLARA, VILLA CLARA	53382367	ISMAEL PÉREZ			0	0	1	59.1	1.588	0	0	0		
CHAMBATINA MIAMI	GEO MIA		CPK-0266858	EN AGENCIA	No	ENVIOS FACTURADOS	ENVIOS FACTURADOS/()/(ENVIOS FACTURADOS)	ENVIO	MISCELANEA 16		2026-04-14	JULIO SÁNCHEZ HERNANDEZ		50092905351	CALLE PASEO DE LA PAZ # 362 Rpto. CHAMBERY e/ NUEVA GERONA y PRIMERA DEL OESTE, SANTA CLARA, VILLA CLARA	53382367	ISMAEL PÉREZ			0	0	1	43	2.37	219.32	0	0		
CHAMBATINA MIAMI	GEO MIA		CPK-0266857	EN AGENCIA	No	ENVIOS FACTURADOS	ENVIOS FACTURADOS/()/(ENVIOS FACTURADOS)	ENVIO	MISCELANEA 16		2026-04-14	JULIO SÁNCHEZ HERNANDEZ		50092905351	CALLE PASEO DE LA PAZ # 362 Rpto. CHAMBERY e/ NUEVA GERONA y PRIMERA DEL OESTE, SANTA CLARA, VILLA CLARA	53382367	ISMAEL PÉREZ			0	0	1	58	2.37	219.32	0	0		
CHAMBATINA MIAMI	GEO MIA		CPK-0266460	EN AGENCIA	No	ENVIOS FACTURADOS	ENVIOS FACTURADOS/()/(ENVIOS FACTURADOS)	ENVIO	BATERIA		2026-04-13	MAURA EUGENIA RODRIGUEZ VELAZQUEZ		53111507356	CALLE CAVADA # 6 e/ FRANCISCO VICENTE AGUILERA y JUSTO AGUILERA, GIBARA, HOLGUIN	54800232	RADIEL CABRERA			0	0	1	118.74	1.588	0	0	0		
CHAMBATINA MIAMI	GEO MIA		CPK-0259420	EN ALMACEN CAMAGUEY	Sí	169(CPK-313)	STORM/(CMCU 4961207)/(CWPS26170095)	ENVIO	COLCHON	11087	2026-03-23	ROSABEL SALAZAR BARRERAS		89070834296	CALLE 6 # 63 Rpto. EL PORVENIR e/ B y C, CAMAGUEY, CAMAGUEY	58279237	REYNALDO DANGER GOMEZ			0	0	1	80	3.375	0	0	0		
... (aquí puedes poner el resto de tus líneas, todo el texto original que tenías) ...
`;

// ================= UTILIDADES DE PARSING (las que ya tenías) =================
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
function construirSaludo(embarcador, estado) {
  const nombre = primerNombre(embarcador);
  if (nombre) return `📦 Hola ${nombre}, tu paquete está en: *${estado}*.`;
  return `📦 Hola, tu paquete está en: *${estado}*.`;
}

// ================= PARSER DE LA BASE DE DATOS DESORDENADA =================
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
  if (up.includes("EN AGENCIA")) return "EN AGENCIA";
  if (up.includes("EMBARCADO")) return "EMBARCADO";
  if (up.includes("EN ALMACEN")) return "EN ALMACEN";
  return "EN PROCESO";
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
    const estado = extraerEstadoDesdeLinea(linea);
    const embarcador = extraerNombreProbable(linea, fecha);
    const descripcion = extraerDescripcionProbable(linea);
    // Solo guardamos la primera ocurrencia de cada CPK (o la última, según prefieras)
    if (!db[cpk]) {
      db[cpk] = { cpk, fecha, estado, descripcion, embarcador, consignatario: "" };
    }
  }
  return db;
}

// Cargar la base de datos al iniciar
let TRACKING_DB = parseTrackingSource(RAW_TRACKING_SOURCE);
function getTrackingDb() { return TRACKING_DB; }

// ================= MEMORIA POR SESIÓN =================
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

// ================= DETECCIÓN DE INTENCIONES (mejorada) =================
function detectarPeso(texto) {
  const m = String(texto).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(lb|libras?|lbs?)/);
  return m ? Number(m[1]) : null;
}
function detectarIntencion(texto) {
  const t = String(texto).toLowerCase();
  const cpk = soloDigitos(t);
  if (cpk && cpk.length >= 6) return { intent: "rastreo", cpk };
  if (/(bicicleta|bici|bike)/.test(t)) return { intent: "bicicleta" };
  if (/(ecoflow|delta|river|powerstation)/.test(t)) return { intent: "ecoflow" };
  if (/(precio|costo|calcular|envío|cuánto cuesta)/.test(t) && detectarPeso(t)) return { intent: "calculo", peso: detectarPeso(t) };
  if (/(dirección|oficina|dónde está|ubicación|aloma)/.test(t)) return { intent: "direccion" };
  if (/(tiempo|demora|tarda|días|entrega)/.test(t)) return { intent: "tiempo" };
  if (/(caja|cartón|dimensiones|12x12|15x15|16x16)/.test(t)) return { intent: "cajas" };
  if (/(gracias|ok|vale|entendido)/.test(t)) return { intent: "agradecimiento" };
  return { intent: "chat" };
}

// ================= RESPUESTAS INTELIGENTES (las que ya tenías) =================
function calcularEnvio(peso) {
  const base = peso * 1.99;
  const total = base + 25;
  return `💰 *${peso} lb* → $${base.toFixed(2)} (1.99/lb) + $25 (equipo) = *$${total.toFixed(2)}*. ¿Necesitas cotizar otro peso?`;
}
function responderEcoflow(peso) {
  if (peso) return `🔋 EcoFlow: envío calculado: ${calcularEnvio(peso)}`;
  return `🔋 EcoFlow es un sistema de energía solar portátil. Indícame el peso en lb para calcular el costo de envío. Por ejemplo: "calcular 15 lb".`;
}
function responderBicicleta() {
  return `🚲 *Precios de envío de bicicletas a Cuba*:
- Niño sin empacar: $25
- Niño empacada: $15
- Adulto sin empacar: $45
- Adulto empacada: $25
- Eléctrica en caja: $35
- Eléctrica sin caja: $50
¿Cuál necesitas? Te ayudo con el seguimiento.`;
}
function responderCajas() {
  return `📦 *Tarifas de cajas*:
- 12x12x12: $45
- 15x15x15: $65
- 16x16x16: $85
¿Necesitas enviar una caja? Escríbeme las dimensiones.`;
}
function responderDireccion() {
  return `📍 *Nuestra oficina en Miami*:
7523 Aloma Ave, Winter Park, FL 32792, Suite 112.
¿Necesitas indicaciones para dejar un paquete?`;
}
function responderTiempo() {
  return `⏱️ *Tiempos de entrega a Cuba*: Una vez que el barco toca puerto, la entrega demora *18 a 30 días* (dependiendo de la provincia y procesos aduanales). ¿Quieres rastrear un CPK en específico?`;
}
function responderAgradecimiento() {
  return `😊 ¡De nada! Estoy aquí para ayudarte con tus envíos a Cuba. Si necesitas algo más, solo escríbeme. ¡Que tengas un excelente día!`;
}

// ================= ENDPOINTS =================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, totalCPK: Object.keys(getTrackingDb()).length, mensaje: "Servidor activo y amigable 🚀" });
});
app.post("/api/records/query", (req, res) => {
  console.log("BODY:", req.body);

  res.json({
    ok: true,
    mensaje: "Endpoint funcionando",
    data: req.body
  });
});

app.get("/api/rastreo/:cpk", (req, res) => {
  const cpk = soloDigitos(req.params.cpk);
  const item = getTrackingDb()[cpk];
  if (!item) {
    return res.json({
      ok: false,
      mensaje: `❌ No encontré el CPK ${cpk}. Por favor verifica el número o escríbelo como está en tu recibo (ej. 0255139). ¿Necesitas ayuda para localizarlo?`
    });
  }
  const saludo = construirSaludo(item.embarcador, item.estado);
  const infoAdicional = `📅 Fecha: ${item.fecha}\n📝 Descripción: ${item.descripcion}`;
  const sugerencia = `\n✨ *Sugerencia*: Para otro paquete, escribe "rastreo [número]" o dime "ayuda" para más opciones.`;
  res.json({ ok: true, cpk, estado: item.estado, fecha: item.fecha, descripcion: item.descripcion, saludo: `${saludo}\n${infoAdicional}${sugerencia}` });
});

app.get("/api/buscar/:termino", async (req, res) => {
  const term = soloDigitos(req.params.termino);
  if (!term || term.length < 6) return res.status(400).json({ ok: false, mensaje: "El término debe tener al menos 6 dígitos." });
  const item = getTrackingDb()[term];
  
app.post("/api/records/query", (req, res) => {
  console.log("BODY:", req.body);

  res.json({
    ok: true,
    mensaje: "Endpoint funcionando",
    data: req.body
  });
});
app.post("/api/chat", async (req, res) => {
  const mensaje = String(req.body.mensaje || "").trim();
  if (!mensaje) return res.status(400).json({ ok: false, respuesta: "Por favor escribe algo. Por ejemplo: 'rastreo 0255139' o 'precio 10 lb'." });

  const session = getSessionKey(req);
  const mem = getMemory(session);
  const intent = detectarIntencion(mensaje);

  // Rastreo por CPK
  if (intent.intent === "rastreo") {
    const item = getTrackingDb()[intent.cpk];
    if (!item) {
      return res.json({ ok: false, respuesta: `❌ No encuentro el CPK ${intent.cpk}. ¿Estás seguro del número? Revisa tu recibo o prueba con otro.` });
    }
    setMemory(session, { lastCPK: intent.cpk });
    const saludo = construirSaludo(item.embarcador, item.estado);
    const info = `📅 Fecha: ${item.fecha}\n📦 Producto: ${item.descripcion}`;
    return res.json({ ok: true, respuesta: `${saludo}\n${info}\n\n¿Necesitas rastrear otro paquete? Envíame otro CPK.` });
  }

  // Cálculo de envío
  if (intent.intent === "calculo") {
    const respuesta = calcularEnvio(intent.peso);
    setMemory(session, { lastWeight: intent.peso });
    return res.json({ ok: true, respuesta });
  }

  // EcoFlow
  if (intent.intent === "ecoflow") {
    const peso = intent.peso || mem.lastWeight;
    return res.json({ ok: true, respuesta: responderEcoflow(peso) });
  }

  // Bicicleta
  if (intent.intent === "bicicleta") {
    return res.json({ ok: true, respuesta: responderBicicleta() });
  }

  // Dirección
  if (intent.intent === "direccion") {
    return res.json({ ok: true, respuesta: responderDireccion() });
  }

  // Tiempo
  if (intent.intent === "tiempo") {
    return res.json({ ok: true, respuesta: responderTiempo() });
  }

  // Cajas
  if (intent.intent === "cajas") {
    return res.json({ ok: true, respuesta: responderCajas() });
  }

  // Agradecimiento
  if (intent.intent === "agradecimiento") {
    return res.json({ ok: true, respuesta: responderAgradecimiento() });
  }

  // Ayuda general
  if (mensaje.toLowerCase() === "ayuda" || intent.intent === "chat" && !process.env.OPENAI_API_KEY) {
    const ayuda = `🆘 *Comandos que entiendo*:
- *rastreo [CPK]* → Ej: "rastreo 0255139"
- *calcular [peso] lb* → Ej: "calcular 10 lb"
- *bicicleta* → Precios de envío de bicis
- *ecoflow* → Info sobre sistemas solares
- *dirección* → Nuestra oficina en Miami
- *tiempo* → Plazos de entrega
- *cajas* → Tarifas de cajas por dimensiones
- *ayuda* → Muestra este mensaje

¿En qué más puedo ayudarte? 😊`;
    return res.json({ ok: true, respuesta: ayuda });
  }

  // OpenAI fallback
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ ok: true, respuesta: "Lo siento, no entendí tu consulta. Escribe 'ayuda' para ver qué puedo hacer." });
  }

  try {
    const openai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: BUSINESS_CONTEXT },
          { role: "user", content: mensaje }
        ],
        temperature: 0.3
      })
    });
    const data = await openai.json();
    const respuesta = data.choices?.[0]?.message?.content || "No pude procesar tu solicitud. Intenta con 'ayuda'.";
    return res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("OpenAI error:", err);
    return res.json({ ok: false, respuesta: "Hubo un error técnico. Por favor intenta más tarde." });
  }
});

