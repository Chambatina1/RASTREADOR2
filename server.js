import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.post("/test", (req, res) => {
  res.json({
    ok: true,
    body: req.body
  });
});

app.post("/api/records/query", (req, res) => {
  res.json({
    ok: true,
    message: "API funcionando",
    data: req.body
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log("Servidor en puerto 3000");
});
