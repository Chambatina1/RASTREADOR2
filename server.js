import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "2mb" }));

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

app.get("/api/health", (req, res) => {
  const countManual = Object.keys(CPK_DB).length;
  const countParsed = Object.keys(parseRawTracking(RAW_TRACKING_SOURCE)).length;
  const totalActive = Object.keys(ACTIVE_TRACKING_DB).length;
  res.json({
    ok: true,
    cantidad_registros_manuales: countManual,
    cantidad_registros_parseados: countParsed,
    cantidad_total_activa: totalActive
  });
});

app.get("/api/rastreo/:cpk", (req, res) => {
  let cpkNum = req.params.cpk.replace(/^CPK-/i, "");
  const trackingInfo = ACTIVE_TRACKING_DB[cpkNum];
  if (trackingInfo) {
    res.json({
      ok: true,
      cpk: `CPK-${cpkNum}`,
      fecha: trackingInfo.fecha || null,
      estado: trackingInfo.estado,
      descripcion: trackingInfo.descripcion
    });
  } else {
    res.status(404).json({
      ok: false,
      mensaje: "No se encontró el CPK"
    });
  }
});

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
      throw new Error("Error de OpenAI");
    }
    const data = await response.json();
    const respuesta = data.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
    res.json({ ok: true, respuesta });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor." });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, mensaje: "Ruta no encontrada" });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
