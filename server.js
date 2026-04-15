import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-session-id"] }));
app.use(express.json({ limit: "2mb" }));

// ================= CONTEXTO DEL CHAT (mejorado con tono amigable) =================
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

// ================= BASE DE DATOS LOCAL (SOLO EJEMPLOS REPRESENTATIVOS) =================
// He reducido a 5 registros típicos: entregado, en agencia, embarcado, en distribución, en almacén.
// Conserva la estructura que usas en tu código (cpk, fecha, estado, descripcion, embarcador).
const TRACKING_DB = {
  "0255139": {
    cpk: "0255139",
    fecha: "2026-03-09",
    estado: "ENTREGADO",
    descripcion: "Miscelánea - Entregado a ELSA BARRIOS",
    embarcador: "ELSA BARRIOS",
    consignatario: ""
  },
  "0266860": {
    cpk: "0266860",
    fecha: "2026-04-14",
    estado: "EN AGENCIA",
    descripcion: "Generador eléctrico 2400W - En agencia de origen",
    embarcador: "JULIO SÁNCHEZ HERNANDEZ",
    consignatario: ""
  },
  "0265027": {
    cpk: "0265027",
    fecha: "2026-04-09",
    estado: "EMBARCADO",
    descripcion: "Misceláneas - En contenedor rumbo a Cuba",
    embarcador: "TAMARA CABEZA MUNOZ",
    consignatario: ""
  },
  "0260199": {
    cpk: "0260199",
    fecha: "2026-03-25",
    estado: "EN TRANSITO SANTIAGO DE CUBA",
    descripcion: "Batería 51V 100Ah - En tránsito hacia provincia",
    embarcador: "ROBERTO PACHECO RAMIREZ",
    consignatario: ""
  },
  "0259420": {
    cpk: "0259420",
    fecha: "2026-03-23",
    estado: "EN ALMACEN CAMAGUEY",
    descripcion: "Colchón - Almacén local en Camagüey",
    embarcador: "ROSABEL SALAZAR BARRERAS",
    consignatario: ""
  }
};

// ================= UTILIDADES =================
function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }
function primerNombre(nombre) { return String(nombre || "").trim().split(/\s+/)[0] || ""; }

function construirSaludo(embarcador, estado) {
  const nombre = primerNombre(embarcador);
  if (nombre) return `📦 Hola ${nombre}, tu paquete está en: *${estado}*.`;
  return `📦 Hola, tu paquete está en: *${estado}*.`;
}

// ================= MEMORIA POR SESIÓN (para recordar último CPK) =================
const MEMORIA = new Map();
function getSessionKey(req) { return req.headers["x-session-id"] || req.ip || "anon"; }
function getMemory(key) {
  const item = MEMORIA.get(key);
  if (!item) return {};
  if (Date.now() - (item.ts || 0) > 600000) MEMORIA.delete(key); // expira en 10min
  return item;
}
function setMemory(key, patch) {
  const prev = getMemory(key);
  MEMORIA.set(key, { ...prev, ...patch, ts: Date.now() });
}

// ================= DETECCIÓN DE INTENCIONES (mejorada con más sinónimos) =================
function detectarPeso(texto) {
  const m = String(texto).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(lb|libras?|lbs?)/);
  return m ? Number(m[1]) : null;
}
function detectarIntencion(texto) {
  const t = String(texto).toLowerCase();
  const cpk = soloDigitos(t);
  if (cpk && cpk.length >= 6) return { intent: "rastreo", cpk };
  if (/(bicicleta|bici|bike)/.test(t)) return { intent: "bicicleta", tipo: "bicicleta" };
  if (/(ecoflow|delta|river|powerstation)/.test(t)) return { intent: "ecoflow" };
  if (/(precio|costo|calcular|envío|cuánto cuesta)/.test(t) && detectarPeso(t)) return { intent: "calculo", peso: detectarPeso(t) };
  if (/(dirección|oficina|dónde está|ubicación|aloma)/.test(t)) return { intent: "direccion" };
  if (/(tiempo|demora|tarda|días|entrega)/.test(t)) return { intent: "tiempo" };
  if (/(caja|cartón|dimensiones|12x12|15x15|16x16)/.test(t)) return { intent: "cajas" };
  if (/(gracias|ok|vale|entendido)/.test(t)) return { intent: "agradecimiento" };
  return { intent: "chat" };
}

// ================= CÁLCULOS =================
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

// ================= RASTREO MEJORADO (con mensaje más cálido) =================
function obtenerTracking(cpk) {
  return TRACKING_DB[cpk] || null;
}

// ================= ENDPOINTS =================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, totalCPK: Object.keys(TRACKING_DB).length, mensaje: "Servidor activo y amigable 🚀" });
});

app.get("/api/rastreo/:cpk", (req, res) => {
  const cpk = soloDigitos(req.params.cpk);
  const item = obtenerTracking(cpk);
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
  const item = obtenerTracking(term);
  if (item) return res.json({ ok: true, tipo: "cpk", ...item, mensaje: construirSaludo(item.embarcador, item.estado) });
  // Fallback a Kanguro (opcional, mantener)
  try {
    const resp = await axios.post("https://www.solvedc.com/tracking/kanguro/", new URLSearchParams({ ci: term, hbl: "" }), { timeout: 10000 });
    const $ = cheerio.load(resp.data);
    const row = $("table tr").eq(1);
    const tds = row.find("td");
    if (tds.length) {
      return res.json({ ok: true, tipo: "kanguro", cpk: tds.eq(1).text(), estado: tds.eq(2).text(), fecha: tds.eq(3).text() });
    }
  } catch (e) {}
  res.status(404).json({ ok: false, mensaje: `No se encontró el CPK ${term} en nuestra base ni en Kanguro. ¿Quieres que lo busque manualmente? Escríbeme "ayuda".` });
});

app.post("/api/chat", async (req, res) => {
  const mensaje = String(req.body.mensaje || "").trim();
  if (!mensaje) return res.status(400).json({ ok: false, respuesta: "Por favor escribe algo. Por ejemplo: 'rastreo 0255139' o 'precio 10 lb'." });

  const session = getSessionKey(req);
  const mem = getMemory(session);
  const intent = detectarIntencion(mensaje);

  // --- Rastreo por CPK ---
  if (intent.intent === "rastreo") {
    const item = obtenerTracking(intent.cpk);
    if (!item) {
      return res.json({ ok: false, respuesta: `❌ No encuentro el CPK ${intent.cpk}. ¿Estás seguro del número? Revisa tu recibo o prueba con otro.` });
    }
    setMemory(session, { lastCPK: intent.cpk });
    const saludo = construirSaludo(item.embarcador, item.estado);
    const info = `📅 Fecha: ${item.fecha}\n📦 Producto: ${item.descripcion}`;
    return res.json({ ok: true, respuesta: `${saludo}\n${info}\n\n¿Necesitas rastrear otro paquete? Envíame otro CPK.` });
  }

  // --- Cálculo de envío por peso ---
  if (intent.intent === "calculo") {
    const respuesta = calcularEnvio(intent.peso);
    setMemory(session, { lastWeight: intent.peso });
    return res.json({ ok: true, respuesta });
  }

  // --- EcoFlow ---
  if (intent.intent === "ecoflow") {
    const peso = intent.peso || mem.lastWeight;
    return res.json({ ok: true, respuesta: responderEcoflow(peso) });
  }

  // --- Bicicleta ---
  if (intent.intent === "bicicleta") {
    return res.json({ ok: true, respuesta: responderBicicleta() });
  }

  // --- Dirección ---
  if (intent.intent === "direccion") {
    return res.json({ ok: true, respuesta: responderDireccion() });
  }

  // --- Tiempos ---
  if (intent.intent === "tiempo") {
    return res.json({ ok: true, respuesta: responderTiempo() });
  }

  // --- Cajas ---
  if (intent.intent === "cajas") {
    return res.json({ ok: true, respuesta: responderCajas() });
  }

  // --- Agradecimiento ---
  if (intent.intent === "agradecimiento") {
    return res.json({ ok: true, respuesta: responderAgradecimiento() });
  }

  // --- Ayuda general (si el usuario escribe "ayuda" o no detectamos nada) ---
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

  // --- OpenAI como fallback (si hay API key) ---
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

// ================= INICIO =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor Chambatina corriendo en puerto ${PORT}`));
