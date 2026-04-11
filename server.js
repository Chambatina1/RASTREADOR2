// server.js - Proxy para rastreo por carnet (Chambatina → Kanguro)
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public')); // Aquí pones tu index.html, CSS, imágenes

// ==================== ENDPOINT DE RASTREO POR CARNET ====================
// Este endpoint recibe el número de carnet desde el frontend de Chambatina,
// consulta el sitio de Kanguro, extrae la información y la devuelve en JSON.
app.get('/api/rastreo/carnet/:carnet', async (req, res) => {
  const carnet = req.params.carnet.trim();
  if (!carnet) {
    return res.status(400).json({ error: 'Debes ingresar un número de carnet' });
  }

  try {
    // 1. Obtener la página principal del formulario (para extraer tokens CSRF si existen)
    const baseUrl = 'https://www.solvedc.com/tracking/kanguro/';
    const formResponse = await axios.get(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(formResponse.data);
    
    // Buscar token CSRF (nombres comunes en formularios)
    let csrfToken = '';
    const tokenSelectors = [
      'input[name="csrf_token"]',
      'input[name="_token"]',
      'input[name="authenticity_token"]',
      'input[name="csrf"]'
    ];
    for (const selector of tokenSelectors) {
      const token = $(selector).val();
      if (token) {
        csrfToken = token;
        break;
      }
    }

    // 2. Determinar la URL de envío (action del formulario)
    let actionUrl = baseUrl;
    const formAction = $('form').attr('action');
    if (formAction) {
      actionUrl = formAction.startsWith('http') ? formAction : new URL(formAction, baseUrl).href;
    }

    // 3. Preparar los datos del formulario (el nombre del campo puede ser 'carnet', 'cedula', 'identificacion', etc.)
    //    ⚠️ AJUSTA ESTE NOMBRE SEGÚN LO QUE ESPERE EL SITIO DE KANGURO
    const formData = new URLSearchParams();
    formData.append('carnet', carnet);   // Prueba con 'carnet'
    // Si no funciona, intenta con: 'cedula', 'identificacion', 'numero_documento'
    if (csrfToken) formData.append('csrf_token', csrfToken);

    // 4. Enviar la petición POST con los datos
    const consultaResponse = await axios.post(actionUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': baseUrl,
      },
      timeout: 15000,
    });

    // 5. Parsear el HTML de la respuesta para extraer los datos del/los paquetes
    const $results = cheerio.load(consultaResponse.data);
    
    // ⚠️ AQUÍ DEBES CAMBIAR LOS SELECTORES según la estructura REAL del HTML de resultados
    // Inspecciona la página de Kanguro con F12 para encontrar las clases o IDs correctos.
    // Ejemplos hipotéticos:
    // - Cada paquete está dentro de un contenedor: '.result-item', '.tracking-card', 'tr', etc.
    // - El código de guía/CPK puede estar en '.guia', '.tracking-number', 'td:first-child'
    // - El estado en '.estado', '.status', 'td:nth-child(2)'
    // - La fecha en '.fecha', '.date', etc.
    
    const paquetes = [];
    
    // Intenta encontrar contenedores de cada paquete (ajusta el selector)
    $results('.result-item, .tracking-card, .table tbody tr').each((i, elem) => {
      const $elem = $results(elem);
      
      // Extrae cada campo con selectores específicos (cámbialos según la realidad)
      const cpk = $elem.find('.guia, .tracking-number, td:first-child').text().trim();
      const estado = $elem.find('.estado, .status, td:nth-child(2)').text().trim();
      const fecha = $elem.find('.fecha, .date, td:nth-child(3)').text().trim();
      const descripcion = $elem.find('.producto, .descripcion, td:nth-child(4)').text().trim();
      const observaciones = $elem.find('.observaciones, .nota, td:nth-child(5)').text().trim();
      
      if (cpk) {
        paquetes.push({
          cpk,
          estado,
          fecha,
          descripcion,
          observaciones,
          timeline: [estado]  // Si el sitio ofrece historial, puedes extraerlo
        });
      }
    });

    // Si no se encontraron paquetes con los selectores anteriores, intenta con una estrategia más genérica:
    if (paquetes.length === 0) {
      // Busca cualquier texto que parezca un CPK (formato CPK-XXXX)
      const bodyText = $results.body.text();
      const cpkMatches = bodyText.match(/CPK-[A-Z0-9]+/g);
      if (cpkMatches && cpkMatches.length > 0) {
        // Extrae todo el texto como único paquete (fallback)
        paquetes.push({
          cpk: cpkMatches[0],
          estado: 'Ver detalles en la web original',
          fecha: '',
          descripcion: bodyText.substring(0, 200),
          observaciones: '',
          timeline: []
        });
      }
    }

    if (paquetes.length === 0) {
      return res.status(404).json({ error: 'No se encontraron paquetes para ese carnet' });
    }

    // 6. Devolver los datos en el formato que espera el frontend de Chambatina
    res.json(paquetes);
    
  } catch (error) {
    console.error('Error consultando Kanguro:', error.message);
    // Devuelve un error amigable sin exponer detalles internos
    res.status(500).json({ error: 'El servicio de rastreo externo no está disponible. Intenta más tarde.' });
  }
});

// ==================== ENDPOINT DE CHAT (OPCIONAL, SIMPLE) ====================
// Puedes ampliarlo después, pero aquí va una versión básica
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  let reply = 'Hola, soy Chambita. Puedo ayudarte con el rastreo de paquetes (ingresa tu carnet en la sección Rastrear) o con información sobre productos solares. ¿En qué más te ayudo?';
  if (message && message.toLowerCase().includes('precio')) {
    reply = 'Para precios personalizados, contáctanos por WhatsApp.';
  }
  res.json({ reply });
});

// ==================== INICIO DEL SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`✅ Servidor Chambatina corriendo en http://localhost:${PORT}`);
  console.log(`📦 Endpoint de rastreo: http://localhost:${PORT}/api/rastreo/carnet/{carnet}`);
});
