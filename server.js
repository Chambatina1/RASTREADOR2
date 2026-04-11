require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Pool de conexión a BD real
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'tu_usuario',
  password: process.env.DB_PASSWORD || 'tu_contraseña',
  database: process.env.DB_NAME || 'tu_base_datos',
  waitForConnections: true,
  connectionLimit: 10,
});

// Endpoint rastreo por CPK
app.get('/api/rastreo/:cpk', async (req, res) => {
  const cpk = req.params.cpk.toUpperCase().trim();
  try {
    const [rows] = await pool.query('SELECT * FROM paquetes WHERE cpk = ?', [cpk]);
    if (rows.length === 0) return res.status(404).json({ error: 'Paquete no encontrado' });
    const row = rows[0];
    res.json({
      cpk: row.cpk,
      estado: row.estado,
      fecha: row.fecha,
      descripcion: row.descripcion,
      observaciones: row.observaciones,
      timeline: row.timeline ? JSON.parse(row.timeline) : [row.estado],
      cliente: row.cliente,
      telefono: row.telefono,
      direccion: row.direccion
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// Endpoint rastreo por carnet
app.get('/api/rastreo/carnet/:carnet', async (req, res) => {
  const carnet = req.params.carnet.trim();
  try {
    const [rows] = await pool.query(
      `SELECT cpk, estado, fecha, descripcion, observaciones, cliente, telefono, direccion, timeline 
       FROM paquetes WHERE carnet = ?`,
      [carnet]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No hay paquetes para ese carnet' });
    const resultados = rows.map(row => ({
      ...row,
      timeline: row.timeline ? JSON.parse(row.timeline) : [row.estado]
    }));
    res.json(resultados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// Chat IA (con búsqueda en BD y memoria)
const sessionMemory = new Map();
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.json({ reply: 'Escribe tu pregunta.' });
  const sid = sessionId || Date.now().toString();
  if (!sessionMemory.has(sid)) sessionMemory.set(sid, []);
  const history = sessionMemory.get(sid);
  history.push({ role: 'user', content: message });
  if (history.length > 10) history.shift();

  const lowerMsg = message.toLowerCase();
  const cpkMatch = message.match(/CPK-[A-Z0-9]+/i);
  if (cpkMatch) {
    const cpk = cpkMatch[0].toUpperCase();
    try {
      const [rows] = await pool.query('SELECT * FROM paquetes WHERE cpk = ?', [cpk]);
      if (rows.length === 0) {
        const reply = `No encontré el paquete ${cpk}. Verifica el código.`;
        history.push({ role: 'assistant', content: reply });
        return res.json({ reply, sessionId: sid });
      }
      const row = rows[0];
      const reply = `📦 ${row.cpk}: ${row.estado}. Fecha: ${row.fecha}. ${row.descripcion || ''}`;
      history.push({ role: 'assistant', content: reply });
      return res.json({ reply, sessionId: sid });
    } catch (err) {
      return res.json({ reply: 'Error al consultar el paquete.' });
    }
  }

  // Respuestas genéricas (puedes ampliar)
  let reply = '';
  if (lowerMsg.includes('precio') || lowerMsg.includes('costo')) {
    reply = 'Contáctanos por WhatsApp para una cotización personalizada.';
  } else if (lowerMsg.includes('solar') || lowerMsg.includes('batería') || lowerMsg.includes('inversor')) {
    reply = 'Ofrecemos kits solares, inversores y baterías. ¿Necesitas asesoría? Escríbenos al WhatsApp.';
  } else if (lowerMsg.includes('consignación')) {
    reply = 'Puedes dejar equipos en consignación. Regístrate en nuestra web.';
  } else if (lowerMsg.includes('referido')) {
    reply = 'Gana comisiones refiriendo productos. Genera tu link en la sección Referidos.';
  } else {
    reply = 'Hola, soy Chambita. Puedo ayudarte con rastreo (dame tu carnet o CPK), información de productos solares, precios o referidos. ¿En qué te ayudo?';
  }
  history.push({ role: 'assistant', content: reply });
  res.json({ reply, sessionId: sid });
});

setInterval(() => sessionMemory.clear(), 3600000); // Limpiar cada hora

app.listen(PORT, () => console.log(`Servidor Chambatina corriendo en puerto ${PORT}`));
