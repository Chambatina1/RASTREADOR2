import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    return res.json({
      ok: true,
      mensaje: "Servidor activo 🚀",
      db: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mensaje: "Error conectando con la base de datos",
      error: error.message
    });
  }
});

app.post("/api/records/query", async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const { funcname, option, kind, idrecord } = req.body;

    if (funcname === "getListRecord" && option === "reserve" && kind === "list") {
      const result = await pool.query(`
        SELECT id, customer_name, reserve_date, status
        FROM reserves
        ORDER BY id DESC
        LIMIT 20
      `);

      return res.json({
        ok: true,
        mensaje: "Datos obtenidos correctamente",
        data: result.rows
      });
    }

    return res.status(400).json({
      ok: false,
      mensaje: "Combinación no soportada",
      recibido: { funcname, option, kind, idrecord }
    });
  } catch (error) {
    console.error("ERROR EN /api/records/query:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error consultando la base de datos",
      error: error.message
    });
  }
});

app.post("/api/chat", (req, res) => {
  const mensaje = String(req.body.mensaje || "").trim();

  if (!mensaje) {
    return res.status(400).json({
      ok: false,
      respuesta: "Escribe algo"
    });
  }

  return res.json({
    ok: true,
    respuesta: `Recibí: ${mensaje}`
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
