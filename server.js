const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const RAW_TRACKING_FILE = process.env.RAW_TRACKING_FILE || "./data/tracking_data.tsv";

let RAW_TRACKING_SOURCE = [];

/**
 * Limpia espacios, tabs dobles y valores vacíos.
 */
function cleanValue(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCPK(value) {
  const raw = cleanValue(value).toUpperCase();
  if (!raw) return "";
  const digits = onlyDigits(raw);
  if (!digits) return raw;
  return `CPK-${digits}`;
}

/**
 * Dado el formato que pegaste, estas posiciones son las más importantes.
 * Si en el futuro el orden cambia, ajustas aquí una sola vez.
 */
function rowToRecord(parts) {
  const p = parts.map(cleanValue);

  const record = {
    agencia: p[0] || "",
    usuario: p[1] || "",
    cpk: normalizeCPK(p[3] || ""),
    estado: p[4] || "",
    entregado: p[5] || "",
    referencia: p[6] || "",
    contenedor: p[7] || "",
    tipo: p[8] || "",
    descripcion: p[9] || "",
    codigoDestino: p[10] || "",
    fecha: p[11] || "",
    nombre: p[12] || "",
    carnet: onlyDigits(p[14] || ""),
    direccion: p[15] || "",
    telefono: onlyDigits(p[16] || ""),
    remitente: p[17] || "",
    observaciones: p[18] || "",
    cantidad: p[21] || "",
    peso: p[22] || "",
    volumen: p[23] || "",
    importe: p[24] || ""
  };

  record.ok = Boolean(record.cpk || record.carnet || record.nombre);
  return record;
}

/**
 * Carga archivo local tipo TSV/TXT.
 * Cada línea viene separada por tabs.
 */
function loadTrackingDataFromFile(filePath) {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    console.warn(`No existe el archivo de datos: ${abs}`);
    return [];
  }

  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw
    .split("\n")
    .map(line => line.replace(/\r/g, ""))
    .filter(line => line.trim().length > 0);

  const records = [];

  for (const line of lines) {
    const parts = line.split("\t");

    // Evita filas totalmente vacías o demasiado cortas
    if (!parts.length || parts.every(x => !cleanValue(x))) {
      continue;
    }

    const record = rowToRecord(parts);
    if (record.ok) {
      records.push(record);
    }
  }

  return records;
}

function reloadTrackingData() {
  try {
    RAW_TRACKING_SOURCE = loadTrackingDataFromFile(RAW_TRACKING_FILE);
    console.log(`Datos cargados: ${RAW_TRACKING_SOURCE.length} registros`);
  } catch (error) {
    console.error("Error cargando datos:", error.message);
    RAW_TRACKING_SOURCE = [];
  }
}

/**
 * Busca por carnet exacto.
 */
function buscarEnFuenteLocalPorCarnet(carnet) {
  const cleanCarnet = onlyDigits(carnet);
  if (!cleanCarnet) return [];

  return RAW_TRACKING_SOURCE.filter(item => item.carnet === cleanCarnet);
}

/**
 * Busca por CPK exacto.
 */
function buscarEnFuenteLocalPorCPK(cpk) {
  const cleanCPK = normalizeCPK(cpk);
  if (!cleanCPK) return null;

  return (
    RAW_TRACKING_SOURCE.find(item => normalizeCPK(item.cpk) === cleanCPK) || null
  );
}

/**
 * Convierte registro local al formato esperado por el frontend de tarjetas.
 */
function mapCarnetResult(item) {
  return {
    nombre: item.nombre || "-",
    carnet: item.carnet || "-",
    cpk: item.cpk || "-",
    estado: item.estado || "-",
    fecha: item.fecha || "-",
    descripcion: item.descripcion || "-",
    telefono: item.telefono || "-",
    direccion: item.direccion || "-",
    agencia: item.agencia || "-",
    remitente: item.remitente || "-"
  };
}

/**
 * Convierte registro local al formato esperado por la vista de rastreo.
 */
function mapCPKResult(item) {
  const estado = item.estado || "SIN ESTADO";
  const fecha = item.fecha || "No disponible";
  const descripcion = item.descripcion || "Sin descripción disponible.";

  return {
    ok: true,
    tipoBusqueda: "cpk",
    cpk: item.cpk || "",
    estado,
    fecha,
    descripcion,
    saludo: `Hola, tu mercancía se encuentra en: ${estado}.`,
    nombre: item.nombre || "",
    carnet: item.carnet || "",
    telefono: item.telefono || "",
    direccion: item.direccion || ""
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Chambatina backend",
    registros: RAW_TRACKING_SOURCE.length
  });
});

/**
 * Buscar por carnet:
 * /api/buscar-carnet?carnet=70112204811
 */
app.get("/api/buscar-carnet", (req, res) => {
  try {
    const carnet = onlyDigits(req.query.carnet || "");

    if (!carnet) {
      return res.status(400).json({
        ok: false,
        message: "Debes enviar un carnet válido"
      });
    }

    const resultados = buscarEnFuenteLocalPorCarnet(carnet);

    if (!resultados.length) {
      return res.status(404).json({
        ok: false,
        source: "local",
        found: false,
        message: "No se encontraron resultados para ese carnet"
      });
    }

    return res.json({
      ok: true,
      source: "local",
      found: true,
      total: resultados.length,
      results: resultados.map(mapCarnetResult)
    });
  } catch (error) {
    console.error("Error en /api/buscar-carnet:", error);
    return res.status(500).json({
      ok: false,
      message: "Error interno del servidor",
      detail: error.message
    });
  }
});

/**
 * Buscar por CPK:
 * /api/rastreo/0233718
 * /api/rastreo/CPK-0233718
 */
app.get("/api/rastreo/:cpk", (req, res) => {
  try {
    const cpk = req.params.cpk || "";
    const item = buscarEnFuenteLocalPorCPK(cpk);

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: "No se encontró el CPK"
      });
    }

    return res.json(mapCPKResult(item));
  } catch (error) {
    console.error("Error en /api/rastreo/:cpk:", error);
    return res.status(500).json({
      ok: false,
      message: "Error interno del servidor",
      detail: error.message
    });
  }
});

/**
 * Alias opcional por si aún tienes frontend viejo.
 * /api/buscar/70112204811
 */
app.get("/api/buscar/:valor", (req, res) => {
  try {
    const valor = req.params.valor || "";
    const digits = onlyDigits(valor);

    if (digits.length === 11) {
      const resultados = buscarEnFuenteLocalPorCarnet(digits);

      if (!resultados.length) {
        return res.status(404).json({
          ok: false,
          message: "No se encontraron resultados para ese carnet"
        });
      }

      return res.json({
        ok: true,
        source: "local",
        found: true,
        total: resultados.length,
        results: resultados.map(mapCarnetResult)
      });
    }

    const item = buscarEnFuenteLocalPorCPK(valor);

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: "No se encontraron resultados"
      });
    }

    return res.json(mapCPKResult(item));
  } catch (error) {
    console.error("Error en /api/buscar/:valor:", error);
    return res.status(500).json({
      ok: false,
      message: "Error interno del servidor",
      detail: error.message
    });
  }
});

/**
 * Recarga manual de datos sin reiniciar servidor.
 */
app.post("/api/admin/recargar-datos", (req, res) => {
  try {
    reloadTrackingData();
    return res.json({
      ok: true,
      message: "Datos recargados correctamente",
      total: RAW_TRACKING_SOURCE.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "No se pudieron recargar los datos",
      detail: error.message
    });
  }
});

/**
 * Chat temporal para no romper tu frontend mientras pruebas.
 */
app.post("/api/chat", (req, res) => {
  const mensaje = cleanValue(req.body?.mensaje || "");

  if (!mensaje) {
    return res.status(400).json({
      ok: false,
      mensaje: "Mensaje vacío"
    });
  }

  return res.json({
    ok: true,
    respuesta: "Ahora mismo estoy configurado para búsquedas por CPK y carnet."
  });
});

reloadTrackingData();

app.listen(PORT, () => {
  console.log(`Servidor Chambatina corriendo en puerto ${PORT}`);
});
