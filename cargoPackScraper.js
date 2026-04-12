// cargoPackScraper.js
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';

let browser = null;
let page = null;
let loginPromise = null;

const CREDENTIALS = {
  usuario: 'GEO MIA',
  password: 'GEO**091223',
  agencia: 'CHAMBATINA'
};

const LOGIN_URL = 'https://www.solvedc.com/cargo/cargopack/';

// ⚠️ IMPORTANTE: Estos selectores debes ajustarlos inspeccionando la página real
// Abre la página con las credenciales, haz clic derecho -> Inspeccionar
// y copia los selectores correctos.
const SELECTORS = {
  inputUsuario: 'input[name="usuario"]',
  inputPassword: 'input[name="password"]',
  inputAgencia: 'input[name="agencia"]',
  botonLogin: 'button[type="submit"], input[type="submit"]',
  // Después del login, campo para buscar por CPK (puede ser el mismo que para carnet)
  inputBusqueda: '#cpk_input',        // Ajustar
  botonBuscar: '#buscar_btn',         // Ajustar
  tablaResultados: '#resultados table', // Ajustar
  // Índices de columnas (0-based)
  columnaCPK: 0,
  columnaEstado: 1,
  columnaFecha: 2,
  columnaDescripcion: 3,
  columnaNombre: 4,
  columnaCarnet: 5
};

async function initBrowser() {
  if (browser && browser.isConnected()) return browser;

  const options = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  // Para entornos serverless como Render, usar chromium de @sparticuz
  options.executablePath = await chromium.executablePath();

  browser = await puppeteer.launch(options);
  return browser;
}

async function ensureLoggedIn() {
  if (page && !page.isClosed()) return page;

  const browserInstance = await initBrowser();
  page = await browserInstance.newPage();

  // Navegar a la página de login
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

  // Esperar campos de login
  await page.waitForSelector(SELECTORS.inputUsuario, { timeout: 15000 });
  await page.waitForSelector(SELECTORS.inputPassword, { timeout: 15000 });
  await page.waitForSelector(SELECTORS.inputAgencia, { timeout: 15000 });

  // Rellenar formulario
  await page.type(SELECTORS.inputUsuario, CREDENTIALS.usuario);
  await page.type(SELECTORS.inputPassword, CREDENTIALS.password);
  await page.type(SELECTORS.inputAgencia, CREDENTIALS.agencia);

  // Hacer clic en login
  await page.click(SELECTORS.botonLogin);
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

  // Verificar que el login fue exitoso (presencia del campo de búsqueda)
  await page.waitForSelector(SELECTORS.inputBusqueda, { timeout: 15000 })
    .catch(() => { throw new Error('Login fallido: no se encontró el campo de búsqueda'); });

  return page;
}

async function performSearch(valor) {
  const page = await ensureLoggedIn();

  // Limpiar y escribir el valor (puede ser CPK o carnet, el mismo campo)
  await page.click(SELECTORS.inputBusqueda, { clickCount: 3 });
  await page.type(SELECTORS.inputBusqueda, valor);

  // Hacer clic en buscar
  await page.click(SELECTORS.botonBuscar);
  // Esperar a que la tabla se actualice (ajusta tiempo si es necesario)
  await page.waitForTimeout(3000);

  // Extraer datos de la tabla
  const resultados = await page.evaluate((sel) => {
    const table = document.querySelector(sel.tablaResultados);
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr')).slice(1); // omitir cabecera
    return rows.map(row => {
      const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      return {
        cpk: cols[sel.columnaCPK] || '',
        estado: cols[sel.columnaEstado] || '',
        fecha: cols[sel.columnaFecha] || '',
        descripcion: cols[sel.columnaDescripcion] || '',
        nombre: cols[sel.columnaNombre] || '',
        carnet: cols[sel.columnaCarnet] || ''
      };
    });
  }, SELECTORS);

  return resultados;
}

// Función pública para consultar por CPK
export async function consultarPorCPK(codigo) {
  try {
    const resultados = await performSearch(codigo);
    if (!resultados.length) return null;
    // Suponemos que el primer resultado es el que coincide exactamente con el CPK
    return resultados[0];
  } catch (error) {
    console.error('Error en consultarPorCPK:', error);
    return null;
  }
}

// Función pública para consultar por Carnet
export async function consultarPorCarnet(carnet) {
  try {
    const resultados = await performSearch(carnet);
    // Filtrar aquellos que tengan el carnet exacto (por si la búsqueda devuelve varios)
    const filtrados = resultados.filter(r => r.carnet.replace(/\D/g, '') === carnet);
    return filtrados.length ? filtrados : resultados;
  } catch (error) {
    console.error('Error en consultarPorCarnet:', error);
    return [];
  }
}

// Cerrar navegador (útil para apagar el servidor)
export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
  page = null;
}
