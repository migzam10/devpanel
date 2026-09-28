# 📋 Guía Completa de Requisitos e Instalación — BFPG Server cPanel

Esta guía contiene todo lo necesario para trasladar, desplegar y ejecutar **cPanel** en un nuevo servidor Linux sin inconvenientes.

---

## 📌 ¿Qué es este proyecto?

**BFPG Server cPanel** es un panel de control web ligero, responsivo y autónomo para monitorear y gestionar servidores Linux, procesos administrados con **PM2**, sitios web alojados en un directorio raíz (*webroot*), sockets de red/puertos activos y una terminal web de mantenimiento rápido.

Está construido en **Node.js nativo puro**, lo que significa que **no requiere ejecutar `npm install` de librerías externas de terceros**. Es instantáneo, no se rompe por dependencias desactualizadas y consume menos de 80 MB de memoria RAM.

---

## ⚙️ 1. Requisitos del Nuevo Servidor

Para que el proyecto funcione en su totalidad con todas sus capacidades, el nuevo servidor debe cumplir con lo siguiente:

### A. Requisitos de Software
| Componente | Versión Mínima | Versión Recomendada | Cómo verificar |
| :--- | :--- | :--- | :--- |
| **Sistema Operativo** | Linux (Kernel 4.x+) | Ubuntu 22.04+, Debian 12+, Rocky/AlmaLinux 9+ | `uname -a` |
| **Node.js** | v16.14.0 o superior | v18 LTS o v20 LTS | `node -v` |
| **PM2** | Globalmente instalado | Última versión disponible | `pm2 -v` |
| **Comando `ss` o `netstat`** | Incluido en `iproute2` | Herramienta estándar de Linux | `which ss` o `which netstat` |
| **Git** *(Opcional)* | Cualquiera | 2.25+ (para mostrar ramas de proyectos) | `git --version` |

### B. Requisitos de Hardware
- **CPU:** 1 vCPU / núcleo suficiente.
- **Memoria RAM:** Mínimo 256 MB de RAM libre (cPanel utiliza entre 60 MB y 85 MB).
- **Almacenamiento:** Menos de 5 MB de espacio en disco para el código de cPanel.

### C. Red y Puertos
- **Puerto por defecto:** `8888` TCP (se puede cambiar al puerto que desees en `.env`).
- **Firewall:** Si el nuevo servidor tiene cortafuegos activo, debes permitir el puerto:
  - En Ubuntu/Debian (`ufw`):
    ```bash
    sudo ufw allow 8888/tcp
    ```
  - En RHEL/CentOS/Rocky (`firewalld`):
    ```bash
    sudo firewall-cmd --permanent --add-port=8888/tcp
    sudo firewall-cmd --reload
    ```
  - En proveedores cloud (AWS EC2, Google Cloud, DigitalOcean, Oracle Cloud, Linode):
    Asegúrate de abrir el puerto `8888` en los Security Groups / Firewall de la consola web del proveedor si vas a acceder desde fuera.

---

## 🔍 2. Aspectos Clave a Tener en Cuenta en el Nuevo Servidor

Antes de arrancar el servicio en la nueva máquina, revisa estos 3 puntos:

### 1. Directorio Raíz de Sitios (`WEBROOT_DIR`)
En la máquina actual, los proyectos web están en `/home/bfpg/mis-servidores/webroot`. En el nuevo servidor es probable que tu usuario sea distinto (ej: `/home/ubuntu/mis-sitios`, `/var/www`, `/home/deploy/apps`, etc.).
- cPanel detecta automáticamente la variable `WEBROOT_DIR` desde el archivo `.env`.
- Si no configuras nada, cPanel asumirá como webroot el directorio padre de la carpeta donde esté instalado.
- Para definirlo explícitamente, edita `.env`:
  ```ini
  WEBROOT_DIR=/var/www
  ```

### 2. Mismo Usuario para PM2 y cPanel
PM2 gestiona los procesos por cada usuario del sistema de forma aislada.
- **Importante:** Debes ejecutar cPanel con el **mismo usuario** que ejecuta las aplicaciones en PM2. Si ejecutas cPanel como `root` y tus proyectos corren bajo el usuario `ubuntu`, cPanel no podrá ver los procesos del usuario `ubuntu` a menos que se ejecute bajo ese mismo usuario.

### 3. Permisos de Archivos
Asegúrate de que el usuario que corre cPanel tenga permisos de lectura y ejecución sobre las carpetas de proyectos que se quieran inspeccionar desde la pestaña "Explorador de Archivos".

---

## 🚀 3. Instrucciones Paso a Paso para la Instalación

### Paso 1: Descargar y Transferir los Archivos al Nuevo Servidor

Puedes subir el archivo comprimido (`cpanel.tar.gz` o `cpanel.zip`) al nuevo servidor mediante `scp`, `rsync` o descargándolo directamente:

```bash
# Ejemplo usando SCP desde tu máquina hacia el nuevo servidor:
scp cpanel.tar.gz usuario@IP_DEL_NUEVO_SERVIDOR:/home/usuario/
```

O si el servidor actual tiene acceso de red, puedes descargarlo con `curl` o `wget`:
```bash
wget http://IP_SERVIDOR_ORIGEN:8888/downloads/cpanel.tar.gz
```

### Paso 2: Descomprimir el Paquete

En el nuevo servidor:
```bash
tar -xzf cpanel.tar.gz
# O si usas ZIP:
# unzip cpanel.zip -d cpanel
cd cpanel
```

---

### Paso 3: Opción A — Instalación Automática (Recomendada)

El paquete incluye un script automatizado que valida Node.js, verifica PM2, genera el `.env` e inicia el servicio:

```bash
chmod +x install.sh
./install.sh
```

¡Listo! El script mostrará las URLs de acceso local y en red.

---

### Paso 3: Opción B — Instalación Manual

Si prefieres realizar la configuración manualmente:

1. **Instalar Node.js y PM2** (si aún no los tienes):
   ```bash
   # En Ubuntu / Debian:
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

2. **Configurar el archivo `.env`**:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Ajusta los valores deseados:
   ```ini
   PORT=8888
   HOST=0.0.0.0
   WEBROOT_DIR=/ruta/a/tus/proyectos
   ```

3. **Iniciar con PM2**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   ```

4. **Configurar inicio automático al encender el servidor**:
   ```bash
   pm2 startup
   ```
   *(Copia y pega el comando generado por PM2 en la terminal y luego corre `pm2 save`)*.

---

## 🌐 4. Configuración Opcional con Nginx y Dominio Propio

Si deseas asignar un subdominio (ej: `panel.tudominio.com`) con HTTPS / SSL gratuito mediante Certbot:

Crea un archivo de configuración en `/etc/nginx/sites-available/cpanel.conf`:

```nginx
server {
    server_name panel.tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Aumentar timeout para comandos largos en terminal
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }
}
```

Activa el sitio y emite el certificado SSL:
```bash
sudo ln -s /etc/nginx/sites-available/cpanel.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d panel.tudominio.com
```

---

## 🛠️ 5. Comandos de Gestión y Mantenimiento

Una vez instalado, estos son los comandos que usarás en el día a día:

| Acción | Comando |
| :--- | :--- |
| **Ver estado y consumo** | `pm2 status cpanel` |
| **Ver logs en tiempo real** | `pm2 logs cpanel` |
| **Reiniciar el panel** | `pm2 restart cpanel` |
| **Detener el panel** | `pm2 stop cpanel` |
| **Eliminar del gestor PM2** | `pm2 delete cpanel` |
| **Guardar configuración actual** | `pm2 save` |

---

## ❓ Preguntas Frecuentes y Solución de Problemas

#### 1. "cPanel no muestra mis otros servicios de PM2"
- **Causa:** cPanel se está ejecutando bajo un usuario distinto al usuario que lanzó los otros servicios de PM2.
- **Solución:** Inicia cPanel con el mismo usuario. Puedes verificar con `whoami` y comprobar `pm2 list`.

#### 2. "Error: listen EADDRINUSE :::8888"
- **Causa:** El puerto 8888 ya está ocupado por otro servicio.
- **Solución:** Edita `.env`, cambia `PORT=8889` (o cualquier otro libre) y ejecuta `pm2 restart cpanel`.

#### 3. "No aparecen carpetas en la pestaña Sitios Webroot"
- **Causa:** La ruta `WEBROOT_DIR` especificada en `.env` no existe o no tiene proyectos aún.
- **Solución:** Verifica que la ruta indicada en `.env` sea la correcta y que el usuario tenga permisos de lectura sobre ella.
