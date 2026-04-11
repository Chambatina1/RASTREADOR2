
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Para servir el frontend

// Base de datos SQLite
const dbPath = path.join(__dirname, 'db', 'chambatina.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error abriendo BD:', err.message);
  else console.log('Conectado a SQLite');
});

// Crear tabla si no existe
db.run(`
  CREATE TABLE IF NOT EXISTS paquetes (
    cpk TEXT PRIMARY KEY,
    estado TEXT,
    fecha TEXT,
    descripcion TEXT,
    observaciones TEXT,
    cliente TEXT,
    telefono TEXT,
    direccion TEXT,
    timeline TEXT,
    datos_raw TEXT
  )
`);

// --- MEMORIA POR SESIÓN (simple) ---
const sessionMemory = new Map(); // key: sessionId, value: historial de mensajes

// --- ENDPOINT RASTREO ---
app.get('/api/rastreo/:cpk', (req, res) => {
  const cpk = req.params.cpk.toUpperCase().trim();
  db.get(`SELECT * FROM paquetes WHERE cpk = ?`, [cpk], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
    if (!row) {
      return res.status(404).json({ error: 'No se encontró el paquete con ese CPK' });
    }
    // Generar timeline básico a partir del estado y fecha
    let timelineArray = [];
    if (row.timeline) {
      try {
        timelineArray = JSON.parse(row.timeline);
      } catch(e) { timelineArray = [row.estado]; }
    } else {
      timelineArray = [row.estado];
    }
    res.json({
      cpk: row.cpk,
      estado: row.estado,
      fecha: row.fecha,
      descripcion: row.descripcion,
      observaciones: row.observaciones,
      timeline: timelineArray,
      cliente: row.cliente,
      telefono: row.telefono,
      direccion: row.direccion
    });
  });
});

// --- ENDPOINT CHAT IA (con búsqueda en BD y memoria de sesión) ---
app.post('/api/chat', (req, res) => {
  const { message, sessionId, cpkContext } = req.body;
  if (!message || message.trim() === '') {
    return res.json({ reply: 'Por favor, escribe tu pregunta.' });
  }
  const sid = sessionId || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  if (!sessionMemory.has(sid)) {
    sessionMemory.set(sid, []);
  }
  const history = sessionMemory.get(sid);
  history.push({ role: 'user', content: message });
  // Mantener solo últimos 10 mensajes
  if (history.length > 10) history.shift();

  const lowerMsg = message.toLowerCase();

  // 1. Buscar CPK en el mensaje
  const cpkMatch = message.match(/CPK-[A-Z0-9]+/i);
  if (cpkMatch) {
    const cpk = cpkMatch[0].toUpperCase();
    db.get(`SELECT * FROM paquetes WHERE cpk = ?`, [cpk], (err, row) => {
      if (err || !row) {
        const reply = `No encontré el paquete con código ${cpk}. Verifica el número.`;
        history.push({ role: 'assistant', content: reply });
        res.json({ reply, sessionId: sid });
      } else {
        const reply = `📦 *${row.cpk}*: ${row.estado}. Fecha: ${row.fecha}. Descripción: ${row.descripcion || 'Sin descripción'}. ${row.observaciones ? `Observaciones: ${row.observaciones}` : ''}`;
        history.push({ role: 'assistant', content: reply });
        res.json({ reply, sessionId: sid });
      }
    });
    return;
  }

  // 2. Preguntas sobre precios, tiempos, envíos, sistemas solares, etc.
  let respuesta = '';
  if (lowerMsg.includes('precio') || lowerMsg.includes('costo') || lowerMsg.includes('valor')) {
    respuesta = 'Los precios varían según el producto. Contáctanos por WhatsApp para una cotización personalizada. ¿Te interesa algún kit solar o batería en especial?';
  } 
  else if (lowerMsg.includes('tiempo') || lowerMsg.includes('demora') || lowerMsg.includes('entrega')) {
    respuesta = 'El tiempo de entrega típico es de 10 a 15 días hábiles, dependiendo de la ubicación. ¿Necesitas rastrear un paquete específico? Dame el CPK.';
  }
  else if (lowerMsg.includes('solar') || lowerMsg.includes('panel') || lowerMsg.includes('inversor') || lowerMsg.includes('batería') || lowerMsg.includes('kit')) {
    respuesta = 'Ofrecemos inversores, baterías de litio y kits solares completos. ¿Te gustaría asesoría para elegir el sistema adecuado? Escríbenos al WhatsApp.';
  }
  else if (lowerMsg.includes('consignación') || lowerMsg.includes('dejar equipo')) {
    respuesta = 'Puedes dejar tus equipos en consignación. Regístrate en la sección Consignación de nuestra web y obtén comisiones por venta.';
  }
  else if (lowerMsg.includes('referido') || lowerMsg.includes('recomendar') || lowerMsg.includes('ganar')) {
    respuesta = '¡Sí! Gana el 10% de comisión por cada venta que generes con tu link de referido. Genera tu link en la sección Referidos.';
  }
  else {
    respuesta = 'Hola, soy Chambita. Puedo ayudarte con rastreo de paquetes (dame el CPK), información sobre sistemas solares, precios, consignación o referidos. ¿En qué más puedo asistirte?';
  }

  history.push({ role: 'assistant', content: respuesta });
  res.json({ reply: respuesta, sessionId: sid });
});

// Limpiar memoria cada hora (opcional)
setInterval(() => {
  sessionMemory.clear();
  console.log('Memoria de sesiones limpiada');
}, 3600000);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor Chambatina corriendo en http://localhost:${PORT}`);
});
