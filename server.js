import express from "express";
import cors from "cors";
import recordsRoutes from "./routes/records.js";

const app = express();

app.use(cors());
app.use(express.json());

// 👇 ESTA LÍNEA FALTABA
app.use("/api/records", recordsRoutes);

app.get("/", (req, res) => {
  res.send("OK");
});

app.post("/test", (req, res) => {
  res.json({
    ok: true,
    body: req.body
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
