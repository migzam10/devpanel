/**
 * DevPanel - Backend Server
 * Panel de Control Integral para Servidores y Proyectos Webroot
 * 
 * Corre en Node.js nativo (sin dependencias externas requeridas)
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { exec, execSync } = require('node:child_process');
const url = require('node:url');

// --- Cargar configuración .env de forma nativa si existe ---
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    console.warn('No se pudo cargar el archivo .env:', e.message);
  }
}

const PORT = parseInt(process.env.PORT || '8888', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_WEBROOT = fs.existsSync('/var/www/html')
  ? '/var/www/html'
  : path.resolve(__dirname, '..');
const WEBROOT_DIR = process.env.WEBROOT_DIR ? path.resolve(process.env.WEBROOT_DIR) : DEFAULT_WEBROOT;
const PUBLIC_DIR = path.join(__dirname, 'public');


// --- Utilidades para CPU ---
function sampleCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let lastCpuSample = sampleCpuTimes();
let lastCpuUsage = 0;

setInterval(() => {
  const current = sampleCpuTimes();
  const idleDiff = current.idle - lastCpuSample.idle;
  const totalDiff = current.total - lastCpuSample.total;
  if (totalDiff > 0) {
    lastCpuUsage = Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100));
  }
  lastCpuSample = current;
}, 1500);

// --- Función para obtener IPs locales ---
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ interface: name, address: iface.address });
      }
    }
  }
  return ips;
}

// --- Obtener estadísticas del sistema ---
async function getSystemStats() {
  // RAM
  let memInfo = { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), available: os.freemem(), percent: 0 };
  const isMac = os.platform() === 'darwin';
  
  if (isMac) {
    try {
      // Simplificado para macOS: os.freemem() en mac es bastante restrictivo.
      // Usaremos vm_stat si se quiere algo muy preciso, pero os.freemem es pasable.
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      const percent = total > 0 ? (used / total) * 100 : 0;
      memInfo.percent = parseFloat(percent.toFixed(1));
    } catch(e){}
  } else {
    try {
      const memData = fs.readFileSync('/proc/meminfo', 'utf8');
      const getVal = (key) => {
        const match = memData.match(new RegExp(`${key}:\\s+(\\d+)`));
        return match ? parseInt(match[1], 10) * 1024 : 0;
      };
      const total = getVal('MemTotal');
      const free = getVal('MemFree');
      const available = getVal('MemAvailable') || free;
      const buffers = getVal('Buffers');
      const cached = getVal('Cached');
      const used = total - available;
      const percent = total > 0 ? (used / total) * 100 : 0;

      memInfo = {
        total, used, free, available, buffers, cached,
        percent: parseFloat(percent.toFixed(1))
      };
    } catch (e) {
      const percent = memInfo.total > 0 ? (memInfo.used / memInfo.total) * 100 : 0;
      memInfo.percent = parseFloat(percent.toFixed(1));
    }
  }

  // Disco
  let diskInfo = { total: 0, used: 0, available: 0, percent: 0, mount: '/' };
  try {
    const dfOut = execSync('df -k / | tail -n 1', { encoding: 'utf8' }).trim();
    const parts = dfOut.split(/\s+/);
    if (parts.length >= 6) {
      const total = parseInt(parts[1], 10) * 1024;
      const used = parseInt(parts[2], 10) * 1024;
      const available = parseInt(parts[3], 10) * 1024;
      const percent = total > 0 ? (used / total) * 100 : 0;
      diskInfo = {
        total,
        used,
        available,
        percent: parseFloat(percent.toFixed(1)),
        mount: parts[5] || '/'
      };
    }
  } catch (e) {
    // ignore
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    cpusCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Desconocido',
    cpuPercent: parseFloat(lastCpuUsage.toFixed(1)),
    memory: memInfo,
    disk: diskInfo,
    localIps: getLocalIps(),
    serverTime: new Date().toISOString(),
    webroot: WEBROOT_DIR
  };
}

// --- Obtener procesos PM2 ---
function getPm2Processes() {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf8', timeout: 4000 });
    const list = JSON.parse(raw);
    
    // Obtenemos los puertos escuchando para mapear
    const ports = getOpenPorts();

    return list.map(item => {
      const pmId = item.pm_id;
      const name = item.name;
      const status = item.pm2_env?.status || 'stopped';
      const pid = item.pid;
      const cpu = item.monit?.cpu || 0;
      const memory = item.monit?.memory || 0;
      const uptime = item.pm2_env?.pm_uptime ? Date.now() - item.pm2_env.pm_uptime : 0;
      const restarts = item.pm2_env?.restart_time || 0;
      const cwd = item.pm2_env?.pm_cwd || '';
      const script = item.pm2_env?.pm_exec_path || '';
      const mode = item.pm2_env?.exec_mode || 'fork_mode';
      const outLog = item.pm2_env?.pm_out_log_path || '';
      const errLog = item.pm2_env?.pm_err_log_path || '';

      // Determinar puerto
      let detectedPort = null;
      if (item.pm2_env?.env?.PORT) {
        detectedPort = parseInt(item.pm2_env.env.PORT, 10);
      }
      
      if (!detectedPort && pid) {
        const found = ports.find(p => p.pid === pid);
        if (found) detectedPort = found.port;
      }

      // Mapeo conocido por si el proceso es clúster / child process
      if (!detectedPort) {
        if (name === 'paraellas-store') detectedPort = 3002;
        else if (name === 'afriguarapos') detectedPort = 8080;
        else if (name === 'cajitamagica') detectedPort = 3000;
        else if (name === 'classicjuegos-backend') detectedPort = 4000;
        else if (name === 'classicjuegos-frontend') detectedPort = 3001;
        else if (name === 'antigravity-web') detectedPort = 3005;
        else if (name === 'whatsapp-saludo') detectedPort = 8000;
        else if (name === 'bfhome') detectedPort = 5050;
        else if (name === 'promoradar-backend') detectedPort = 4050;
        else if (name === 'promoradar-usuarios') detectedPort = 4051;
        else if (name === 'promoradar-comercios') detectedPort = 4052;
        else if (name === 'promoradar-redirect') detectedPort = 4053;
      }

      return {
        id: pmId,
        name,
        status,
        pid,
        cpu,
        memory,
        uptime,
        restarts,
        cwd,
        script,
        mode,
        outLog,
        errLog,
        port: detectedPort
      };
    });
  } catch (err) {
    console.error('Error al obtener PM2 jlist:', err.message);
    return [];
  }
}

// --- Obtener puertos abiertos ---
function getOpenPorts() {
  const isMac = os.platform() === 'darwin';
  let ports = [];

  if (isMac) {
    try {
      // lsof is typically available on macOS
      const out = execSync('lsof -iTCP -sTCP:LISTEN -P -n', { encoding: 'utf8', timeout: 3000 });
      const lines = out.trim().split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const processName = parts[0];
          const pid = parseInt(parts[1], 10);
          const addressPart = parts[8]; // e.g., *:8080 or 127.0.0.1:27017
          
          const lastColon = addressPart.lastIndexOf(':');
          if (lastColon !== -1) {
            const address = addressPart.substring(0, lastColon).replace('*', '0.0.0.0');
            const port = parseInt(addressPart.substring(lastColon + 1), 10);
            
            if (!isNaN(port)) {
              ports.push({ port, address, process: processName, pid });
            }
          }
        }
      }
    } catch (err) {
      console.error('Error usando lsof en macOS:', err.message);
    }
  } else {
    // Linux logic using ss or netstat
    let out = '';
    try {
      out = execSync('ss -tlpn', { encoding: 'utf8', timeout: 3000 });
    } catch (err) {
      try {
        out = execSync('netstat -tlpn', { encoding: 'utf8', timeout: 3000 });
      } catch (err2) {
        return [];
      }
    }

    try {
      const lines = out.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const local = parts[3];
          const lastColon = local.lastIndexOf(':');
          if (lastColon !== -1) {
            const address = local.substring(0, lastColon);
            const port = parseInt(local.substring(lastColon + 1), 10);
            let processName = 'desconocido';
            let pid = null;
            const procMatch = line.match(/users:\(\(?"([^"]+)",pid=(\d+)/);
            if (procMatch) {
              processName = procMatch[1];
              pid = parseInt(procMatch[2], 10);
            }
            if (!isNaN(port)) {
              ports.push({ port, address, process: processName, pid });
            }
          }
        }
      }
    } catch (err) {
      console.error('Error parseando ss/netstat en Linux:', err.message);
    }
  }

  // Ordenar y eliminar duplicados
  const uniquePorts = [];
  const seen = new Set();
  for (const p of ports) {
    const key = p.port + p.address;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePorts.push(p);
    }
  }
  
  uniquePorts.sort((a, b) => a.port - b.port);
  return uniquePorts;
}


// --- Obtener Contenedores Docker ---
async function getDockerContainers() {
  return new Promise((resolve) => {
      const os = require('node:os');
  const path = require('node:path');
  const dockerSockets = [
    '/var/run/docker.sock',
    path.join(os.homedir(), '.docker/run/docker.sock')
  ];
  let sockPath = dockerSockets.find(s => fs.existsSync(s));
  if (!sockPath) return resolve([]);
    const http = require('http');
    const req = http.request({
      socketPath: sockPath,
      path: '/v1.41/containers/json?all=1',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const containers = JSON.parse(data);
          const mapped = containers.map(c => {
            const ports = (c.Ports || []).filter(p => p.PublicPort).map(p => p.PublicPort);
            return {
              id: c.Id.substring(0, 12),
              name: (c.Names[0] || '').replace(/^\//, ''),
              image: c.Image,
              state: c.State,
              status: c.Status,
              ports: [...new Set(ports)]
            };
          });
          resolve(mapped);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// --- Obtener Sitios Apache ---
async function getApacheSites() {
  const os = require('node:os');
  const fsp = require('node:fs/promises');
  const fs = require('node:fs');
  const path = require('node:path');
  const { execSync } = require('node:child_process');

  const sitesMap = new Map();

  function detectStack(dirPath) {
    try {
      if (fs.existsSync(path.join(dirPath, 'index.php')) || fs.existsSync(path.join(dirPath, 'artisan'))) return 'PHP';
      if (fs.existsSync(path.join(dirPath, 'package.json'))) return 'Node.js';
      if (fs.existsSync(path.join(dirPath, 'index.html'))) return 'HTML/Estático';
    } catch(e) {}
    return 'Desconocido';
  }

  try {
    let configOut = '';
    try {
      configOut = execSync('grep -E -i -h "^Alias |^DocumentRoot " /usr/local/etc/httpd/httpd.conf /usr/local/etc/httpd/extra/*.conf /etc/apache2/apache2.conf /etc/apache2/sites-enabled/*.conf /etc/httpd/conf/httpd.conf 2>/dev/null', { encoding: 'utf8' });
    } catch(e) {
      if (e.stdout) configOut = e.stdout;
    }

    let docRoots = [];
    if (configOut) {
      const lines = configOut.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith('alias ')) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 3) {
            let aliasName = parts[1].replace(/^\//, '').replace(/\/$/, '');
            let aliasPath = trimmed.substring(trimmed.indexOf(parts[2])).replace(/['"]/g, '');
            if (aliasName && !aliasName.includes('icons') && !aliasName.includes('error') && !aliasName.includes('uploads')) {
              sitesMap.set(aliasName, { name: aliasName, stack: detectStack(aliasPath) });
            }
          }
        } else if (trimmed.toLowerCase().startsWith('documentroot ')) {
           const match = trimmed.match(/DocumentRoot\s+["']?([^"']+)["']?/i);
           if (match && match[1]) docRoots.push(match[1]);
        }
      }
    }

    if (docRoots.length === 0) {
      docRoots = [ process.env.APACHE_DIR, '/var/www/html', '/Library/WebServer/Documents', '/Applications/MAMP/htdocs', '/Applications/XAMPP/xamppfiles/htdocs', '/usr/local/var/www' ];
    }
    
    for (const dir of docRoots) {
      if (dir && fs.existsSync(dir)) {
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.')) {
              if (!sitesMap.has(e.name)) {
                sitesMap.set(e.name, { name: e.name, stack: detectStack(path.join(dir, e.name)) });
              }
            }
          }
        } catch(e) {}
      }
    }
  } catch(e) {}

  return Array.from(sitesMap.values());
}

// --- Obtener Proyectos y Sitios de Webroot ---
async function getWebrootSites() {
  try {
    if (!fs.existsSync(WEBROOT_DIR)) {
      return [];
    }
    const entries = await fsp.readdir(WEBROOT_DIR, { withFileTypes: true });
    const pm2List = getPm2Processes();
    const sites = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const fullPath = path.join(WEBROOT_DIR, folderName);

      // Si es cpanel o la carpeta donde corre este server, no lo mostramos como sitio secundario
      if (folderName === 'cpanel' || fullPath === __dirname) continue;

      let packageJson = null;
      let projectType = 'Estático / HTML';
      let gitBranch = null;

      // Check package.json
      try {
        const pkgContent = await fsp.readFile(path.join(fullPath, 'package.json'), 'utf8');
        packageJson = JSON.parse(pkgContent);
        if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
          projectType = 'Next.js';
        } else if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
          projectType = 'React';
        } else if (packageJson.dependencies?.express) {
          projectType = 'Node.js (Express)';
        } else {
          projectType = 'Node.js';
        }
      } catch (e) {
        // Check Python
        try {
          if (fs.existsSync(path.join(fullPath, 'main.py')) || fs.existsSync(path.join(fullPath, 'app.py')) || fs.existsSync(path.join(fullPath, 'requirements.txt'))) {
            projectType = 'Python';
          }
        } catch (e2) {}
      }

      // Check Git
      try {
        if (fs.existsSync(path.join(fullPath, '.git'))) {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fullPath, encoding: 'utf8', timeout: 1000 }).trim();
          gitBranch = branch;
        }
      } catch (e) {}

      // Asociar con proceso PM2
      const matchedPm2 = pm2List.filter(p => p.cwd.startsWith(fullPath) || fullPath.toLowerCase().includes(p.name.toLowerCase()));
      const mainPm2 = matchedPm2[0] || null;

      sites.push({
        name: folderName,
        path: fullPath,
        type: projectType,
        package: packageJson ? {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description
        } : null,
        gitBranch,
        pm2: mainPm2 ? {
          id: mainPm2.id,
          name: mainPm2.name,
          status: mainPm2.status,
          port: mainPm2.port,
          cpu: mainPm2.cpu,
          memory: mainPm2.memory
        } : null
      });
    }

    return sites;
  } catch (err) {
    console.error('Error al escanear webroot:', err.message);
    return [];
  }
}

// --- Servidor HTTP ---
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.md': 'text/markdown; charset=utf-8'
};


const CPANEL_PIN = process.env.CPANEL_PIN || '123456';
const AUTH_COOKIE = 'cpanel_token=' + require('crypto').createHash('sha256').update(CPANEL_PIN + 'salt').digest('hex');

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // RUTAS PÚBLICAS O DE AUTENTICACIÓN
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { pin } = JSON.parse(body);
        if (pin === CPANEL_PIN) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `${AUTH_COOKIE}; Path=/; HttpOnly; Max-Age=2592000`
          });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'PIN incorrecto' }));
        }
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // LOGOUT
  if (pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `cpanel_token=; Path=/; HttpOnly; Max-Age=0`
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Middleware de Autenticación para APIs privadas
  const isApi = pathname.startsWith('/api/');
  const hasAuth = req.headers.cookie && req.headers.cookie.includes(AUTH_COOKIE);
  if (isApi && !hasAuth) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No autenticado' }));
    return;
  }

  const method = req.method;

  // Habilitar CORS para llamadas locales
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helper para responder JSON
  const sendJson = (data, statusCode = 200) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  // Helper para leer body JSON
  const readJsonBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

  try {
    // --- API ROUTES ---

    // 1. Estado general del sistema
    if (pathname === '/api/status' && method === 'GET') {
      const stats = await getSystemStats();
      return sendJson(stats);
    }

    // 2. Lista de procesos PM2
    if (pathname === '/api/pm2' && method === 'GET') {
      const list = getPm2Processes();
      return sendJson(list);
    }

    // 3. Acciones de PM2 (restart, stop, start, flush, save)
    if (pathname === '/api/pm2/action' && method === 'POST') {
      const body = await readJsonBody();
      const { action, id } = body;
      const allowedActions = ['restart', 'stop', 'start', 'reload', 'flush', 'save'];

      if (!allowedActions.includes(action)) {
        return sendJson({ error: 'Acción no permitida' }, 400);
      }

      let cmd = '';
      if (action === 'save') {
        cmd = 'pm2 save';
      } else if (action === 'flush') {
        cmd = id !== undefined && id !== null && id !== 'all' ? `pm2 flush ${parseInt(id, 10)}` : 'pm2 flush';
      } else {
        const target = id === 'all' || id === undefined ? 'all' : parseInt(id, 10);
        cmd = `pm2 ${action} ${target}`;
      }

      exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          return sendJson({ error: error.message, stderr }, 500);
        }
        return sendJson({ success: true, message: `Ejecutado: ${cmd}`, output: stdout });
      });
      return;
    }

    // 4. Logs de PM2
    if (pathname === '/api/pm2/logs' && method === 'GET') {
      const id = parsedUrl.searchParams.get('id');
      const type = parsedUrl.searchParams.get('type') === 'error' ? 'error' : 'out';
      const lines = Math.min(parseInt(parsedUrl.searchParams.get('lines') || '80', 10), 300);

      const processes = getPm2Processes();
      const proc = processes.find(p => String(p.id) === String(id));

      if (!proc) {
        return sendJson({ error: 'Proceso PM2 no encontrado' }, 404);
      }

      const logPath = type === 'error' ? proc.errLog : proc.outLog;
      if (!logPath || !fs.existsSync(logPath)) {
        return sendJson({ logs: `(No hay archivo de registro para ${type})` });
      }

      exec(`tail -n ${lines} "${logPath}"`, { timeout: 3000 }, (error, stdout) => {
        if (error) {
          return sendJson({ error: 'Error al leer logs: ' + error.message }, 500);
        }
        return sendJson({ success: true, logs: stdout || '(El registro está vacío)' });
      });
      return;
    }

    // 5. Sitios de Webroot
    if (pathname === '/api/sites' && method === 'GET') {
      const sites = await getWebrootSites();
      return sendJson(sites);
    }

    // 6. Puertos abiertos
    if (pathname === '/api/ports' && method === 'GET') {
      const ports = getOpenPorts();
      return sendJson(ports);
    }

    // 7. Explorador de archivos (listar)
    if (pathname === '/api/files' && method === 'GET') {
      if (!fs.existsSync(WEBROOT_DIR)) {
        return sendJson({ currentPath: '', parentPath: null, items: [] });
      }
      const relPath = (parsedUrl.searchParams.get('path') || '').replace(/^[/\\]+/, '');
      const targetDir = path.resolve(WEBROOT_DIR, relPath);

      // Seguridad: no salir de WEBROOT_DIR
      if (!targetDir.startsWith(WEBROOT_DIR)) {
        return sendJson({ error: 'Acceso no autorizado' }, 403);
      }

      if (!fs.existsSync(targetDir)) {
        return sendJson({ error: 'Ruta no encontrada' }, 404);
      }

      const stat = await fsp.stat(targetDir);
      if (!stat.isDirectory()) {
        return sendJson({ error: 'La ruta no es un directorio' }, 400);
      }

      const dirEntries = await fsp.readdir(targetDir, { withFileTypes: true });
      const items = [];

      for (const entry of dirEntries) {
        const itemPath = path.join(targetDir, entry.name);
        try {
          const itemStat = await fsp.stat(itemPath);
          items.push({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: itemStat.size,
            mtime: itemStat.mtime,
            extension: path.extname(entry.name).toLowerCase()
          });
        } catch (e) {
          // Si no hay permiso para leer algún archivo
        }
      }

      // Ordenar: primero carpetas, luego alfabético
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      const parentPath = targetDir === WEBROOT_DIR ? null : path.relative(WEBROOT_DIR, path.dirname(targetDir));

      return sendJson({
        currentPath: relPath,
        parentPath: parentPath === '' ? '/' : parentPath,
        items
      });
    }

    // 8. Explorador de archivos (leer contenido)
    if (pathname === '/api/files/read' && method === 'GET') {
      const relPath = (parsedUrl.searchParams.get('path') || '').replace(/^[/\\]+/, '');
      const targetFile = path.resolve(WEBROOT_DIR, relPath);

      if (!targetFile.startsWith(WEBROOT_DIR)) {
        return sendJson({ error: 'Acceso no autorizado' }, 403);
      }

      if (!fs.existsSync(targetFile)) {
        return sendJson({ error: 'Archivo no encontrado' }, 404);
      }

      const stat = await fsp.stat(targetFile);
      if (stat.isDirectory()) {
        return sendJson({ error: 'Es un directorio' }, 400);
      }

      if (stat.size > 1.5 * 1024 * 1024) { // 1.5 MB limit
        return sendJson({ error: 'Archivo demasiado grande para previsualizar (> 1.5 MB)' }, 400);
      }

      const content = await fsp.readFile(targetFile, 'utf8');
      return sendJson({
        filename: path.basename(targetFile),
        path: relPath,
        size: stat.size,
        content
      });
    }

    // 9. Ejecución de comandos de terminal
    if (pathname === '/api/terminal' && method === 'POST') {
      const body = await readJsonBody();
      const rawCmd = (body.command || '').trim();

      if (!rawCmd) {
        return sendJson({ error: 'Comando vacío' }, 400);
      }

      // Evitar comandos destructivos accidentales
      const forbidden = ['rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:'];
      for (const f of forbidden) {
        if (rawCmd.includes(f)) {
          return sendJson({ error: 'Comando bloqueado por seguridad' }, 403);
        }
      }

      const termCwd = fs.existsSync(WEBROOT_DIR) ? WEBROOT_DIR : process.cwd();
      exec(rawCmd, { cwd: termCwd, timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        return sendJson({
          command: rawCmd,
          stdout: stdout || '',
          stderr: stderr || (error ? error.message : ''),
          exitCode: error ? (error.code || 1) : 0
        });
      });
      return;
    }

    // 10. Docker Containers
    if (pathname === '/api/docker' && method === 'GET') {
      const list = await getDockerContainers();
      return sendJson(list);
    }

    
    // 12. Docker Actions (Start, Stop, Restart)
    if (pathname === '/api/docker/action' && method === 'POST') {
      const body = await readJsonBody();
      const { id, action } = body; // action: start, stop, restart
      
      const os = require('node:os');
      const path = require('node:path');
      const dockerSockets = ['/var/run/docker.sock', path.join(os.homedir(), '.docker/run/docker.sock')];
      const sockPath = dockerSockets.find(s => fs.existsSync(s));
      
      if (!sockPath) return sendJson({ error: 'Docker no disponible' }, 400);
      
      return new Promise((resolve) => {
        const reqDoc = http.request({
          socketPath: sockPath,
          path: `/v1.41/containers/${id}/${action}`,
          method: 'POST'
        }, (resDoc) => {
          if (resDoc.statusCode >= 200 && resDoc.statusCode < 300 || resDoc.statusCode === 304) {
            resolve(sendJson({ success: true, message: `Contenedor ${action} exitoso` }));
          } else {
            resolve(sendJson({ error: `Error de Docker: ${resDoc.statusCode}` }, resDoc.statusCode));
          }
        });
        reqDoc.on('error', (e) => resolve(sendJson({ error: e.message }, 500)));
        reqDoc.end();
      });
    }

    // 13. Docker Logs
    if (pathname === '/api/docker/logs' && method === 'GET') {
      const id = parsedUrl.searchParams.get('id');
      const os = require('node:os');
      const path = require('node:path');
      const dockerSockets = ['/var/run/docker.sock', path.join(os.homedir(), '.docker/run/docker.sock')];
      const sockPath = dockerSockets.find(s => fs.existsSync(s));
      
      if (!sockPath) return sendJson({ error: 'Docker no disponible' }, 400);

      return new Promise((resolve) => {
        const reqDoc = http.request({
          socketPath: sockPath,
          path: `/v1.41/containers/${id}/logs?stdout=1&stderr=1&tail=120`,
          method: 'GET'
        }, (resDoc) => {
          let data = '';
          resDoc.on('data', chunk => {
            // Docker multiplexes stdout/stderr with a 8-byte header, we just strip non-ascii or render raw for simplicity
            // To be totally clean, we just replace the multiplex headers
            const str = chunk.toString('utf8');
            data += str.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
          });
          resDoc.on('end', () => resolve(sendJson({ success: true, logs: data || '(Sin registros)' })));
        });
        reqDoc.on('error', (e) => resolve(sendJson({ error: e.message }, 500)));
        reqDoc.end();
      });
    }

    // 14. System Services Action (Restart)
    if (pathname === '/api/system/action' && method === 'POST') {
      const body = await readJsonBody();
      const { service } = body;
      
      const isMac = os.platform() === 'darwin';
      let cmd = '';
      
      if (service === 'Apache / Web Server') {
        cmd = isMac ? 'sudo apachectl restart' : 'sudo systemctl restart apache2 || sudo systemctl restart httpd';
      } else if (service === 'MySQL / MariaDB') {
        cmd = isMac ? 'brew services restart mysql || brew services restart mariadb' : 'sudo systemctl restart mysql || sudo systemctl restart mariadb';
      } else if (service === 'PostgreSQL') {
        cmd = isMac ? 'brew services restart postgresql' : 'sudo systemctl restart postgresql';
      } else if (service === 'Redis') {
        cmd = isMac ? 'brew services restart redis' : 'sudo systemctl restart redis';
      }
      
      if (!cmd) return sendJson({ error: 'Servicio no soportado para reinicio automático' }, 400);

      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          // It might require sudo password on Mac if not configured in visudo, handle gracefully
          return sendJson({ error: `El reinicio falló. Podría requerir permisos de administrador. (${error.message})` }, 500);
        }
        return sendJson({ success: true, message: `Servicio ${service} reiniciado correctamente` });
      });
      return;
    }

    // 11. Apache Sites

    if (pathname === '/api/apache' && method === 'GET') {
      const list = await getApacheSites();
      return sendJson(list);
    }

    // --- STATIC FILES ---
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Seguridad: asegurarse de que no salga de PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Prohibido');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      if (ext === '.zip' || ext === '.gz' || ext === '.tar') {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Si no existe, servir index.html (SPA fallback)
    const indexFallback = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexFallback)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexFallback).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 No encontrado');

  } catch (err) {
    console.error('Error en petición:', err);
    sendJson({ error: 'Error interno del servidor: ' + err.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=========================================`);
  console.log(`🚀 DevPanel iniciado con éxito`);
  console.log(`📡 Escuchando en: http://${HOST}:${PORT}`);
  console.log(`🌐 Acceso Local: http://localhost:${PORT}`);
  const ips = getLocalIps();
  ips.forEach(ip => {
    console.log(`🔗 Acceso en Red (${ip.interface}): http://${ip.address}:${PORT}`);
  });
  console.log(`📂 Webroot: ${WEBROOT_DIR}`);
  console.log(`=========================================`);
});
