#!/usr/bin/env bash

# Detener el script si ocurre un error
set -o errexit

# Instalar dependencias de Node.js
echo "Installing npm dependencies..."
npm install

# --- Configuración para Puppeteer/Chrome en Render ---
# Definir dónde queremos que Render guarde el caché de Puppeteer
PUPPETEER_CACHE_DIR="/opt/render/.cache/puppeteer"
echo "Creating cache directory at $PUPPETEER_CACHE_DIR"
mkdir -p $PUPPETEER_CACHE_DIR

# Instalar Chrome usando Puppeteer
echo "Installing Chrome via Puppeteer..."
npx puppeteer browsers install chrome

# Notificar que el proceso ha terminado
echo "Build script completed."
