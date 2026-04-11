const axios = require('axios');
const cheerio = require('cheerio');

// Endpoint que usará el frontend de Chambatina
app.get('/api/rastreo/carnet/:carnet', async (req, res) => {
  const carnet = req.params.carnet.trim();
  if (!carnet) {
    return res.status(400).json({ error: 'Debes ingresar un carnet' });
  }

  try {
    // --- PASO 1: Obtener la página del formulario (por si hay tokens CSRF) ---
    const formPage = await axios.get('https://www.solvedc.com/tracking/kanguro/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const $ = cheerio.load(formPage.data);
    
    // Buscar posibles tokens CSRF (nombre común: csrf_token, _token, authenticity_token)
    let token = '';
    const tokenInput = $('input[name="csrf_token"]').val() ||
                       $('input[name="_token"]').val() ||
                       $('input[name="authenticity_token"]').val();
    if (tokenInput) token = tokenInput;

    // --- PASO 2: Enviar el carnet (ajusta la URL y los parámetros) ---
    // Suponiendo que la acción del formulario es POST a la misma URL o a /consultar
    const consultaUrl = 'https://www.solvedc.com/tracking/kanguro/consultar'; // Puede cambiar
    const params = new URLSearchParams();
    params.append('carnet', carnet);
    // Si el formulario espera 'cedula' o 'identificacion', cambia el nombre
    if (token) params.append('csrf_token', token);

    const resultPage = await axios.post(consultaUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.solvedc.com/tracking/kanguro/'
      }
    });

    // --- PASO 3: Extraer los datos del HTML de resultados ---
    const $result = cheerio.load(resultPage.data);
    
    // Aquí debes inspeccionar el HTML real para encontrar las clases o IDs de los datos.
    // Ejemplo hipotético:
    const paquetes = [];
    $result('.item-paquete').each((i, elem) => {
      const cpk = $result(elem).find('.numero-guia').text().trim();
      const estado = $result(elem).find('.estado').text().trim();
      const fecha = $result(elem).find('.fecha').text().trim();
      const descripcion = $result(elem).find('.producto').text().trim();
      const observaciones = $result(elem).find('.observaciones').text().trim();
      
      paquetes.push({
        cpk,
        estado,
        fecha,
        descripcion,
        observaciones,
        timeline: [estado]   // Si hay historial, puedes extraerlo
      });
    });

    if (paquetes.length === 0) {
      return res.status(404).json({ error: 'No se encontraron paquetes para ese carnet' });
    }

    res.json(paquetes);
  } catch (error) {
    console.error('Error consultando Kanguro:', error.message);
    res.status(500).json({ error: 'El sistema de rastreo externo no respondió. Intenta más tarde.' });
  }
});
