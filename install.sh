#!/usr/bin/env bash
# ==============================================================================
# Script de Instalación y Despliegue Rápido de DevPanel
# ==============================================================================

set -e

COLOR_GREEN='\033[0;32m'
COLOR_BLUE='\033[0;34m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[0;31m'
COLOR_RESET='\033[0m'

echo -e "${COLOR_BLUE}==============================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN} ⚡ Instalador de DevPanel ${COLOR_RESET}"
echo -e "${COLOR_BLUE}==============================================================${COLOR_RESET}"

# 1. Comprobar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo -e "${COLOR_RED}❌ Error: Node.js no se encuentra instalado.${COLOR_RESET}"
  echo "Por favor instala Node.js (v18 o v20 LTS recomendado):"
  echo "  - Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "  - CentOS/RHEL:   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs"
  echo "  - Arch Linux:    sudo pacman -S nodejs npm"
  exit 1
fi

NODE_VER=$(node -v)
echo -e "✅ Node.js detectado: ${COLOR_GREEN}${NODE_VER}${COLOR_RESET}"

# 2. Comprobar PM2
if ! command -v pm2 >/dev/null 2>&1; then
  echo -e "${COLOR_YELLOW}⚠️ PM2 no está instalado globalmente. Intentando instalar...${COLOR_RESET}"
  if command -v npm >/dev/null 2>&1; then
    npm install -g pm2 || sudo npm install -g pm2
    echo -e "✅ PM2 instalado correctamente: $(pm2 -v)"
  else
    echo -e "${COLOR_RED}❌ Error: npm no está disponible para instalar PM2.${COLOR_RESET}"
    echo "Instala npm y luego ejecuta: npm install -g pm2"
    exit 1
  fi
else
  echo -e "✅ PM2 detectado: ${COLOR_GREEN}$(pm2 -v)${COLOR_RESET}"
fi

# 3. Directorio del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 4. Configurar archivo .env
if [ ! -f .env ]; then
  PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [ -f .env.example ]; then
    cp .env.example .env
    # Ajustar WEBROOT_DIR por defecto al directorio padre del script si es necesario
    sed -i "s|WEBROOT_DIR=.*|WEBROOT_DIR=${PARENT_DIR}|g" .env
  else
    cat <<EOF > .env
PORT=8888
HOST=0.0.0.0
WEBROOT_DIR=${PARENT_DIR}
EOF
  fi
  echo -e "📄 Archivo de configuración ${COLOR_GREEN}.env${COLOR_RESET} creado con éxito."
  echo -e "   - Puerto: 8888"
  echo -e "   - Webroot: ${PARENT_DIR}"
else
  echo -e "📄 Archivo ${COLOR_GREEN}.env${COLOR_RESET} existente detectado. Manteniendo configuración actual."
fi

# 5. Iniciar servicio con PM2
echo -e "${COLOR_BLUE}🚀 Iniciando cPanel con PM2...${COLOR_RESET}"
pm2 start ecosystem.config.js
pm2 save

echo ""
echo -e "${COLOR_GREEN}==============================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN} 🎉 ¡cPanel desplegado y funcionando correctamente! ${COLOR_RESET}"
echo -e "${COLOR_GREEN}==============================================================${COLOR_RESET}"
echo ""
echo -e "🌐 Acceso local:       ${COLOR_BLUE}http://localhost:8888${COLOR_RESET}"
echo -e "🌐 Acceso en red:      ${COLOR_BLUE}http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'TU_IP'):8888${COLOR_RESET}"
echo ""
echo "🛠️ Comandos de gestión:"
echo "   pm2 status cpanel     -> Ver estado del servicio"
echo "   pm2 logs cpanel       -> Ver registros en tiempo real"
echo "   pm2 restart cpanel    -> Reiniciar el panel"
echo "   pm2 stop cpanel       -> Detener el panel"
echo ""
echo "💡 Para que inicie automáticamente al reiniciar el servidor ejecuta:"
echo "   pm2 startup"
echo "   (sigue la instrucción que imprima en pantalla y luego ejecuta 'pm2 save')"
echo -e "${COLOR_BLUE}==============================================================${COLOR_RESET}"
