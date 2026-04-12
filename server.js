import express from "express";
import cors from "cors";
import { consultarPorCPK, consultarPorCarnet, closeBrowser } from './cargoPackScraper.js';

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-session-id"]
}));

app.use(express.json({ limit: "2mb" }));

// ================= CONTEXTO DEL CHAT =================
const BUSINESS_CONTEXT = `
========================================
ASISTENTE OFICIAL CHAMBATINA
========================================

Responde siempre en español claro, directo y profesional.
No inventes precios ni condiciones.
Si no sabes algo con certeza, dilo claramente.

IDENTIDAD
Chambatina es una empresa logística especializada en envíos a Cuba
y en la orientación sobre equipos de energía renovable, especialmente sistemas solares.

El nombre proviene de los abuelos del fundador Geo Cabezas:
- Manuel Muñoz (Chamba)
- Agustina (Tina)

LIDERAZGO DIGITAL
Geo y Lili, conocidos en TikTok, forman parte del equipo que impulsa
el crecimiento y la orientación comercial de Chambatina.

SERVICIOS
- Envíos a Cuba
- Orientación sobre compras (Amazon, TikTok, etc.)
- Asesoría en sistemas solares
- Seguimiento de paquetes (CPK)

PRECIOS BASE
- Precio por libra: $1.99
- Cargo por equipo: $25
- Recogida en casa: $2.30 por libra
- Compras por links de TikTok: $1.80 por libra

IMPORTANTE:
El cálculo general de equipo es:
(Peso × 1.99) + 25

CARGOS ESPECIALES
... (mantén el resto de tu contexto igual) ...
`;

// ================= UTILIDADES =================
function limpiarNumero(texto = "") {
  return String(texto).replace(/\D/g, "");
}

function normalizarCPK(texto = "") {
  return limpiarNumero(texto);
}

function parseFechaSegura(fechaTexto = "") {
  if (!fechaTexto) return null;
  const d = new Date(fechaTexto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapearEstadoTexto(estado = "") {
  const e = String(estado || "").toUpperCase();
  if (e.includes("ENTREGADO")) return "ENTREGADO";
  if (e.includes("DISTRIBUC")) return "EN DISTRIBUCION";
  if (e.includes("DESPACH")) return "DESPACHADO";
  if (e.includes("EMBARC")) return "EMBARCADO";
  if (e.includes("ARRIBO")) return "ARRIBO";
  if (e.includes("CLASIFIC")) return "CLASIFICADO";
  if (e.includes("AGENCIA")) return "EN AGENCIA";
  if (e.includes("ADUANA")) return "ADUANA";
  return "";
}

function estadoPorTiempo(fechaTexto = "") {
  if (!fechaTexto) return "SIN ESTADO";
  const fecha = parseFechaSegura(fechaTexto);
  if (!fecha) return "SIN ESTADO";
  const dias = Math.floor((Date.now() - fecha.getTime()) / (1000 * 60 * 60 * 24));
  if (dias >= 30) return "ENTREGADO";
  if (dias >= 20) return "EN DISTRIBUCION";
  if (dias >= 14) return "DESPACHADO";
  if (dias >= 7) return "EMBARCADO";
  return "EN AGENCIA";
}

function construirSaludo(embarcador = "", consignatario = "", estado = "") {
  if (embarcador) {
    return `Hola ${embarcador}, tu mercancía se encuentra en: ${estado || "SIN ESTADO"}.`;
  }
  return `Hola, tu mercancía se encuentra en: ${estado || "SIN ESTADO"}.`;
}

// ================= MEMORIA TEMPORAL =================
const MEMORIA = new Map();

function getSessionKey(req) {
  return String(req.headers["x-session-id"] || req.ip || "anon");
}

function getMemory(key) {
  const item = MEMORIA.get(key);
  if (!item) return {};
  if (Date.now() - (item.ts || 0) > 10 * 60 * 1000) {
    MEMORIA.delete(key);
    return {};
  }
  return item;
}

function setMemory(key, patch) {
  const prev = getMemory(key);
  MEMORIA.set(key, { ...prev, ...patch, ts: Date.now() });
}

// ================= DETECCIÓN DE INTENCIÓN =================
function detectarPeso(texto) {
  const t = String(texto || "").toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(lb|libras?)/i) || t.match(/peso\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

function detectarTipoBicicleta(texto) {
  const t = String(texto || "").toLowerCase();
  if (!t.includes("bicic")) return null;
  const esElectrica = /el[eé]ctrica/.test(t);
  const esNino = /niñ|nino/.test(t);
  const empacada = /empacad|en caja|caja/.test(t);
  const sinEmpacar = /sin empacar|sin caja/.test(t);
  if (esElectrica) return sinEmpacar ? "bicicleta_electrica_sin_caja" : "bicicleta_electrica_en_caja";
  if (esNino) return empacada ? "bicicleta_nino_empacada" : "bicicleta_nino_sin_empacar";
  return empacada ? "bicicleta_adulto_empacada" : "bicicleta_adulto_sin_empacar";
}

function detectarEcoflow(texto) {
  const t = String(texto || "").toLowerCase();
  if (!/(eco ?flow|delta pro|delta 2|delta|river)/i.test(t)) return null;
  if (/delta pro ultra/i.test(t)) return "EcoFlow Delta Pro Ultra";
  if (/delta pro/i.test(t)) return "EcoFlow Delta Pro";
  if (/delta 2/i.test(t)) return "EcoFlow Delta 2";
  if (/river 2 pro/i.test(t)) return "EcoFlow River 2 Pro";
  if (/river/i.test(t)) return "EcoFlow River";
  return "EcoFlow";
}

function detectarIntencion(texto) {
  const t = String(texto || "").toLowerCase();
  const peso = detectarPeso(t);
  const cpkNormalizado = normalizarCPK(t);
  const bicicleta = detectarTipoBicicleta(t);
  const ecoflow = detectarEcoflow(t);

  const esCPK = !!cpkNormalizado;
  const esSolar = /(inversor|bater[ií]a|panel|solar|kwh|kw|generador)/i.test(t);
  const esCaja = /(caja 12x12|caja 15x15|caja 16x16|cajas)/i.test(t);
  const esDireccion = /(direcci[oó]n|oficina|suite 112|aloma)/i.test(t);
  const esTiempo = /(tiempo|demora|cu[aá]nto tarda|entrega)/i.test(t);
  const esCalculo = !!peso || /cu[aá]nto cuesta \d+/i.test(t) || /(\d+(?:\.\d+)?)\s*(lb|libras?)/i.test(t);

  if (esCPK) return { intent: "rastreo", peso, cpk: cpkNormalizado };
  if (bicicleta) return { intent: "bicicleta", bicicleta, peso };
  if (ecoflow && peso) return { intent: "ecoflow_calculo", ecoflow, peso };
  if (ecoflow) return { intent: "ecoflow", ecoflow, peso };
  if (esCalculo && esSolar) return { intent: "calculo_producto", peso };
  if (esCalculo) return { intent: "calculo", peso };
  if (esSolar) return { intent: "solar", peso };
  if (esCaja) return { intent: "cajas" };
  if (esDireccion) return { intent: "direccion" };
  if (esTiempo) return { intent: "tiempo" };
  return { intent: "chat", peso };
}

// ================= CÁLCULOS =================
function calcularEnvioGeneral(peso) {
  const base = Number((peso * 1.99).toFixed(2));
  const total = Number((base + 25).toFixed(2));
  return { tipo: "equipo", peso, base, cargoEquipo: 25, total, texto: `${peso} × 1.99 = ${base.toFixed(2)}\n+ 25 = ${total.toFixed(2)}\n\nTotal: $${total.toFixed(2)}` };
}

function calcularBicicleta(tipo) {
  const tabla = {
    bicicleta_nino_sin_empacar: { nombre: "Bicicleta de niño sin empacar", total: 25 },
    bicicleta_nino_empacada: { nombre: "Bicicleta de niño empacada", total: 15 },
    bicicleta_adulto_sin_empacar: { nombre: "Bicicleta de adulto sin empacar", total: 45 },
    bicicleta_adulto_empacada: { nombre: "Bicicleta de adulto empacada", total: 25 },
    bicicleta_electrica_en_caja: { nombre: "Bicicleta eléctrica en caja", total: 35 },
    bicicleta_electrica_sin_caja: { nombre: "Bicicleta eléctrica sin caja", total: 50 }
  };
  return tabla[tipo] || null;
}

function responderEcoflow(nombreProducto, peso = null) {
  const intro = `${nombreProducto || "EcoFlow"} es un sistema de energía portátil y solar que puede servir para respaldo eléctrico, refrigeradores, ventiladores, luces y otros equipos del hogar.`;
  if (!peso) return intro + `\n\nSi me dice el peso en libras, le calculo el envío exacto.`;
  const calc = calcularEnvioGeneral(peso);
  return intro + `\n\nCálculo de envío:\n${calc.texto}`;
}

// ================= HEALTH =================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, mensaje: "Servidor activo con conexión a CargoPack" });
});

// ================= RASTREO POR CPK (real) =================
app.get("/api/rastreo/:cpk", async (req, res) => {
  try {
    const cpk = normalizarCPK(req.params.cpk);
    if (!cpk) return res.json({ ok: false, mensaje: "CPK inválido" });

    const data = await consultarPorCPK(cpk);
    if (!data) return res.json({ ok: false, mensaje: "No encontramos información para ese CPK." });

    return res.json({
      ok: true,
      cpk: data.cpk,
      fecha: data.fecha,
      estado: data.estado,
      descripcion: data.descripcion,
      embarcador: data.nombre,
      consignatario: "",
      saludo: construirSaludo(data.nombre, "", data.estado)
    });
  } catch (error) {
    console.error("Error en /api/rastreo/:cpk:", error);
    return res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// ================= BUSCAR POR CARNET (real) =================
app.get("/api/buscar-carnet", async (req, res) => {
  try {
    const carnetRaw = String(req.query.carnet || '').trim();
    const carnet = carnetRaw.replace(/\D/g, '');
    if (!carnet || carnet.length !== 11) {
      return res.status(400).json({ ok: false, message: "Carnet inválido (debe tener 11 dígitos)", results: [] });
    }

    const resultados = await consultarPorCarnet(carnet);
    if (!resultados.length) {
      return res.status(404).json({ ok: false, message: "No se encontraron envíos para ese carnet", results: [] });
    }

    return res.json({
      ok: true,
      source: "cargopack",
      total: resultados.length,
      results: resultados.map(item => ({
        nombre: item.nombre,
        carnet: item.carnet,
        cpk: item.cpk,
        estado: item.estado,
        fecha: item.fecha,
        descripcion: item.descripcion
      }))
    });
  } catch (error) {
    console.error("Error en /api/buscar-carnet:", error);
    return res.status(500).json({ ok: false, message: "Error interno del servidor", results: [] });
  }
});

// ================= CHAT (con las mismas capacidades, pero sin cambios en la lógica de negocio) =================
app.post("/api/chat", async (req, res) => {
  try {
    const mensaje = String(req.body?.mensaje || "").trim();
    if (!mensaje) return res.status(400).json({ ok: false, mensaje: "Falta mensaje" });

    const sessionKey = getSessionKey(req);
    const mem = getMemory(sessionKey);
    const info = detectarIntencion(mensaje);

    // Rastreo por CPK (usando scraper)
    if (info.intent === "rastreo" && info.cpk) {
      const data = await consultarPorCPK(info.cpk);
      if (!data) return res.json({ ok: false, mensaje: "No encontramos información para ese CPK." });
      setMemory(sessionKey, { lastIntent: "rastreo", lastCPK: info.cpk });
      return res.json({
        ok: true,
        respuesta: `${construirSaludo(data.nombre, "", data.estado)}\n\nFecha: ${data.fecha || "No disponible"}\n\nDescripción:\n${data.descripcion || "Sin descripción"}`
      });
    }

    // Cálculo de envío general
    if (info.intent === "calculo" && info.peso) {
      const r = calcularEnvioGeneral(info.peso);
      setMemory(sessionKey, { lastIntent: "calculo", lastWeight: info.peso });
      return res.json({ ok: true, respuesta: r.texto });
    }

    // EcoFlow
    if (info.intent === "ecoflow_calculo" && info.peso) {
      const respuesta = responderEcoflow(info.ecoflow, info.peso);
      setMemory(sessionKey, { lastIntent: "ecoflow", lastWeight: info.peso, lastProduct: info.ecoflow });
      return res.json({ ok: true, respuesta });
    }
    if (info.intent === "ecoflow") {
      const pesoMem = info.peso || mem.lastWeight || null;
      setMemory(sessionKey, { lastIntent: "ecoflow", lastWeight: pesoMem, lastProduct: info.ecoflow });
      return res.json({ ok: true, respuesta: responderEcoflow(info.ecoflow, pesoMem) });
    }

    // Bicicleta
    if (info.intent === "bicicleta") {
      const bici = calcularBicicleta(info.bicicleta);
      if (!bici) return res.json({ ok: false, mensaje: "No pude identificar el tipo de bicicleta." });
      setMemory(sessionKey, { lastIntent: "bicicleta", lastProduct: bici.nombre });
      return res.json({ ok: true, respuesta: `${bici.nombre}: $${bici.total.toFixed(2)}` });
    }

    // Dirección, tiempo, cajas
    if (info.intent === "direccion") return res.json({ ok: true, respuesta: "La oficina está en 7523 Aloma Ave, Winter Park, FL 32792, Suite 112." });
    if (info.intent === "tiempo") return res.json({ ok: true, respuesta: "El tiempo estimado es aproximadamente de 18 a 30 días una vez que toca puerto." });
    if (info.intent === "cajas") return res.json({ ok: true, respuesta: "Cajas: 12x12x12 hasta 60 lb: $45\n15x15x15 hasta 100 lb: $65\n16x16x16 hasta 100 lb: $85" });

    // Continuar cálculo
    if (!info.peso && mem.lastIntent === "calculo" && /(y con eso|cu[aá]nto ser[ií]a|el total|entonces)/i.test(mensaje)) {
      const r = calcularEnvioGeneral(mem.lastWeight);
      return res.json({ ok: true, respuesta: r.texto });
    }

    // Si no hay OpenAI key, responder con mensaje por defecto
    if (!process.env.OPENAI_API_KEY) {
      return res.json({ ok: true, respuesta: "Lo siento, no puedo responder preguntas generales en este momento. Por favor, escribe un CPK, un carnet o una pregunta sobre precios y servicios." });
    }

    // Consulta a OpenAI (mantén tu lógica original con fetch)
    const promptExtra = [];
    if (mem.lastProduct) promptExtra.push(`Último producto consultado: ${mem.lastProduct}`);
    if (mem.lastWeight) promptExtra.push(`Último peso consultado: ${mem.lastWeight} lb`);
    if (mem.lastCPK) promptExtra.push(`Último CPK consultado: ${mem.lastCPK}`);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: BUSINESS_CONTEXT },
          ...(promptExtra.length ? [{ role: "system", content: promptExtra.join("\n") }] : []),
          { role: "user", content: mensaje }
        ],
        temperature: 0.25
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Error OpenAI:", data);
      return res.status(500).json({ ok: false, mensaje: data?.error?.message || "Error al consultar OpenAI" });
    }
    setMemory(sessionKey, { lastIntent: "chat" });
    return res.json({ ok: true, respuesta: data?.choices?.[0]?.message?.content || "Sin respuesta" });
  } catch (error) {
    console.error("Error en /api/chat:", error);
    return res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});

// ================= 404 =================
app.use((req, res) => {
  res.status(404).json({ ok: false, mensaje: "Ruta no encontrada" });
});

// ================= CIERRE GRACIOSO =================
process.on('SIGTERM', async () => {
  console.log('Cerrando navegador...');
  await closeBrowser();
  process.exit(0);
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
