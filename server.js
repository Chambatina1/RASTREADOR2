import express from "express";
import cors from "cors";

const app = express();

// middlewares
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ruta base
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mensaje: "Servidor activo 🚀"
  });
});

// endpoint de prueba
app.post("/api/records/query", (req, res) => {
  console.log("BODY:", req.body);

  res.json({
    ok: true,
    mensaje: "Endpoint funcionando",
    data: req.body
  });
});

// chat simple
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

// puerto
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
