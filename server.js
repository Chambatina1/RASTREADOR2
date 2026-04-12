import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";

// ------------------------------
// Configuración del servidor
// ------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "2mb" }));

// ------------------------------
// Contexto de negocio para el chat
// ------------------------------
const BUSINESS_CONTEXT = `
- Precio por libra: 1.99 más 10 dólares por manejo, seguro, arancel y transporte.
- Si recogemos en la puerta de su casa: 2.30 por libra.
- Si compran por nuestros links de TikTok: 1.80 por libra.
- Tiempo de entrega: 18 a 30 días hábiles.

CAJAS
- 12x12x12 hasta 60 libras: 45 dólares.
- 15x15x15 hasta 100 libras: 65 dólares.
- 16x16x16 hasta 100 libras: 85 dólares.

CARGOS Y MANEJO
- Equipos: de 15 a 35 dólares adicionales.
- Equipos de más de 200 libras: 45 dólares adicionales.
- Bicicleta niño sin empacar: 25 dólares.
- Bicicleta niño empacada: 15 dólares.
- Bicicleta adulto sin empacar: 45 dólares.
- Bicicleta adulto empacada: 25 dólares.
- Bicicleta eléctrica en caja: 35 dólares.
- Bicicleta eléctrica sin caja: 50 dólares.
- Colchones hasta 50 lb: 15 dólares.
- Colchones de más de 50 lb: 40 dólares total.
- Ollas pequeñas: 12 dólares.
- Olla arrocera o multifuncional: 22 dólares.
- Manejo general: 25 dólares.
- Equipos con retractilado empacados: 35 dólares.
- Equipos con retractilado sin empacar: 50 dólares.
- Retractilado externo: cargo variable.

EQUIPOS DISPONIBLES EN OFICINA
INVERSORES
- 6.5 kW: costo equipo 988, envío 145, total 1133.
- 10 kW: costo equipo 1254, envío 178, total 1432.
- 12 kW: costo equipo 2146, envío 257, total 2403.

BATERÍAS
- 5 kilos, aproximadamente 5 kWh: costo equipo 886, envío 352, total 1238.
- 10 kilos, aproximadamente 10 kWh: costo equipo 1651, envío 536, total 2187.
- 16 kilos, aproximadamente 16 kWh: costo equipo 1825, envío 696, total 2521.

OFICINA
- Dirección: 7523 Aloma Ave, Winter Park, FL 32792, Suite 112.
- Teléfono Geo Adriana: 786-942-6904.
- Teléfono adicional: 786-784-6421.

PROCESO DE COMPRA
- El cliente compra el producto.
- Luego lo envía a la dirección de Chambatina.
- En TikTok la dirección debe ponerse completa manualmente.
- Es importante escribir "7523 Aloma Ave" correctamente.
- A veces TikTok sugiere automáticamente "Aloma Pine", pero eso no es correcto.
- Debe usarse "Aloma Ave" e incluir Suite 112.

COMPORTAMIENTO DEL ASISTENTE
- Responde siempre en español claro, profesional, útil y directo.
- No inventes precios, políticas ni disponibilidad.
- No hables de backend, claves, configuración interna ni detalles técnicos.
- Si no sabe algo con certeza, debe decirlo.
- Si preguntan por precios, responde con cifras concretas.
- Si preguntan por equipos disponibles, menciona primero los inversores y baterías de oficina.
- Si preguntan por la oficina, da dirección y teléfonos.
- Si preguntan cómo funciona TikTok o Amazon, explica el proceso.
- Si preguntan por rastreo específico, indica que usen el CPK.
- Si preguntan por tiempo de entrega, responde: 18 a 30 días hábiles.
- Mantén tono serio, comercial y ordenado.
`;

// ------------------------------
// Bases de datos manuales (respaldo)
// ------------------------------
const RAW_TRACKING_SOURCE = `
CPK-0260443 - EN AGENCIA - 2025-02-10 - En espera de recogida en Miami
CPK-0382912 - EN DISTRIBUCION - 2025-02-12
CPK-0456789 - ENTREGADO - 2025-02-15 - Firmado por cliente
CPK-0123456 - EN ALMACÉN - 2025-02-09
CPK-0998877 - DESPACHO - 2025-02-11 - En ruta hacia destino
CPK-0543210 - CANAL ROJO - 2025-02-13 - Requiere verificación aduanal
`;

const CPK_DB = {
  "0260443": { estado: "ENTREGADO", fecha: "2025-02-14", descripcion: "Entregado al cliente en domicilio" },
  "0998877": { estado: "EN ALMACEN", fecha: "2025-02-10", descripcion: "Retenido por falta de documentos" }
};

// Funciones de parseo (idénticas a las que ya tenías)
function generateDescriptionByState(estado) {
  const estadoUpper = estado.toUpperCase();
  if (estadoUpper.includes("ENTREGADO")) return "Paquete entregado al destinatario.";
  if (estadoUpper.includes("EN AGENCIA")) return "Paquete disponible en la agencia para recoger.";
  if (estadoUpper.includes("EN DISTRIBUCION") || estadoUpper.includes("EN DISTRIBUCIÓN")) return "Paquete en proceso de distribución local.";
  if (estadoUpper.includes("EN ALMACEN") || estadoUpper.includes("EN ALMACÉN")) return "Paquete almacenado en nuestro centro logístico.";
  if (estadoUpper.includes("DESPACHO")) return "Paquete despachado desde origen.";
  if (estadoUpper.includes("CLASIFICADO")) return "Paquete clasificado en centro de procesamiento.";
  if (estadoUpper.includes("ARRIBO")) return "Paquete ha llegado a destino intermedio.";
  if (estadoUpper.includes("CANAL ROJO")) return "Paquete retenido por control aduanero. Requiere gestión adicional.";
  return "En tránsito – sin novedad.";
}

function parseRawTracking(source) {
  const lines = source.split(/\r?\n/);
  const parsed = {};
  const estadoKeywords = [
    "ENTREGADO", "EN AGENCIA", "EN DISTRIBUCION", "EN DISTRIBUCIÓN",
    "EN ALMACEN", "EN ALMACÉN", "DESPACHO", "CLASIFICADO", "ARRIBO", "CANAL ROJO"
  ];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cpkMatch = line.match(/CPK-(\d+)/i);
    if (!cpkMatch) continue;
    const cpkNum = cpkMatch[1];
    let estado = null;
    for (const kw of estadoKeywords) {
      if (line.toUpperCase().includes(kw)) {
        estado = kw;
        break;
      }
    }
    if (!estado) estado = "EN PROCESO";
    let fecha = null;
    const fechaMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (fechaMatch) fecha = fechaMatch[1];
    let descripcion = "";
    const afterDate = fecha ? line.split(fecha)[1] : line;
    const descMatch = afterDate.match(/-\s*(.+)$/);
    if (descMatch && descMatch[1].trim().length > 0) {
      descripcion = descMatch[1].trim();
    } else {
      descripcion = generateDescriptionByState(estado);
    }
    if (!parsed[cpkNum]) {
      parsed[cpkNum] = { estado, fecha, descripcion };
    }
  }
  return parsed;
}

function buildActiveTrackingDB() {
  const fromRaw = parseRawTracking(RAW_TRACKING_SOURCE);
  const active = { ...fromRaw };
  for (const [key, value] of Object.entries(CPK_DB)) {
    let cpkNum = key.replace(/^CPK-/i, "");
    if (!cpkNum.match(/^\d+$/)) cpkNum = key;
    let estado, fecha, descripcion;
    if (typeof value === "object" && value !== null) {
      estado = value.estado || "SIN ESTADO";
      fecha = value.fecha || null;
      descripcion = value.descripcion || generateDescriptionByState(estado);
    } else {
      estado = String(value);
      fecha = null;
      descripcion = generateDescriptionByState(estado);
    }
    active[cpkNum] = { estado, fecha, descripcion };
  }
  return active;
}

const ACTIVE_TRACKING_DB = buildActiveTrackingDB();

// ------------------------------
// Caché para consultas en tiempo real
// ------------------------------
const cache = new Map(); // clave: cpk, valor: { data, timestamp }
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

// ------------------------------
// Función que consulta solvedc.com con Puppeteer
// ------------------------------
async function consultarCPKEnTiempoReal(cpk) {
  console.log(`🔍 Consultando CPK ${cpk} en solvedc.com con Puppeteer...`);
  let browser = null;
  try {
    // Lanzar navegador (en Render necesitas configurar Chromium)
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // 1. Ir al login
    await page.goto('https://www.solvedc.com/cargo/cargopack/v1/', { waitUntil: 'networkidle2', timeout: 30000 });

    // 2. Hacer login (selectores según la página actual)
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', 'GEO MIA');
    await page.type('input[name="password"]', 'GEO**091223');
    await page.click('input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // 3. Esperar que cargue la interfaz y buscar campo de CPK
    await page.waitForTimeout(3000); // espera adicional
    const selectores = [
      'input[name="cpk"]', 'input[name="hbl"]', 'input[name="codigo"]',
      'input[placeholder*="CPK"]', 'input[placeholder*="HBL"]',
      '#cpk', '#hbl', '#codigo', 'input[type="search"]'
    ];
    let inputCpk = null;
    for (const sel of selectores) {
      inputCpk = await page.$(sel);
      if (inputCpk) break;
    }
    if (!inputCpk) {
      throw new Error('No se encontró el campo de entrada del CPK');
    }

    // 4. Escribir el CPK y enviar búsqueda
    await inputCpk.type(cpk);
    const botonBuscar = await page.$('button[type="submit"], input[type="submit"], .btn-buscar');
    if (botonBuscar) {
      await botonBuscar.click();
    } else {
      await page.keyboard.press('Enter');
    }

    // 5. Esperar la respuesta (ajustar según la interfaz)
    await page.waitForTimeout(5000);

    // 6. Extraer información de la página (aquí debes adaptar los selectores según la estructura real)
    // Esto es un ejemplo genérico: busca elementos que contengan estado, fecha, descripción
    let estado = 'DESCONOCIDO';
    let fecha = null;
    let descripcion = '';

    // Intenta obtener el estado desde algún texto visible (ej: "Estado: ENTREGADO")
    const estadoElement = await page.$('.estado, .status, [class*="estado"], [class*="status"]');
    if (estadoElement) {
      estado = await page.evaluate(el => el.innerText, estadoElement);
    } else {
      // Busca en toda la página palabras clave de estado
      const pageText = await page.evaluate(() => document.body.innerText);
      const keywords = ['ENTREGADO', 'EN AGENCIA', 'EN DISTRIBUCION', 'EN ALMACEN', 'DESPACHO', 'CANAL ROJO'];
      for (const kw of keywords) {
        if (pageText.toUpperCase().includes(kw)) {
          estado = kw;
          break;
        }
      }
    }

    // Extraer fecha (buscar formato YYYY-MM-DD)
    const fechaMatch = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      return match ? match[1] : null;
    });
    fecha = fechaMatch;

    // Descripción (puede ser un texto adicional)
    descripcion = `Información obtenida de solvedc.com para CPK ${cpk}. Estado: ${estado}`;

    await browser.close();
    return { estado, fecha, descripcion, fuente: 'tiempo_real' };
  } catch (error) {
    console.error(`Error consultando CPK ${cpk} en tiempo real:`, error);
    if (browser) await browser.close();
    return null;
  }
}

// ------------------------------
// Ruta /api/rastreo (con caché y respaldo manual + tiempo real)
// ------------------------------
app.get("/api/rastreo/:cpk", async (req, res) => {
  let cpkParam = req.params.cpk;
  let cpkNum = cpkParam.replace(/^CPK-/i, "");
  
  // 1. Buscar en base manual (rápido)
  let trackingInfo = ACTIVE_TRACKING_DB[cpkNum];
  if (trackingInfo) {
    return res.json({
      ok: true,
      cpk: `CPK-${cpkNum}`,
      fecha: trackingInfo.fecha || null,
      estado: trackingInfo.estado,
      descripcion: trackingInfo.descripcion,
      fuente: 'manual'
    });
  }

  // 2. Verificar caché
  const cached = cache.get(cpkNum);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return res.json({
      ok: true,
      cpk: `CPK-${cpkNum}`,
      fecha: cached.data.fecha,
      estado: cached.data.estado,
      descripcion: cached.data.descripcion,
      fuente: 'cache'
    });
  }

  // 3. Consultar en tiempo real con Puppeteer
  const realData = await consultarCPKEnTiempoReal(cpkNum);
  if (realData) {
    // Guardar en caché
    cache.set(cpkNum, { data: realData, timestamp: Date.now() });
    return res.json({
      ok: true,
      cpk: `CPK-${cpkNum}`,
      fecha: realData.fecha,
      estado: realData.estado,
      descripcion: realData.descripcion,
      fuente: 'tiempo_real'
    });
  }

  // 4. No encontrado por ningún medio
  res.status(404).json({
    ok: false,
    mensaje: "No se encontró el CPK en la base manual ni en el sistema de solvedc.com"
  });
});

// ------------------------------
// Ruta /api/health (sin cambios)
// ------------------------------
app.get("/api/health", (req, res) => {
  const countManual = Object.keys(CPK_DB).length;
  const countParsed = Object.keys(parseRawTracking(RAW_TRACKING_SOURCE)).length;
  const totalActive = Object.keys(ACTIVE_TRACKING_DB).length;
  res.json({
    ok: true,
    cantidad_registros_manuales: countManual,
    cantidad_registros_parseados: countParsed,
    cantidad_total_activa: totalActive,
    modo_tiempo_real: "activado (Puppeteer)"
  });
});

// ------------------------------
// Ruta /api/chat (sin cambios)
// ------------------------------
app.post("/api/chat", async (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje || typeof mensaje !== "string") {
    return res.status(400).json({ ok: false, mensaje: "El campo 'mensaje' es requerido y debe ser texto." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, mensaje: "Error de configuración del servidor: falta la clave de OpenAI." });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Eres un asistente de atención al cliente para una empresa de logística y envíos. Sigue estrictamente estas instrucciones:\n${BUSINESS_CONTEXT}` },
          { role: "user", content: mensaje }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Error de OpenAI:", errorData);
      return res.status(500).json({ ok: false, mensaje: "Error al comunicarse con OpenAI." });
    }

    const data = await response.json();
    const respuesta = data.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
    res.json({ ok: true, respuesta });
  } catch (error) {
    console.error("Excepción en /api/chat:", error);
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor." });
  }
});

// 404 final
app.use((req, res) => {
  res.status(404).json({ ok: false, mensaje: "Ruta no encontrada" });
});

// ------------------------------
// Arranque del servidor
// ------------------------------
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
