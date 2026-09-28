# ⚡ DevPanel

Panel de control web moderno, ultra-ligero y reactivo diseñado específicamente para administrar los servidores, contenedores Docker, aplicaciones en PM2, sitios en webroot/Apache y recursos del sistema de esta máquina.

---

## ✨ Características Principales

1. **Dashboard & Métricas en Vivo:**
   - Monitoreo en tiempo real de CPU, Memoria RAM, Disco Duro, carga del sistema y tiempo de actividad.
   - Panel de "Servicios del Sistema" para reiniciar servicios vitales (Apache, MySQL, Redis, PostgreSQL, Docker) desde la web.

2. **Administrador de Contenedores Docker:**
   - Detecta y lee el socket de Docker nativamente.
   - Inicia, detiene, reinicia y visualiza los logs de contenedores en tiempo real.

3. **Administrador de Servicios PM2:**
   - Lista completa de todos los procesos gestionados por PM2.
   - Acciones con 1 clic: **Reiniciar**, **Detener**, **Iniciar**.
   - Visor de registros en tiempo real con limpieza de logs.

4. **Sitios en Apache / Webroot:**
   - Auto-detecta sitios en configuraciones de Apache virtuales o en tu directorio base (como \`/var/www/html\`).
   - Detección automática del stack tecnológico (PHP, Node.js, HTML/CSS).

5. **Explorador de Archivos:**
   - Navegación visual y segura por el directorio webroot.
   - Tamaño de archivo, fecha de modificación e iconos según tipo.

6. **Puertos y Red (Cross-Platform):**
   - Escaneo y visualización de sockets TCP en escucha (compatible con Mac OS y Linux).
   - Etiquetado inteligente de procesos (reconoce si un puerto pertenece a Docker, PM2, Apache, o servidores manuales de Python/Node).

7. **Consola / Terminal Web:**
   - Ejecución de comandos del sistema directamente en el entorno de trabajo.
   - Atajos predefinidos de comandos útiles.

8. **Seguridad (Autenticación PIN):**
   - Pantalla de inicio de sesión con PIN de seguridad para restringir el acceso no autorizado.

---

## 📦 Instalación

**Requisitos Previos:**
- Node.js (v14+) instalado en el servidor.
- Recomendado: PM2 instalado de forma global (\`npm install -g pm2\`).

**Pasos:**
1. Clona el repositorio:
   \`\`\`bash
   git clone <tu-repositorio-github>
   cd devpanel
   \`\`\`
2. Configura tu PIN de acceso (Opcional):
   Crea un archivo \`.env\` en la carpeta raíz y añade el PIN que prefieras:
   \`\`\`env
   CPANEL_PIN=123456
   \`\`\`
3. Inicia el panel con PM2 (o con Node directamente):
   \`\`\`bash
   # Opción 1: Con PM2 (para que corra en segundo plano)
   pm2 start server.js --name devpanel

   # Opción 2: Para desarrollo / prueba
   node server.js
   \`\`\`
4. Accede en tu navegador a:
   [http://localhost:8888](http://localhost:8888)

---

## 📜 Licencia y Créditos

Este proyecto se distribuye bajo la Licencia **MIT** (Ver archivo LICENSE). Puedes usarlo y modificarlo libremente y de forma **gratis**.

Créditos e inspiración basados en el trabajo de: **[MrBorys](https://github.com/MrBorys)**.
