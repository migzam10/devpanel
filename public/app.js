/**
 * DevPanel - Frontend Application Logic
 */

// Estado global de la aplicación
const state = {
  currentTab: 'dashboard',
  refreshIntervalMs: 5000,
  refreshTimer: null,
  currentLogId: null,
  currentLogName: '',
  currentLogType: 'out',
  logsPollTimer: null,
  currentFilePath: '',
  fileViewRawContent: '',
  systemStatus: null,
  pm2List: [],
  dockerList: [],
  apacheList: [],
  sites: [],
  ports: []
};


async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    document.getElementById('login-modal').style.display = 'flex';
    document.getElementById('login-pin').focus();
    throw new Error('No autenticado');
  }
  return res;
}

async function handleLogin(e) {
  e.preventDefault();
  const pin = document.getElementById('login-pin').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    if (res.ok) {
      document.getElementById('login-modal').style.display = 'none';
      document.getElementById('login-pin').value = '';
      document.getElementById('login-error').style.display = 'none';
      showToast('Acceso concedido', 'success');
      fetchAllData();
    } else {
      document.getElementById('login-error').style.display = 'block';
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

// Add global fetch replacement for all api calls

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupRefreshSelector();
  setupEventListeners();

  // Carga inicial de datos
  fetchAllData();
  startAutoRefresh();
});

// --- PESTAÑAS (TABS) ---
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;

  // Actualizar botones de navegación
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });

  // Actualizar paneles de contenido
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
  });

  // Cargar datos específicos si es necesario
  if (tabId === 'sites' && state.sites.length === 0) {
    loadSites();
  } else if (tabId === 'files' && !state.currentFilePath) {
    browseFolder('');
  } else if (tabId === 'ports' && state.ports.length === 0) {
    loadPorts(),
    loadDocker(),
    loadApache();
  }
}

// --- SELECTOR DE REFRESCO AUTOMÁTICO ---
function setupRefreshSelector() {
  const select = document.getElementById('refresh-interval');
  if (select) {
    select.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      state.refreshIntervalMs = val;
      startAutoRefresh();
      showToast(`Refresco configurado a: ${val === 0 ? 'Pausado' : val / 1000 + 's'}`, 'info');
    });
  }

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchAllData();
      showToast('Datos actualizados', 'info');
    });
  }

  const btnSavePm2 = document.getElementById('btn-save-pm2');
  if (btnSavePm2) {
    btnSavePm2.addEventListener('click', () => savePm2());
  }
}

function startAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  if (state.refreshIntervalMs > 0) {
    state.refreshTimer = setInterval(() => {
      // Si el modal de logs está abierto, los logs tienen su propio timer
      fetchSystemStatus();
      fetchPm2List();
    }, state.refreshIntervalMs);
  }
}

function setupEventListeners() {
  // Tecla Escape cierra modales
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLogsModal();
      closeFileModal();
    }
  });
}

// --- CARGA DE DATOS ---
async function fetchAllData() {
  await Promise.all([
    fetchSystemStatus(),
    fetchPm2List(),
    loadSites(),
    loadPorts()
  ]);
}

// 1. ESTADO DEL SISTEMA
async function fetchSystemStatus() {
  try {
    const res = await apiFetch('/api/status');
    if (!res.ok) throw new Error('Error al obtener estado');
    const data = await res.json();
    state.systemStatus = data;
    renderSystemStatus(data);
  } catch (err) {
    console.error('Error fetching system status:', err);
  }
}

function renderSystemStatus(data) {
  // Topbar
  const topbarIp = document.getElementById('topbar-ip');
  if (topbarIp) {
    const ipStr = data.localIps?.length > 0 ? `${data.localIps[0].address}:${location.port || '8888'}` : 'localhost:8888';
    topbarIp.textContent = `${data.hostname} • ${ipStr}`;
  }

  const topCpu = document.getElementById('top-cpu');
  if (topCpu) topCpu.textContent = `${data.cpuPercent}%`;

  const topRam = document.getElementById('top-ram');
  if (topRam && data.memory) topRam.textContent = `${data.memory.percent}%`;

  const topDisk = document.getElementById('top-disk');
  if (topDisk && data.disk) topDisk.textContent = `${data.disk.percent}%`;

  // Dynamic Webroot & Terminal Title
  if (data.webroot) {
    const webrootEl = document.getElementById('webroot-path-display');
    if (webrootEl) webrootEl.textContent = data.webroot;
  }
  if (data.hostname) {
    const termTitleEl = document.getElementById('term-title-display');
    if (termTitleEl) termTitleEl.textContent = `${data.hostname}:${data.webroot || 'webroot'}`;
  }

  // Dashboard CPU
  const dashCpuVal = document.getElementById('dash-cpu-val');
  if (dashCpuVal) dashCpuVal.textContent = `${data.cpuPercent}%`;

  const dashCpuBar = document.getElementById('dash-cpu-bar');
  if (dashCpuBar) dashCpuBar.style.width = `${Math.min(100, data.cpuPercent)}%`;

  const cpuCores = document.getElementById('cpu-cores');
  if (cpuCores) cpuCores.textContent = `${data.cpusCount} núcleos`;

  const dashLoad = document.getElementById('dash-load');
  if (dashLoad && data.loadavg) {
    dashLoad.textContent = data.loadavg.map(n => n.toFixed(2)).join(', ');
  }

  const dashCpuModel = document.getElementById('dash-cpu-model');
  if (dashCpuModel) dashCpuModel.textContent = data.cpuModel;

  // Dashboard RAM
  if (data.memory) {
    const totalGb = (data.memory.total / (1024 ** 3)).toFixed(1);
    const usedGb = (data.memory.used / (1024 ** 3)).toFixed(1);
    const availGb = (data.memory.available / (1024 ** 3)).toFixed(1);

    const dashRamUsed = document.getElementById('dash-ram-used');
    if (dashRamUsed) dashRamUsed.textContent = `${usedGb} GB`;

    const dashRamTotal = document.getElementById('dash-ram-total');
    if (dashRamTotal) dashRamTotal.textContent = `${totalGb} GB`;

    const dashRamAvail = document.getElementById('dash-ram-avail');
    if (dashRamAvail) dashRamAvail.textContent = `${availGb} GB`;

    const dashRamPercent = document.getElementById('dash-ram-percent');
    if (dashRamPercent) dashRamPercent.textContent = `${data.memory.percent}%`;

    const dashRamBar = document.getElementById('dash-ram-bar');
    if (dashRamBar) dashRamBar.style.width = `${data.memory.percent}%`;
  }

  // Dashboard DISCO
  if (data.disk) {
    const totalGb = (data.disk.total / (1024 ** 3)).toFixed(1);
    const usedGb = (data.disk.used / (1024 ** 3)).toFixed(1);
    const freeGb = (data.disk.available / (1024 ** 3)).toFixed(1);

    const dashDiskUsed = document.getElementById('dash-disk-used');
    if (dashDiskUsed) dashDiskUsed.textContent = `${usedGb} GB`;

    const dashDiskTotal = document.getElementById('dash-disk-total');
    if (dashDiskTotal) dashDiskTotal.textContent = `${totalGb} GB`;

    const dashDiskFree = document.getElementById('dash-disk-free');
    if (dashDiskFree) dashDiskFree.textContent = `${freeGb} GB`;

    const dashDiskPercent = document.getElementById('dash-disk-percent');
    if (dashDiskPercent) dashDiskPercent.textContent = `${data.disk.percent}%`;

    const dashDiskBar = document.getElementById('dash-disk-bar');
    if (dashDiskBar) dashDiskBar.style.width = `${data.disk.percent}%`;
  }

  // Info general del servidor
  const dashHostname = document.getElementById('dash-hostname');
  if (dashHostname) dashHostname.textContent = data.hostname;

  const dashOs = document.getElementById('dash-os');
  if (dashOs) dashOs.textContent = `${data.platform} (${data.release}) - ${data.arch}`;

  const dashUptime = document.getElementById('dash-uptime');
  if (dashUptime) dashUptime.textContent = formatUptime(data.uptime * 1000);

  const dashIps = document.getElementById('dash-ips');
  if (dashIps && data.localIps) {
    dashIps.textContent = data.localIps.map(ip => `${ip.address}`).join(' | ');
  }
}

// 2. LISTA PM2
async function fetchPm2List() {
  try {
    const res = await apiFetch('/api/pm2');
    if (!res.ok) throw new Error('Error al obtener lista PM2');
    const list = await res.json();
    state.pm2List = list;
    renderPm2List(list); renderSystemServices();
  } catch (err) {
    console.error('Error fetching PM2:', err);
  }
}

function renderPm2List(list) {
  // Topbar count
  const onlineCount = list.filter(p => p.status === 'online').length;
  const topOnlineCount = document.getElementById('top-online-count');
  if (topOnlineCount) topOnlineCount.textContent = `${onlineCount}/${list.length} online`;

  const tabPm2Count = document.getElementById('tab-pm2-count');
  if (tabPm2Count) tabPm2Count.textContent = list.length;

  // Render en pestaña PM2
  const tbody = document.getElementById('pm2-tbody');
  if (tbody) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="loading-state">No hay procesos en PM2 registrados</td></tr>';
    } else {
      tbody.innerHTML = list.map(p => {
        const memMb = (p.memory / (1024 * 1024)).toFixed(1);
        const statusClass = p.status === 'online' ? 'online' : (p.status === 'launching' ? 'restarting' : 'stopped');
        const portDisplay = p.port ? `<a href="http://${location.hostname}:${p.port}" target="_blank" class="badge-tag info" style="text-decoration:none;">:${p.port} ↗</a>` : '<span class="text-dim">--</span>';

        return `
          <tr>
            <td><strong>#${p.id}</strong></td>
            <td>
              <strong>${escapeHtml(p.name)}</strong>
              <div class="text-dim" style="font-size:0.75rem;">PID: ${p.pid || '--'} | Modo: ${p.mode}</div>
            </td>
            <td><span class="badge-tag ${statusClass}">● ${p.status}</span></td>
            <td>${portDisplay}</td>
            <td style="font-family: var(--font-mono);">${p.cpu}%</td>
            <td style="font-family: var(--font-mono);">${memMb} MB</td>
            <td>${formatUptime(p.uptime)}</td>
            <td>${p.restarts}</td>
            <td>
              <div class="btn-group">
                <button class="btn btn-secondary btn-xs" onclick="pm2Action('restart', ${p.id})" title="Reiniciar">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                  Reiniciar
                </button>
                ${p.status === 'online' ? `
                  <button class="btn btn-subtle btn-xs text-danger" onclick="pm2Action('stop', ${p.id})" title="Detener">
                    ⏹️ Detener
                  </button>
                ` : `
                  <button class="btn btn-success btn-xs" onclick="pm2Action('start', ${p.id})" title="Iniciar">
                    ▶️ Iniciar
                  </button>
                `}
                <button class="btn btn-secondary btn-xs" onclick="openLogsModal(${p.id}, '${escapeHtml(p.name)}')" title="Ver Registros">
                  📋 Logs
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render rápido en Dashboard
  const dashQuickPm2 = document.getElementById('dash-quick-pm2');
  if (dashQuickPm2) {
    if (list.length === 0) {
      dashQuickPm2.innerHTML = '<div class="loading-state">No hay procesos activos en PM2</div>';
    } else {
      dashQuickPm2.innerHTML = list.slice(0, 7).map(p => {
        const memMb = (p.memory / (1024 * 1024)).toFixed(0);
        const statusClass = p.status === 'online' ? 'online' : 'stopped';
        return `
          <div class="quick-pm2-item">
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              <span class="text-dim" style="font-size:0.75rem; margin-left:6px;">#${p.id}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="text-muted" style="font-size:0.75rem; font-family:var(--font-mono);">${memMb} MB</span>
              <span class="badge-tag ${statusClass}">● ${p.status}</span>
              <button class="btn btn-subtle btn-xs" onclick="pm2Action('restart', ${p.id})">🔄</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// 3. SITIOS EN WEBROOT
async function loadSites() {
  try {
    const res = await apiFetch('/api/sites');
    if (!res.ok) throw new Error('Error al cargar sitios');
    const sites = await res.json();
    state.sites = sites;
    renderSites(sites);
  } catch (err) {
    console.error('Error loading sites:', err);
  }
}

function renderSites(sites) {
  const tabSitesCount = document.getElementById('tab-sites-count');
  if (tabSitesCount) tabSitesCount.textContent = sites.length;

  const sitesGrid = document.getElementById('sites-grid');
  if (sitesGrid) {
    if (sites.length === 0) {
      sitesGrid.innerHTML = '<div class="loading-state">No se encontraron proyectos en webroot</div>';
    } else {
      sitesGrid.innerHTML = sites.map(s => {
        const hasPm2 = !!s.pm2;
        const port = s.pm2?.port;
        const portUrl = port ? `http://${location.hostname}:${port}` : null;
        const isOnline = s.pm2?.status === 'online';

        return `
          <div class="site-card">
            <div>
              <div class="site-header">
                <h3 class="site-title">${escapeHtml(s.name)}</h3>
                <span class="site-badge">${s.type}</span>
              </div>
              <div class="site-meta" style="margin-top: 10px;">
                ${s.gitBranch ? `<div><strong>Rama Git:</strong> <code style="color:#a78bfa;">${escapeHtml(s.gitBranch)}</code></div>` : ''}
                ${s.package ? `<div><strong>Versión:</strong> ${escapeHtml(s.package.version || '1.0.0')}</div>` : ''}
                <div>
                  <strong>Servicio PM2:</strong>
                  ${hasPm2 ? `
                    <span class="badge-tag ${isOnline ? 'online' : 'stopped'}">
                      ● ${escapeHtml(s.pm2.name)} (#${s.pm2.id})
                    </span>
                  ` : '<span class="text-dim">Sin proceso directo</span>'}
                </div>
              </div>
            </div>

            <div class="site-footer">
              <button class="btn btn-secondary btn-sm" onclick="exploreSiteFiles('${escapeHtml(s.name)}')">
                📁 Archivos
              </button>
              ${portUrl ? `
                <a href="${portUrl}" target="_blank" class="btn btn-primary btn-sm">
                  Abrir Sitio (${port}) ↗
                </a>
              ` : `
                <span class="text-dim" style="font-size:0.8rem;">Sin puerto HTTP</span>
              `}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render en Dashboard (Sitios Rápidos)
  const dashQuickSites = document.getElementById('dash-quick-sites');
  if (dashQuickSites) {
    dashQuickSites.innerHTML = sites.map(s => {
      const port = s.pm2?.port;
      const portUrl = port ? `http://${location.hostname}:${port}` : null;
      return `
        <div class="quick-site-card">
          <div>
            <div class="quick-site-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
            <span class="text-dim" style="font-size:0.75rem;">${s.type}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            ${s.pm2 ? `<span class="badge-tag ${s.pm2.status === 'online' ? 'online' : 'stopped'}" style="font-size:0.7rem;">● ${s.pm2.status}</span>` : '<span></span>'}
            ${portUrl ? `<a href="${portUrl}" target="_blank" class="btn btn-primary btn-xs" style="text-decoration:none;">Abrir :${port} ↗</a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function exploreSiteFiles(folderName) {
  switchTab('files');
  browseFolder(folderName);
}

// 4. EXPLORADOR DE ARCHIVOS
async function browseFolder(relPath) {
  state.currentFilePath = relPath;
  const tbody = document.getElementById('files-tbody');
  const btnUp = document.getElementById('btn-up-folder');
  const breadcrumb = document.getElementById('file-breadcrumb');

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Cargando directorio...</td></tr>';
  }

  try {
    const res = await apiFetch(`/api/files?path=${encodeURIComponent(relPath)}`);
    if (!res.ok) throw new Error('Error al listar archivos');
    const data = await res.json();

    // Actualizar botón subir
    if (btnUp) {
      btnUp.disabled = data.parentPath === null;
      btnUp.onclick = () => browseFolder(data.parentPath || '');
    }

    // Actualizar migas de pan (Breadcrumbs)
    if (breadcrumb) {
      const parts = relPath.split('/').filter(Boolean);
      let html = `<span class="crumb-item" onclick="browseFolder('')">webroot</span>`;
      let accumPath = '';
      parts.forEach(p => {
        accumPath += (accumPath ? '/' : '') + p;
        const cur = accumPath;
        html += ` <span style="color:var(--text-dim);">/</span> <span class="crumb-item" onclick="browseFolder('${escapeHtml(cur)}')">${escapeHtml(p)}</span>`;
      });
      breadcrumb.innerHTML = html;
    }

    // Renderizar tabla
    if (tbody) {
      if (data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Carpeta vacía</td></tr>';
      } else {
        tbody.innerHTML = data.items.map(item => {
          const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;
          const isDir = item.isDirectory;
          const icon = isDir ? '📁' : getFileIcon(item.extension);
          const sizeStr = isDir ? '--' : formatBytes(item.size);
          const dateStr = new Date(item.mtime).toLocaleString();

          return `
            <tr>
              <td style="font-size:1.1rem; text-align:center;">${icon}</td>
              <td>
                ${isDir ? `
                  <span class="file-row-dir" onclick="browseFolder('${escapeHtml(itemRelPath)}')">${escapeHtml(item.name)}/</span>
                ` : `
                  <span>${escapeHtml(item.name)}</span>
                `}
              </td>
              <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-muted);">${sizeStr}</td>
              <td style="font-size:0.8rem; color:var(--text-dim);">${dateStr}</td>
              <td>
                ${isDir ? `
                  <button class="btn btn-secondary btn-xs" onclick="browseFolder('${escapeHtml(itemRelPath)}')">Abrir</button>
                ` : `
                  <button class="btn btn-secondary btn-xs" onclick="viewFileContent('${escapeHtml(itemRelPath)}')">Ver</button>
                `}
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="loading-state text-danger">Error: ${err.message}</td></tr>`;
  }
}

function goUpFolder() {
  const parts = state.currentFilePath.split('/').filter(Boolean);
  parts.pop();
  browseFolder(parts.join('/'));
}

async function viewFileContent(filePath) {
  try {
    const res = await apiFetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error al leer archivo');
    }
    const data = await res.json();
    state.fileViewRawContent = data.content;

    document.getElementById('file-view-title').textContent = data.filename;
    document.getElementById('file-view-size').textContent = `${formatBytes(data.size)} • ${data.path}`;
    document.getElementById('file-view-content').textContent = data.content;
    document.getElementById('file-modal').style.display = 'flex';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeFileModal() {
  document.getElementById('file-modal').style.display = 'none';
}

function copyFileContent() {
  if (navigator.clipboard && state.fileViewRawContent) {
    navigator.clipboard.writeText(state.fileViewRawContent).then(() => {
      showToast('Contenido copiado al portapapeles', 'success');
    });
  }
}

// 5. PUERTOS Y RED
async function loadPorts() {
  const tbody = document.getElementById('ports-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Escaneando puertos...</td></tr>';

  try {
    const res = await apiFetch('/api/ports');
    if (!res.ok) throw new Error('Error al escanear puertos');
    const ports = await res.json();
    state.ports = ports;
    renderPorts(ports); renderSystemServices();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="loading-state text-danger">Error: ${err.message}</td></tr>`;
  }
}

function renderPorts(ports) {
  const tbody = document.getElementById('ports-tbody');
  if (!tbody) return;

  if (ports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-state">No se detectaron puertos TCP activos</td></tr>';
    return;
  }

  tbody.innerHTML = ports.map(p => {
    const isLocalhost = p.address === '127.0.0.1' || p.address === '::1';
    const host = isLocalhost ? 'localhost' : location.hostname;
    const url = `http://${host}:${p.port}`;
    
    let type = 'Desconocido/Manual';
    let typeClass = 'stopped';
    
    if (state.pm2List.find(pm2 => pm2.port === p.port)) {
        type = 'PM2';
        typeClass = 'online';
    } else if (state.dockerList.find(d => d.ports.includes(p.port))) {
        type = 'Docker';
        typeClass = 'info';
    } else if (p.port === 80 || p.port === 8080 || p.process.toLowerCase().includes('apache') || p.process.toLowerCase().includes('httpd') || p.process.toLowerCase().includes('nginx')) {
        type = 'Apache/Web';
        typeClass = 'restarting';
    } else if (p.process.toLowerCase().includes('python')) {
        type = 'Python Manual';
        typeClass = 'online';
    } else if (p.process.toLowerCase().includes('node')) {
        type = 'Node Manual';
        typeClass = 'online';
    }

    return `
      <tr>
        <td><strong style="font-family:var(--font-mono); color:#38bdf8;">:${p.port}</strong></td>
        <td><code style="color:var(--text-muted);">${escapeHtml(p.address)}</code></td>
        <td><strong>${escapeHtml(p.process)}</strong> <span class="badge-tag ${typeClass}" style="margin-left: 8px; font-size:0.7rem;">${type}</span></td>
        <td style="color:var(--text-dim);">${p.pid || '--'}</td>
        <td>
          <a href="${url}" target="_blank" class="btn btn-secondary btn-xs" style="text-decoration:none;">
            Probar enlace ↗
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

// 6. ACCIONES DE PM2
async function pm2Action(action, id) {
  try {
    showToast(`Ejecutando ${action} en #${id}...`, 'info');
    const res = await apiFetch('/api/pm2/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, 'success');
      setTimeout(() => fetchPm2List(), 1000);
    } else {
      showToast(result.error || 'Error al ejecutar acción', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function executePm2GlobalAction(action) {
  if (!confirm(`¿Estás seguro de que deseas ejecutar '${action}' en todos los procesos de PM2?`)) return;
  pm2Action(action, 'all');
}

async function savePm2() {
  try {
    showToast('Guardando estado de PM2 (pm2 save)...', 'info');
    const res = await apiFetch('/api/pm2/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save' })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Configuración de PM2 guardada con éxito', 'success');
    } else {
      showToast(result.error || 'Error al guardar PM2', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 7. MODAL DE LOGS PM2
function openLogsModal(id, name) {
  state.currentLogId = id;
  state.currentLogName = name;
  state.currentLogType = 'out';

  document.getElementById('logs-title').textContent = `Logs: ${name}`;
  document.getElementById('logs-subtitle').textContent = `ID #${id}`;
  document.getElementById('logs-modal').style.display = 'flex';

  updateLogTypeButtons();
  fetchCurrentLogs();

  // Iniciar auto-refresco de logs cada 2.5s
  if (state.logsPollTimer) clearInterval(state.logsPollTimer);
  state.logsPollTimer = setInterval(fetchCurrentLogs, 2500);
}

function closeLogsModal() {
  document.getElementById('logs-modal').style.display = 'none';
  document.getElementById('btn-log-out').style.display = 'inline-block';
  document.getElementById('btn-log-err').style.display = 'inline-block';
  if (state.logsPollTimer) {
    clearInterval(state.logsPollTimer);
    state.logsPollTimer = null;
  }
}

function setLogType(type) {
  state.currentLogType = type;
  updateLogTypeButtons();
  fetchCurrentLogs();
}

function updateLogTypeButtons() {
  const btnOut = document.getElementById('btn-log-out');
  const btnErr = document.getElementById('btn-log-err');
  if (btnOut && btnErr) {
    btnOut.classList.toggle('active', state.currentLogType === 'out');
    btnErr.classList.toggle('active', state.currentLogType === 'error');
  }
}

async function fetchCurrentLogs() {
  if (state.currentLogId === null) return;
  try {
    
    let url = `/api/pm2/logs?id=${state.currentLogId}&type=${state.currentLogType}&lines=120`;
    if (state.currentLogType === 'docker') {
      url = `/api/docker/logs?id=${state.currentLogId}`;
    }
    const res = await apiFetch(url);

    if (!res.ok) throw new Error('Error al obtener registros');
    const data = await res.json();

    const pre = document.getElementById('logs-content');
    if (pre) {
      pre.textContent = data.logs || '(Sin registros)';
      const autoScroll = document.getElementById('auto-scroll-logs');
      if (autoScroll && autoScroll.checked) {
        pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
      }
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

async function flushCurrentLogs() {
  if (state.currentLogId === null) return;
  try {
    await apiFetch('/api/pm2/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'flush', id: state.currentLogId })
    });
    showToast('Logs limpiados', 'info');
    fetchCurrentLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 8. TERMINAL INTERACTIVA
async function handleTerminalSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('term-input');
  if (!input) return;
  const cmd = input.value.trim();
  if (!cmd) return;

  input.value = '';
  executeCommand(cmd);
}

function runQuickCmd(cmd) {
  executeCommand(cmd);
}

function clearTerminal() {
  const out = document.getElementById('term-output');
  if (out) out.innerHTML = '';
}

async function executeCommand(cmd) {
  const out = document.getElementById('term-output');
  if (!out) return;

  // Imprimir línea de comando
  const cmdLine = document.createElement('div');
  cmdLine.className = 'term-line cmd';
  cmdLine.textContent = `$ ${cmd}`;
  out.appendChild(cmdLine);
  out.scrollTop = out.scrollHeight;

  try {
    const res = await apiFetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();

    if (data.stdout) {
      const line = document.createElement('div');
      line.className = 'term-line';
      line.textContent = data.stdout;
      out.appendChild(line);
    }

    if (data.stderr) {
      const errLine = document.createElement('div');
      errLine.className = 'term-line error';
      errLine.textContent = data.stderr;
      out.appendChild(errLine);
    }

    if (!data.stdout && !data.stderr) {
      const line = document.createElement('div');
      line.className = 'term-line text-dim';
      line.textContent = '(Comando completado sin salida)';
      out.appendChild(line);
    }
  } catch (err) {
    const errLine = document.createElement('div');
    errLine.className = 'term-line error';
    errLine.textContent = `Error de red: ${err.message}`;
    out.appendChild(errLine);
  }

  out.scrollTop = out.scrollHeight;
}

// --- UTILIDADES ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(ms) {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getFileIcon(ext) {
  switch (ext) {
    case '.js': case '.ts': case '.jsx': case '.tsx': return '📄';
    case '.json': return '📦';
    case '.html': return '🌐';
    case '.css': return '🎨';
    case '.md': return '📝';
    case '.env': return '🔑';
    case '.png': case '.jpg': case '.jpeg': case '.svg': return '🖼️';
    case '.py': return '🐍';
    default: return '📄';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}


// --- NUEVOS: DOCKER Y APACHE ---
async function loadDocker() {
  try {
    const res = await apiFetch('/api/docker');
    const data = await res.json();
    state.dockerList = data;
    renderDocker(data); renderSystemServices();
    loadPorts(); // Recargar puertos para actualizar etiquetas
  } catch(e) {}
}

function renderDocker(list) {
  const countEl = document.getElementById('tab-docker-count');
  if (countEl) countEl.textContent = list.length;
  const tbody = document.getElementById('docker-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="4">No hay contenedores Docker</td></tr>'; return; }
  tbody.innerHTML = list.map(c => {
    const isRunning = c.state === 'running';
    const statusClass = isRunning ? 'online' : (c.state === 'exited' ? 'stopped' : 'restarting');
    const ports = c.ports.map(p => `<a href="http://${location.hostname}:${p}" target="_blank" class="badge-tag info" style="text-decoration:none;">:${p} ↗</a>`).join(' ');
    return `<tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td><span class="badge-tag" style="background:var(--bg-lighter);border:1px solid var(--border);color:var(--text);">${escapeHtml(c.image.split(':')[0])}</span></td>
      <td><span class="badge-tag ${statusClass}">● ${escapeHtml(c.status)}</span></td>
      <td>${ports || '<span class="text-dim">Interno</span>'}</td>
      <td>
        <div class="btn-group">
          ${isRunning ? 
            `<button class="btn btn-secondary btn-xs" onclick="dockerAction('restart', '${c.id}')" title="Reiniciar">🔄</button>
             <button class="btn btn-subtle btn-xs text-danger" onclick="dockerAction('stop', '${c.id}')" title="Detener">⏹️</button>` : 
            `<button class="btn btn-success btn-xs" onclick="dockerAction('start', '${c.id}')" title="Iniciar">▶️</button>`}
          <button class="btn btn-secondary btn-xs" onclick="openDockerLogs('${c.id}', '${escapeHtml(c.name)}')" title="Ver Registros">📋 Logs</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function loadApache() {
  try {
    const res = await apiFetch('/api/apache');
    const data = await res.json();
    state.apacheList = data;
    renderApache(data);
  } catch(e) {}
}

function renderApache(list) {
  const countEl = document.getElementById('tab-apache-count');
  if (countEl) countEl.textContent = list.length;
  const tbody = document.getElementById('apache-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="2">No hay sitios Apache configurados o el directorio no existe</td></tr>'; return; }
  tbody.innerHTML = list.map(s => {
    return `<tr>
      <td><strong>${escapeHtml(s.name || s)}</strong></td>
      <td><span class="badge-tag" style="background:var(--bg-lighter);border:1px solid var(--border);color:var(--text);">${escapeHtml(s.stack || "Desconocido")}</span></td>
      <td><a href="http://${location.hostname}/${encodeURIComponent(s.name || s)}" target="_blank" class="btn btn-secondary btn-xs" style="text-decoration:none;">Abrir sitio ↗</a></td>
    </tr>`;
  }).join('');
}

function renderSystemServices() {
  const tbody = document.getElementById('dash-system-services');
  if (!tbody) return;

  const services = [
    { name: 'Apache / Web Server', checkPorts: [80, 8080, 443], notes: 'Sirve aplicaciones y sitios web' },
    { name: 'MySQL / MariaDB', checkPorts: [3306, 33060, 33062], notes: 'Base de datos relacional' },
    { name: 'PostgreSQL', checkPorts: [5432], notes: 'Base de datos relacional avanzada' },
    { name: 'MongoDB', checkPorts: [27017], notes: 'Base de datos NoSQL' },
    { name: 'Redis', checkPorts: [6379], notes: 'Caché de memoria' },
    { name: 'SSH', checkPorts: [22], notes: 'Acceso remoto seguro' },
    { name: 'Samba', checkPorts: [445, 139], notes: 'Servidor de archivos' },
    { name: 'Docker Daemon', checkSockets: true, notes: 'Orquestación de contenedores' }
  ];

  let html = '';
  for (const s of services) {
    let isActive = false;
    let portsUsed = [];
    
    if (s.checkPorts && state.ports) {
      for (const p of state.ports) {
        if (s.checkPorts.includes(p.port)) {
          isActive = true;
          portsUsed.push(p.port);
        }
      }
    }
    
    if (s.checkSockets && state.dockerList && state.dockerList.length >= 0) {
      isActive = true; 
      portsUsed = ['socket'];
    }

    if (isActive) {
      portsUsed = [...new Set(portsUsed)];
      html += `<tr>
        <td><strong>${s.name}</strong></td>
        <td><span class="badge-tag info">:${portsUsed.join(', :')}</span></td>
        <td><span class="badge-tag online">● Activo</span></td>
        <td>
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span class="text-dim">${s.notes}</span>
      ${(s.name === 'Apache / Web Server' || s.name.includes('MySQL') || s.name === 'PostgreSQL' || s.name === 'Redis') ? 
        `<button class="btn btn-secondary btn-xs" onclick="restartSystem('${s.name}')">🔄 Reiniciar</button>` : ''}
    </div>
  </td>
      </tr>`;
    }
  }

  // Agregar PM2 general
  if (state.pm2List && state.pm2List.length > 0) {
      html += `<tr>
        <td><strong>PM2 Daemon</strong></td>
        <td><span class="text-dim">Varios</span></td>
        <td><span class="badge-tag online">● Activo</span></td>
        <td><button class="btn btn-secondary btn-xs" onclick="switchTab('pm2')">Gestionar PM2 ↗</button></td>
      </tr>`;
  }

  // Agregar fila final para WEBROOT
  html += `<tr>
    <td><strong>Explorador Webroot</strong></td>
    <td><span class="text-dim">Directorio base</span></td>
    <td><span class="badge-tag info">📁 Directorio</span></td>
    <td>
      <button class="btn btn-secondary btn-xs" onclick="switchTab('files')">Ir a Archivos ↗</button> 
      <button class="btn btn-secondary btn-xs" onclick="switchTab('sites')">Ir a Sitios ↗</button>
    </td>
  </tr>`;

  tbody.innerHTML = html || '<tr><td colspan="4" class="text-dim">No se detectaron servicios del sistema</td></tr>';
}

async function dockerAction(action, id) {
  try {
    showToast(`Ejecutando ${action} en contenedor...`, 'info');
    const res = await apiFetch('/api/docker/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, 'success');
      setTimeout(() => loadDocker(), 1000);
    } else {
      showToast(result.error || 'Error', 'error');
    }
  } catch (err) {
    if (err.message !== 'No autenticado') showToast(err.message, 'error');
  }
}

function openDockerLogs(id, name) {
  state.currentLogId = id;
  state.currentLogName = name;
  state.currentLogType = 'docker'; // special type
  
  document.getElementById('logs-title').textContent = `Docker Logs: ${name}`;
  document.getElementById('logs-subtitle').textContent = `ID ${id}`;
  document.getElementById('logs-modal').style.display = 'flex';

  // Ocultar botones out/err porque Docker los unifica en este endpoint simplificado
  document.getElementById('btn-log-out').style.display = 'none';
  document.getElementById('btn-log-err').style.display = 'none';

  fetchCurrentLogs();
  if (state.logsPollTimer) clearInterval(state.logsPollTimer);
  state.logsPollTimer = setInterval(fetchCurrentLogs, 2500);
}

async function restartSystem(service) {
  if (!confirm(`¿Reiniciar el servicio ${service}?`)) return;
  try {
    showToast(`Reiniciando ${service}...`, 'info');
    const res = await apiFetch('/api/system/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.error || 'Error', 'error');
    }
  } catch (err) {
    if (err.message !== 'No autenticado') showToast(err.message, 'error');
  }
}
