import express from "express";
import cors from "cors";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta base
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// Ruta de prueba
app.post("/test", (req, res) => {
  res.json({
    ok: true,
    body: req.body
  });
});

// Endpoint principal
app.post("/api/records/query", (req, res) => {
  const { funcname, option, kind, idrecord } = req.body;

  return res.json({
    ok: true,
    message: "Endpoint funcionando",
    received: {
      funcname,
      option,
      kind,
      idrecord
    }
  });
});

// Puerto
const PORT = 3000;

app.listen(PORT, () => {
  console.log("Servidor en puerto 3000");
});
