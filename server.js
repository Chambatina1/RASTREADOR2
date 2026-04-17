import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mensaje: "Servidor activo 🚀"
  });
});

app.post("/api/records/query", (req, res) => {
  console.log("BODY:", req.body);

  return res.json({
    ok: true,
    mensaje: "Endpoint funcionando",
    recibido: req.body
  });
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
