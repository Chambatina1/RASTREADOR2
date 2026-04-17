import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

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
