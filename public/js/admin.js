// public/js/admin.js - Painel Administrativo Completo
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  updatePassword,
  getIdToken
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ==================== CONFIGURAÇÃO FIREBASE ====================
const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.firebasestorage.app",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6"
};

// Email do admin autorizado
const ADMIN_EMAIL = "orioncreatoroficial@gmail.com";

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const rtdb = getDatabase(app);

// ==================== ELEMENTOS DO DOM ====================
const loginScreen = document.getElementById('loginScreen');
const adminDashboard = document.getElementById('adminDashboard');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const btnLogout = document.getElementById('btnLogout');

// Dados em cache
let usuariosCache = [];
let planosCache = [];
let pagamentosCache = [];
let logsCache = [];
let estatisticasCache = {
  banners: { rigel: 0, bellatrix: 0, betelgeuse: 0 },
  divulgacao: {},
  cores: {},
  total: 0
};

// ==================== AUTENTICAÇÃO ====================
loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    errorMsg.textContent = '⚠️ Preencha email e senha';
    return;
  }

  // Verificar se é o admin autorizado
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    errorMsg.textContent = '🚫 Acesso negado. Apenas administradores.';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '🔄 Entrando...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    errorMsg.textContent = '';
  } catch (err) {
    console.error('Erro login:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      errorMsg.textContent = '❌ Senha incorreta';
    } else if (err.code === 'auth/user-not-found') {
      errorMsg.textContent = '❌ Usuário não encontrado';
    } else {
      errorMsg.textContent = `❌ Erro: ${err.message}`;
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '🔐 Entrar no Painel';
  }
});

// Enter para login
loginPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

// Observer de autenticação
onAuthStateChanged(auth, async (user) => {
  if (user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    // Admin logado
    loginScreen.classList.add('hidden');
    adminDashboard.classList.add('active');
    
    // Carregar dados
    await carregarTodosDados();
    iniciarListenersRealtime();
    
    // Adicionar log de acesso
    adicionarLog('info', `Admin acessou o painel`);
  } else {
    // Não logado ou não é admin
    loginScreen.classList.remove('hidden');
    adminDashboard.classList.remove('active');
    
    if (user && user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await signOut(auth);
      errorMsg.textContent = '🚫 Acesso restrito ao administrador';
    }
  }
});

// Logout
btnLogout.addEventListener('click', async () => {
  adicionarLog('info', 'Admin saiu do painel');
  await signOut(auth);
});

// ==================== NAVEGAÇÃO POR ABAS ====================
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Remover active de todas
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Ativar selecionada
    tab.classList.add('active');
    const tabId = `tab-${tab.dataset.tab}`;
    document.getElementById(tabId)?.classList.add('active');
  });
});

// ==================== CARREGAR DADOS ====================
async function carregarTodosDados() {
  console.log('📊 Carregando dados do painel...');
  
  try {
    await Promise.all([
      carregarUsuarios(),
      carregarPlanos(),
      carregarPagamentos(),
      carregarLogs(),
      carregarEstatisticas()
    ]);
    
    atualizarDashboard();
    console.log('✅ Dados carregados com sucesso');
  } catch (err) {
    console.error('❌ Erro ao carregar dados:', err);
  }
}

// Carregar usuários (Firestore + RTDB)
async function carregarUsuarios() {
  usuariosCache = [];
  
  try {
    // Tentar Firestore primeiro
    const usersSnap = await getDocs(collection(firestore, 'usuarios'));
    usersSnap.forEach(doc => {
      usuariosCache.push({ id: doc.id, ...doc.data(), source: 'firestore' });
    });
  } catch (err) {
    console.warn('⚠️ Erro Firestore usuarios:', err.message);
  }
  
  try {
    // Também buscar do RTDB
    const rtdbSnap = await get(ref(rtdb, 'usuarios'));
    if (rtdbSnap.exists()) {
      const rtdbUsers = rtdbSnap.val();
      Object.entries(rtdbUsers).forEach(([id, data]) => {
        // Verificar se já existe no cache (evitar duplicatas)
        if (!usuariosCache.find(u => u.id === id)) {
          usuariosCache.push({ id, ...data, source: 'rtdb' });
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ Erro RTDB usuarios:', err.message);
  }
  
  renderizarUsuarios();
  return usuariosCache;
}

// Carregar planos
async function carregarPlanos() {
  planosCache = [];
  
  try {
    const planosSnap = await get(ref(rtdb, 'planos'));
    if (planosSnap.exists()) {
      Object.entries(planosSnap.val()).forEach(([id, data]) => {
        planosCache.push({ id, ...data });
      });
    }
  } catch (err) {
    console.warn('⚠️ Erro ao carregar planos:', err.message);
  }
  
  // Planos padrão se vazio
  if (planosCache.length === 0) {
    planosCache = [
      { id: 'mensal', nome: 'Mensal', preco: 29.90, duracao: 30 },
      { id: 'trimestral', nome: 'Trimestral', preco: 79.90, duracao: 90 },
      { id: 'anual', nome: 'Anual', preco: 249.90, duracao: 365 }
    ];
  }
  
  renderizarPlanos();
  return planosCache;
}

// Carregar pagamentos
async function carregarPagamentos() {
  pagamentosCache = [];
  
  try {
    const pagSnap = await get(ref(rtdb, 'pagamentos'));
    if (pagSnap.exists()) {
      Object.entries(pagSnap.val()).forEach(([id, data]) => {
        pagamentosCache.push({ id, ...data });
      });
    }
  } catch (err) {
    console.warn('⚠️ Erro ao carregar pagamentos:', err.message);
  }
  
  renderizarPagamentos();
  return pagamentosCache;
}

// Carregar logs
async function carregarLogs() {
  logsCache = [];
  
  try {
    const logsSnap = await get(ref(rtdb, 'logs'));
    if (logsSnap.exists()) {
      Object.entries(logsSnap.val()).forEach(([id, data]) => {
        logsCache.push({ id, ...data });
      });
    }
  } catch (err) {
    console.warn('⚠️ Erro ao carregar logs:', err.message);
  }
  
  // Ordenar por timestamp (mais recentes primeiro)
  logsCache.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  
  renderizarLogs();
  return logsCache;
}

// Carregar estatísticas de banners
async function carregarEstatisticas() {
  estatisticasCache = {
    banners: { rigel: 0, bellatrix: 0, betelgeuse: 0 },
    divulgacao: {},
    cores: {},
    total: 0,
    videos: 0
  };
  
  try {
    // Buscar estatísticas do Firestore
    const statsSnap = await get(ref(rtdb, 'estatisticas'));
    if (statsSnap.exists()) {
      const data = statsSnap.val();
      estatisticasCache = { ...estatisticasCache, ...data };
    }
    
    // Buscar banners gerados (contar por modelo)
    const bannersSnap = await getDocs(collection(firestore, 'banners'));
    bannersSnap.forEach(doc => {
      const data = doc.data();
      estatisticasCache.total++;
      
      // Contar por modelo
      const modelo = (data.modelo || data.model || '').toLowerCase();
      if (modelo.includes('rigel')) {
        estatisticasCache.banners.rigel++;
      } else if (modelo.includes('bellatrix')) {
        estatisticasCache.banners.bellatrix++;
      } else if (modelo.includes('betelgeuse')) {
        estatisticasCache.banners.betelgeuse++;
      }
      
      // Contar por cor
      const cor = (data.cor || data.color || 'roxo').toLowerCase();
      estatisticasCache.cores[cor] = (estatisticasCache.cores[cor] || 0) + 1;
    });
    
  } catch (err) {
    console.warn('⚠️ Erro ao carregar estatísticas:', err.message);
  }
  
  renderizarEstatisticas();
  return estatisticasCache;
}

// ==================== RENDERIZAÇÃO ====================

// Atualizar dashboard com totais
function atualizarDashboard() {
  const agora = new Date();
  
  // Total usuários
  document.getElementById('totalUsuarios').textContent = usuariosCache.length;
  
  // Usuários ativos (plano não expirado)
  const ativos = usuariosCache.filter(u => {
    const venc = u.data_expiracao || u.dataExpiracao;
    return venc && new Date(venc) > agora;
  }).length;
  document.getElementById('usuariosAtivos').textContent = ativos;
  
  // Expirados
  document.getElementById('planosExpirados').textContent = usuariosCache.length - ativos;
  
  // Faturamento do mês
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();
  const faturamentoMes = pagamentosCache
    .filter(p => {
      const dataPag = new Date(p.data || p.createdAt);
      return dataPag.getMonth() === mesAtual && 
             dataPag.getFullYear() === anoAtual &&
             (p.status === 'pago' || p.pago);
    })
    .reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
  
  document.getElementById('faturamentoMes').textContent = `R$ ${faturamentoMes.toFixed(2)}`;
  
  // Banners e vídeos gerados
  document.getElementById('bannersGerados').textContent = estatisticasCache.total || '--';
  document.getElementById('videosGerados').textContent = estatisticasCache.videos || '--';
  
  // Estatísticas de modelos
  const totalModelos = estatisticasCache.banners.rigel + estatisticasCache.banners.bellatrix + estatisticasCache.banners.betelgeuse;
  
  document.getElementById('countRigel').textContent = estatisticasCache.banners.rigel;
  document.getElementById('countBellatrix').textContent = estatisticasCache.banners.bellatrix;
  document.getElementById('countBetelgeuse').textContent = estatisticasCache.banners.betelgeuse;
  
  if (totalModelos > 0) {
    document.getElementById('percentRigel').textContent = `${Math.round(estatisticasCache.banners.rigel / totalModelos * 100)}%`;
    document.getElementById('percentBellatrix').textContent = `${Math.round(estatisticasCache.banners.bellatrix / totalModelos * 100)}%`;
    document.getElementById('percentBetelgeuse').textContent = `${Math.round(estatisticasCache.banners.betelgeuse / totalModelos * 100)}%`;
  }
  
  // Renderizar cores
  renderizarCores();
  
  // Últimas atividades
  renderizarUltimasAtividades();
}

// Renderizar tabela de usuários
function renderizarUsuarios() {
  const tbody = document.getElementById('tblUsuarios');
  const searchTerm = (document.getElementById('searchUsuarios')?.value || '').toLowerCase();
  const filterPlano = document.getElementById('filterPlano')?.value || '';
  const filterStatus = document.getElementById('filterStatus')?.value || '';
  
  const agora = new Date();
  
  let usuarios = usuariosCache.filter(u => {
    // Filtro de busca
    if (searchTerm) {
      const nome = (u.nome || u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      if (!nome.includes(searchTerm) && !email.includes(searchTerm)) return false;
    }
    
    // Filtro de plano
    if (filterPlano && (u.plano || '').toLowerCase() !== filterPlano) return false;
    
    // Filtro de status
    if (filterStatus) {
      const venc = u.data_expiracao || u.dataExpiracao;
      const isAtivo = venc && new Date(venc) > agora;
      const isSuspenso = u.suspenso || u.status === 'suspenso';
      
      if (filterStatus === 'ativo' && (!isAtivo || isSuspenso)) return false;
      if (filterStatus === 'expirado' && isAtivo) return false;
      if (filterStatus === 'suspenso' && !isSuspenso) return false;
    }
    
    return true;
  });
  
  if (usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Nenhum usuário encontrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = usuarios.map(u => {
    const venc = u.data_expiracao || u.dataExpiracao;
    const isAtivo = venc && new Date(venc) > agora;
    const isSuspenso = u.suspenso || u.status === 'suspenso';
    
    let statusBadge = '';
    if (isSuspenso) {
      statusBadge = '<span class="badge badge-warning">Suspenso</span>';
    } else if (isAtivo) {
      statusBadge = '<span class="badge badge-success">Ativo</span>';
    } else {
      statusBadge = '<span class="badge badge-danger">Expirado</span>';
    }
    
    const vencFormatado = venc ? new Date(venc).toLocaleDateString('pt-BR') : '--';
    
    return `
      <tr>
        <td>${escapeHtml(u.nome || u.name || '--')}</td>
        <td>${escapeHtml(u.email || '--')}</td>
        <td>${escapeHtml(u.plano || 'Sem plano')}</td>
        <td>${statusBadge}</td>
        <td>${vencFormatado}</td>
        <td>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="editarUsuario('${u.id}')" style="padding: 6px 12px; font-size: 0.8rem;">✏️ Editar</button>
            <button class="btn btn-ghost" onclick="toggleSuspensao('${u.id}', ${!isSuspenso})" style="padding: 6px 12px; font-size: 0.8rem;">${isSuspenso ? '✅ Ativar' : '⏸️ Suspender'}</button>
            <button class="btn btn-danger" onclick="excluirUsuario('${u.id}', '${escapeHtml(u.email || u.nome || u.id)}')" style="padding: 6px 12px; font-size: 0.8rem;">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Renderizar tabela de planos
function renderizarPlanos() {
  const tbody = document.getElementById('tblPlanos');
  
  if (planosCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Nenhum plano cadastrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = planosCache.map(p => {
    const usuariosDoPlano = usuariosCache.filter(u => (u.plano || '').toLowerCase() === p.id.toLowerCase()).length;
    
    return `
      <tr>
        <td>${escapeHtml(p.id)}</td>
        <td>${escapeHtml(p.nome || p.id)}</td>
        <td>R$ ${parseFloat(p.preco || 0).toFixed(2)}</td>
        <td>${p.duracao || 30} dias</td>
        <td>${usuariosDoPlano}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost" onclick="editarPlano('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">✏️</button>
            <button class="btn btn-danger" onclick="removerPlano('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Renderizar tabela de pagamentos
function renderizarPagamentos() {
  const tbody = document.getElementById('tblPagamentos');
  const searchTerm = (document.getElementById('searchPagamentos')?.value || '').toLowerCase();
  const filterStatus = document.getElementById('filterPagamentoStatus')?.value || '';
  
  let pagamentos = pagamentosCache.filter(p => {
    if (searchTerm) {
      const user = (p.user_email || p.usuario || '').toLowerCase();
      if (!user.includes(searchTerm)) return false;
    }
    
    if (filterStatus) {
      const isPago = p.status === 'pago' || p.pago;
      if (filterStatus === 'pago' && !isPago) return false;
      if (filterStatus === 'pendente' && isPago) return false;
    }
    
    return true;
  });
  
  // Ordenar por data (mais recentes primeiro)
  pagamentos.sort((a, b) => new Date(b.data || b.createdAt || 0) - new Date(a.data || a.createdAt || 0));
  
  if (pagamentos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Nenhum pagamento encontrado</td></tr>';
    // Atualizar métricas mesmo sem pagamentos
    atualizarMetricasFaturamento();
    return;
  }
  
  // Atualizar métricas de faturamento
  atualizarMetricasFaturamento();
  
  tbody.innerHTML = pagamentos.slice(0, 50).map(p => {
    const isPago = p.status === 'pago' || p.pago;
    const statusBadge = isPago 
      ? '<span class="badge badge-success">Pago</span>'
      : '<span class="badge badge-warning">Pendente</span>';
    
    const dataFormatada = p.data || p.createdAt ? new Date(p.data || p.createdAt).toLocaleDateString('pt-BR') : '--';
    
    return `
      <tr>
        <td>${escapeHtml(p.id.substring(0, 8))}...</td>
        <td>${escapeHtml(p.user_email || p.usuario || '--')}</td>
        <td>${escapeHtml(p.plano || '--')}</td>
        <td>R$ ${parseFloat(p.valor || 0).toFixed(2)}</td>
        <td>${statusBadge}</td>
        <td>${dataFormatada}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            ${!isPago ? `<button class="btn btn-success" onclick="marcarPago('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">✅</button>` : ''}
            <button class="btn btn-danger" onclick="removerPagamento('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Renderizar logs
function renderizarLogs() {
  const tbody = document.getElementById('tblLogs');
  const searchTerm = (document.getElementById('searchLogs')?.value || '').toLowerCase();
  const filterTipo = document.getElementById('filterLogTipo')?.value || '';
  
  let logs = logsCache.filter(l => {
    if (searchTerm && !(l.text || l.mensagem || '').toLowerCase().includes(searchTerm)) return false;
    if (filterTipo && (l.tipo || 'info') !== filterTipo) return false;
    return true;
  });
  
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Nenhum log encontrado</td></tr>';
    return;
  }
  
  const tipoStyles = {
    info: 'badge-info',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-danger'
  };
  
  tbody.innerHTML = logs.slice(0, 100).map(l => {
    const tipo = l.tipo || 'info';
    const dataFormatada = l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '--';
    
    return `
      <tr>
        <td><span class="badge ${tipoStyles[tipo] || 'badge-info'}">${tipo.toUpperCase()}</span></td>
        <td>${escapeHtml(l.text || l.mensagem || '--')}</td>
        <td>${dataFormatada}</td>
      </tr>
    `;
  }).join('');
}

// Renderizar estatísticas
function renderizarEstatisticas() {
  // Modelos VODs
  const totalModelos = estatisticasCache.banners.rigel + estatisticasCache.banners.bellatrix + estatisticasCache.banners.betelgeuse;
  
  document.getElementById('statRigel').textContent = estatisticasCache.banners.rigel;
  document.getElementById('statBellatrix').textContent = estatisticasCache.banners.bellatrix;
  document.getElementById('statBetelgeuse').textContent = estatisticasCache.banners.betelgeuse;
  
  if (totalModelos > 0) {
    document.getElementById('statPercentRigel').textContent = `${Math.round(estatisticasCache.banners.rigel / totalModelos * 100)}%`;
    document.getElementById('statPercentBellatrix').textContent = `${Math.round(estatisticasCache.banners.bellatrix / totalModelos * 100)}%`;
    document.getElementById('statPercentBetelgeuse').textContent = `${Math.round(estatisticasCache.banners.betelgeuse / totalModelos * 100)}%`;
  }
  
  // Estatísticas de divulgação
  const divulgacaoContainer = document.getElementById('statsDivulgacao');
  const divStats = estatisticasCache.divulgacao || {};
  
  if (Object.keys(divStats).length > 0) {
    const totalDiv = Object.values(divStats).reduce((a, b) => a + b, 0);
    divulgacaoContainer.innerHTML = Object.entries(divStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([modelo, count]) => `
        <div class="model-stat-card">
          <div class="model-name">Modelo ${modelo}</div>
          <div class="model-count">${count}</div>
          <div class="model-percent">${Math.round(count / totalDiv * 100)}%</div>
        </div>
      `).join('');
  } else {
    divulgacaoContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Sem dados de divulgação ainda</div>';
  }
  
  // Cores mais usadas
  renderizarCores();
  
  // Uso por período
  document.getElementById('bannersHoje').textContent = estatisticasCache.bannersHoje || 0;
  document.getElementById('bannersSemana').textContent = estatisticasCache.bannersSemana || 0;
  document.getElementById('bannersMes').textContent = estatisticasCache.bannersMes || estatisticasCache.total || 0;
}

// Renderizar cores mais usadas
function renderizarCores() {
  const container = document.getElementById('coresStats') || document.getElementById('statsCores');
  if (!container) return;
  
  const cores = estatisticasCache.cores || {};
  
  if (Object.keys(cores).length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Sem dados de cores ainda</div>';
    return;
  }
  
  const totalCores = Object.values(cores).reduce((a, b) => a + b, 0);
  const corEmojis = {
    roxo: '🟣', azul: '🔵', verde: '🟢', vermelho: '🔴',
    laranja: '🟠', amarelo: '🟡', preto: '⚫', prata: '⚪', dourado: '🟡'
  };
  
  container.innerHTML = Object.entries(cores)
    .sort((a, b) => b[1] - a[1])
    .map(([cor, count]) => `
      <div class="model-stat-card">
        <div class="model-name">${corEmojis[cor] || '🎨'} ${cor.toUpperCase()}</div>
        <div class="model-count">${count}</div>
        <div class="model-percent">${Math.round(count / totalCores * 100)}%</div>
      </div>
    `).join('');
}

// Renderizar últimas atividades
function renderizarUltimasAtividades() {
  const tbody = document.getElementById('ultimasAtividades');
  
  // Combinar logs recentes
  const atividades = logsCache.slice(0, 10);
  
  if (atividades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Nenhuma atividade recente</td></tr>';
    return;
  }
  
  tbody.innerHTML = atividades.map(a => {
    const dataFormatada = a.ts ? new Date(a.ts).toLocaleString('pt-BR') : '--';
    return `
      <tr>
        <td>${escapeHtml(a.usuario || 'Sistema')}</td>
        <td>${escapeHtml(a.text || a.mensagem || '--')}</td>
        <td>${dataFormatada}</td>
      </tr>
    `;
  }).join('');
}

// ==================== MÉTRICAS DE FATURAMENTO ====================
function atualizarMetricasFaturamento() {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();
  
  // Pagamentos pagos
  const pagos = pagamentosCache.filter(p => p.status === 'pago' || p.pago);
  const pendentes = pagamentosCache.filter(p => p.status === 'pendente' || (!p.pago && !p.status));
  
  // Faturamento total
  const total = pagos.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
  document.getElementById('faturamentoTotal').textContent = `R$ ${total.toFixed(2)}`;
  
  // Pendentes e confirmados
  document.getElementById('pagamentosPendentes').textContent = pendentes.length;
  document.getElementById('pagamentosConfirmados').textContent = pagos.length;
  
  // Faturamento do mês atual
  const pagosEsteMes = pagos.filter(p => {
    const dataPag = new Date(p.data || p.createdAt);
    return dataPag.getMonth() === mesAtual && dataPag.getFullYear() === anoAtual;
  });
  const faturamentoMes = pagosEsteMes.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
  document.getElementById('faturamentoMesAtual').textContent = `R$ ${faturamentoMes.toFixed(2)}`;
  
  // Faturamento mês anterior
  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoMesAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  const pagosMesAnterior = pagos.filter(p => {
    const dataPag = new Date(p.data || p.createdAt);
    return dataPag.getMonth() === mesAnterior && dataPag.getFullYear() === anoMesAnterior;
  });
  const faturamentoMesAnterior = pagosMesAnterior.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
  document.getElementById('faturamentoMesAnterior').textContent = `R$ ${faturamentoMesAnterior.toFixed(2)}`;
  
  // Crescimento
  let crescimento = 0;
  if (faturamentoMesAnterior > 0) {
    crescimento = ((faturamentoMes - faturamentoMesAnterior) / faturamentoMesAnterior) * 100;
  } else if (faturamentoMes > 0) {
    crescimento = 100;
  }
  const crescimentoEl = document.getElementById('crescimentoMes');
  crescimentoEl.textContent = `${crescimento >= 0 ? '+' : ''}${crescimento.toFixed(1)}%`;
  crescimentoEl.style.color = crescimento >= 0 ? '#22c55e' : '#ef4444';
  
  // Ticket médio
  const ticketMedio = pagos.length > 0 ? total / pagos.length : 0;
  document.getElementById('ticketMedio').textContent = `R$ ${ticketMedio.toFixed(2)}`;
  
  // MRR (Receita Recorrente Mensal) - baseado nos planos ativos
  const mrrEstimado = usuariosCache.filter(u => {
    const venc = u.data_expiracao || u.dataExpiracao;
    return venc && new Date(venc) > agora;
  }).reduce((sum, u) => {
    const plano = planosCache.find(p => p.id.toLowerCase() === (u.plano || '').toLowerCase());
    if (plano) {
      // Converter para valor mensal
      const valorMensal = plano.preco / (plano.duracao / 30);
      return sum + valorMensal;
    }
    return sum + 29.90; // Fallback mensal
  }, 0);
  document.getElementById('receitaRecorrente').textContent = `R$ ${mrrEstimado.toFixed(2)}`;
  
  // Clientes novos este mês
  const clientesNovos = usuariosCache.filter(u => {
    const criado = u.createdAt || u.criadoEm;
    if (!criado) return false;
    const dataCriacao = new Date(criado);
    return dataCriacao.getMonth() === mesAtual && dataCriacao.getFullYear() === anoAtual;
  }).length;
  document.getElementById('clientesNovos').textContent = clientesNovos;
  
  // Taxa de Churn (expirados no mês / total no início do mês)
  const expiradosEsteMes = usuariosCache.filter(u => {
    const venc = u.data_expiracao || u.dataExpiracao;
    if (!venc) return false;
    const dataVenc = new Date(venc);
    return dataVenc.getMonth() === mesAtual && 
           dataVenc.getFullYear() === anoAtual && 
           dataVenc < agora;
  }).length;
  const churn = usuariosCache.length > 0 ? (expiradosEsteMes / usuariosCache.length) * 100 : 0;
  document.getElementById('taxaChurn').textContent = `${churn.toFixed(1)}%`;
  
  // Faturamento por plano
  renderizarFaturamentoPorPlano(pagos);
  
  // Faturamento últimos 6 meses
  renderizarFaturamentoMensal(pagos);
}

function renderizarFaturamentoPorPlano(pagos) {
  const container = document.getElementById('faturamentoPorPlano');
  if (!container) return;
  
  // Agrupar por plano
  const porPlano = {};
  pagos.forEach(p => {
    const plano = (p.plano || 'Outros').toLowerCase();
    porPlano[plano] = (porPlano[plano] || 0) + parseFloat(p.valor || 0);
  });
  
  const total = Object.values(porPlano).reduce((a, b) => a + b, 0);
  
  if (Object.keys(porPlano).length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Nenhum dado de planos</div>';
    return;
  }
  
  const planoEmojis = {
    mensal: '📅', trimestral: '📆', semestral: '🗓️', anual: '📚'
  };
  
  container.innerHTML = Object.entries(porPlano)
    .sort((a, b) => b[1] - a[1])
    .map(([plano, valor]) => `
      <div class="model-stat-card">
        <div class="model-name">${planoEmojis[plano] || '💎'} ${plano.toUpperCase()}</div>
        <div class="model-count" style="color: #22c55e;">R$ ${valor.toFixed(2)}</div>
        <div class="model-percent">${total > 0 ? Math.round(valor / total * 100) : 0}%</div>
      </div>
    `).join('');
}

function renderizarFaturamentoMensal(pagos) {
  const container = document.getElementById('faturamentoMensal');
  if (!container) return;
  
  const agora = new Date();
  const meses = [];
  
  // Últimos 6 meses
  for (let i = 5; i >= 0; i--) {
    const mes = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const nomeMes = mes.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase();
    const ano = mes.getFullYear().toString().slice(-2);
    
    const valorMes = pagos.filter(p => {
      const dataPag = new Date(p.data || p.createdAt);
      return dataPag.getMonth() === mes.getMonth() && dataPag.getFullYear() === mes.getFullYear();
    }).reduce((sum, p) => sum + parseFloat(p.valor || 0), 0);
    
    meses.push({ nome: `${nomeMes}/${ano}`, valor: valorMes });
  }
  
  const maxValor = Math.max(...meses.map(m => m.valor), 1);
  
  container.innerHTML = meses.map(m => {
    const altura = (m.valor / maxValor) * 100;
    return `
      <div style="flex: 1; min-width: 80px; text-align: center;">
        <div style="height: 120px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 8px;">
          <div style="width: 50px; height: ${Math.max(altura, 5)}%; background: linear-gradient(to top, #22c55e, #4ade80); border-radius: 8px 8px 0 0; transition: height 0.5s ease;"></div>
        </div>
        <div style="font-weight: 700; color: #22c55e; font-size: 0.85rem;">R$ ${m.valor.toFixed(0)}</div>
        <div style="font-size: 0.75rem; color: rgba(255,255,255,0.5); margin-top: 4px;">${m.nome}</div>
      </div>
    `;
  }).join('');
}

// ==================== LISTENERS REALTIME ====================
function iniciarListenersRealtime() {
  // Listener para usuarios no RTDB
  onValue(ref(rtdb, 'usuarios'), (snap) => {
    if (snap.exists()) {
      const rtdbUsers = snap.val();
      // Atualizar cache mantendo dados do Firestore
      Object.entries(rtdbUsers).forEach(([id, data]) => {
        const existingIndex = usuariosCache.findIndex(u => u.id === id);
        if (existingIndex >= 0) {
          usuariosCache[existingIndex] = { ...usuariosCache[existingIndex], ...data };
        } else {
          usuariosCache.push({ id, ...data, source: 'rtdb' });
        }
      });
      renderizarUsuarios();
      atualizarDashboard();
    }
  });
  
  // Listener para logs
  onValue(ref(rtdb, 'logs'), (snap) => {
    if (snap.exists()) {
      logsCache = [];
      Object.entries(snap.val()).forEach(([id, data]) => {
        logsCache.push({ id, ...data });
      });
      logsCache.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      renderizarLogs();
      renderizarUltimasAtividades();
    }
  });
  
  // Listener para pagamentos
  onValue(ref(rtdb, 'pagamentos'), (snap) => {
    if (snap.exists()) {
      pagamentosCache = [];
      Object.entries(snap.val()).forEach(([id, data]) => {
        pagamentosCache.push({ id, ...data });
      });
      renderizarPagamentos();
      atualizarDashboard();
    }
  });
}

// ==================== AÇÕES DO ADMIN ====================

// Adicionar log
async function adicionarLog(tipo, mensagem) {
  try {
    const logRef = push(ref(rtdb, 'logs'));
    await set(logRef, {
      tipo,
      text: mensagem,
      ts: Date.now(),
      usuario: 'Admin'
    });
  } catch (err) {
    console.error('Erro ao adicionar log:', err);
  }
}

// Editar usuário
window.editarUsuario = async (userId) => {
  const usuario = usuariosCache.find(u => u.id === userId);
  if (!usuario) {
    alert('Usuário não encontrado');
    return;
  }
  
  document.getElementById('modalUsuarioTitle').textContent = 'Editar Usuário';
  document.getElementById('usuarioId').value = userId;
  document.getElementById('usuarioNome').value = usuario.nome || usuario.name || '';
  document.getElementById('usuarioEmail').value = usuario.email || '';
  document.getElementById('usuarioSenha').value = '';
  
  // Preencher select de planos dinamicamente
  const selectPlano = document.getElementById('usuarioPlano');
  selectPlano.innerHTML = planosCache.map(p => 
    `<option value="${p.id}" ${(usuario.plano || '').toLowerCase() === p.id.toLowerCase() ? 'selected' : ''}>
      ${p.nome || p.id} - R$ ${parseFloat(p.preco || 0).toFixed(2)} (${p.duracao || 30} dias)
    </option>`
  ).join('');
  
  // Se não tiver planos cadastrados, usar fallback
  if (planosCache.length === 0) {
    selectPlano.innerHTML = `
      <option value="mensal" ${(usuario.plano || '').toLowerCase() === 'mensal' ? 'selected' : ''}>Mensal</option>
      <option value="trimestral" ${(usuario.plano || '').toLowerCase() === 'trimestral' ? 'selected' : ''}>Trimestral</option>
      <option value="anual" ${(usuario.plano || '').toLowerCase() === 'anual' ? 'selected' : ''}>Anual</option>
    `;
  }
  
  const venc = usuario.data_expiracao || usuario.dataExpiracao;
  if (venc) {
    const date = new Date(venc);
    document.getElementById('usuarioVencimento').value = date.toISOString().split('T')[0];
  } else {
    document.getElementById('usuarioVencimento').value = '';
  }
  
  const isSuspenso = usuario.suspenso || usuario.status === 'suspenso';
  const isExpirado = venc && new Date(venc) <= new Date();
  document.getElementById('usuarioStatus').value = isSuspenso ? 'suspenso' : (isExpirado ? 'expirado' : 'ativo');
  
  document.getElementById('modalUsuario').classList.add('active');
};

// Toggle suspensão
window.toggleSuspensao = async (userId, suspender) => {
  if (!confirm(suspender ? 'Suspender este usuário?' : 'Reativar este usuário?')) return;
  
  try {
    // Atualizar no RTDB
    await update(ref(rtdb, `usuarios/${userId}`), {
      suspenso: suspender,
      status: suspender ? 'suspenso' : 'ativo'
    });
    
    // Atualizar no Firestore
    try {
      await updateDoc(doc(firestore, 'usuarios', userId), {
        suspenso: suspender,
        status: suspender ? 'suspenso' : 'ativo'
      });
    } catch (e) { /* Firestore pode não ter o doc */ }
    
    adicionarLog('info', `Usuário ${userId} ${suspender ? 'suspenso' : 'reativado'}`);
    alert(suspender ? '✅ Usuário suspenso' : '✅ Usuário reativado');
    
    await carregarUsuarios();
  } catch (err) {
    console.error('Erro ao alterar status:', err);
    alert('❌ Erro: ' + err.message);
  }
};

// Excluir usuário
window.excluirUsuario = async (userId, identificador) => {
  const confirmacao = prompt(`⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nPara confirmar a exclusão de "${identificador}", digite "EXCLUIR":`);
  
  if (confirmacao !== 'EXCLUIR') {
    alert('❌ Exclusão cancelada. Digite exatamente "EXCLUIR" para confirmar.');
    return;
  }
  
  try {
    console.log('🗑️ Excluindo usuário:', userId);
    
    // Excluir do RTDB
    await remove(ref(rtdb, `usuarios/${userId}`));
    console.log('✅ Removido do Firebase RTDB');
    
    // Excluir do Firestore
    try {
      await deleteDoc(doc(firestore, 'usuarios', userId));
      console.log('✅ Removido do Firestore');
    } catch (fsErr) {
      console.warn('⚠️ Erro ao remover do Firestore:', fsErr.message);
    }
    
    adicionarLog('warning', `🗑️ Usuário ${identificador} (${userId}) EXCLUÍDO permanentemente`);
    alert('✅ Usuário excluído com sucesso!');
    
    await carregarUsuarios();
    atualizarDashboard();
  } catch (err) {
    console.error('❌ Erro ao excluir usuário:', err);
    alert('❌ Erro: ' + err.message);
  }
};

// Marcar pagamento como pago
window.marcarPago = async (pagamentoId) => {
  if (!confirm('Confirmar este pagamento como pago?')) return;
  
  try {
    await update(ref(rtdb, `pagamentos/${pagamentoId}`), {
      status: 'pago',
      pago: true,
      dataConfirmacao: new Date().toISOString()
    });
    
    adicionarLog('success', `Pagamento ${pagamentoId} confirmado`);
    alert('✅ Pagamento confirmado');
    
    await carregarPagamentos();
  } catch (err) {
    console.error('Erro ao confirmar pagamento:', err);
    alert('❌ Erro: ' + err.message);
  }
};

// Remover pagamento
window.removerPagamento = async (pagamentoId) => {
  if (!confirm('Remover este pagamento? Esta ação não pode ser desfeita.')) return;
  
  try {
    await remove(ref(rtdb, `pagamentos/${pagamentoId}`));
    adicionarLog('warning', `Pagamento ${pagamentoId} removido`);
    alert('✅ Pagamento removido');
    
    await carregarPagamentos();
  } catch (err) {
    console.error('Erro ao remover pagamento:', err);
    alert('❌ Erro: ' + err.message);
  }
};

// Remover plano
window.removerPlano = async (planoId) => {
  if (!confirm(`Remover o plano "${planoId}"? Usuários com este plano não serão afetados.`)) return;
  
  try {
    await remove(ref(rtdb, `planos/${planoId}`));
    adicionarLog('warning', `Plano ${planoId} removido`);
    alert('✅ Plano removido');
    
    await carregarPlanos();
  } catch (err) {
    console.error('Erro ao remover plano:', err);
    alert('❌ Erro: ' + err.message);
  }
};

// Editar plano - ABRE MODAL PARA EDIÇÃO
window.editarPlano = async (planoId) => {
  const plano = planosCache.find(p => p.id === planoId);
  if (!plano) {
    alert('Plano não encontrado');
    return;
  }
  
  // Preencher modal
  document.getElementById('modalPlanoTitle').textContent = 'Editar Plano';
  document.getElementById('planoId').value = planoId;
  document.getElementById('planoNome').value = plano.nome || plano.id;
  document.getElementById('planoPreco').value = plano.preco || 0;
  document.getElementById('planoDuracao').value = plano.duracao || 30;
  document.getElementById('planoDescricao').value = plano.descricao || '';
  document.getElementById('planoRecursos').value = plano.recursos || '';
  document.getElementById('btnSalvarPlano').textContent = '💾 Atualizar Plano';
  
  document.getElementById('modalPlano').classList.add('active');
};

// Fechar modal
window.fecharModal = (modalId) => {
  document.getElementById(modalId)?.classList.remove('active');
};

// ==================== FORMULÁRIOS ====================

// Form usuário - SALVA NO FIREBASE E FIRESTORE
document.getElementById('formUsuario')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Salvando...';
  
  const userId = document.getElementById('usuarioId').value;
  const nome = document.getElementById('usuarioNome').value.trim();
  const email = document.getElementById('usuarioEmail').value.trim();
  const plano = document.getElementById('usuarioPlano').value;
  const vencimento = document.getElementById('usuarioVencimento').value;
  const status = document.getElementById('usuarioStatus').value;
  const novaSenha = document.getElementById('usuarioSenha').value;
  
  try {
    const dataExpiracao = vencimento ? new Date(vencimento).toISOString() : null;
    
    const userData = {
      nome,
      name: nome,
      email,
      plano,
      status,
      suspenso: status === 'suspenso',
      data_expiracao: dataExpiracao,
      dataExpiracao: dataExpiracao,
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin'
    };
    
    console.log('📝 Salvando usuário:', userId, userData);
    
    // ===== SALVAR NO FIREBASE RTDB =====
    await update(ref(rtdb, `usuarios/${userId}`), userData);
    console.log('✅ Salvo no Firebase RTDB');
    
    // ===== SALVAR NO FIRESTORE =====
    try {
      // Tentar atualizar primeiro
      await updateDoc(doc(firestore, 'usuarios', userId), userData);
      console.log('✅ Atualizado no Firestore');
    } catch (firestoreErr) {
      // Se não existir, criar novo documento
      if (firestoreErr.code === 'not-found') {
        await setDoc(doc(firestore, 'usuarios', userId), {
          ...userData,
          createdAt: new Date().toISOString()
        });
        console.log('✅ Criado no Firestore');
      } else {
        console.warn('⚠️ Erro Firestore (continuando):', firestoreErr.message);
      }
    }
    
    // Se tiver nova senha, avisar
    if (novaSenha) {
      alert('⚠️ A senha não pode ser alterada pelo painel. Use o console do Firebase Authentication.');
    }
    
    adicionarLog('success', `Usuário ${email} atualizado - Plano: ${plano}, Venc: ${vencimento || 'N/A'}`);
    fecharModal('modalUsuario');
    alert('✅ Usuário salvo no Firebase e Firestore!');
    
    await carregarUsuarios();
  } catch (err) {
    console.error('❌ Erro ao salvar usuário:', err);
    alert('❌ Erro: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// Form plano - COM SUPORTE A EDIÇÃO
document.getElementById('formPlano')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = document.getElementById('btnSalvarPlano');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Salvando...';
  
  const planoIdExistente = document.getElementById('planoId')?.value;
  const nome = document.getElementById('planoNome').value.trim();
  const preco = parseFloat(document.getElementById('planoPreco').value);
  const duracao = parseInt(document.getElementById('planoDuracao').value);
  const descricao = document.getElementById('planoDescricao')?.value?.trim() || '';
  const recursos = document.getElementById('planoRecursos')?.value?.trim() || '';
  
  // Usar ID existente ou gerar novo
  const planoId = planoIdExistente || nome.toLowerCase().replace(/\s+/g, '_');
  const isEditing = !!planoIdExistente;
  
  try {
    const planoData = {
      nome,
      preco,
      duracao,
      descricao,
      recursos,
      updatedAt: new Date().toISOString()
    };
    
    if (!isEditing) {
      planoData.criadoEm = new Date().toISOString();
    }
    
    // Salvar no RTDB
    if (isEditing) {
      await update(ref(rtdb, `planos/${planoId}`), planoData);
    } else {
      await set(ref(rtdb, `planos/${planoId}`), planoData);
    }
    
    // Também salvar no Firestore para backup
    try {
      if (isEditing) {
        await updateDoc(doc(firestore, 'planos', planoId), planoData);
      } else {
        await setDoc(doc(firestore, 'planos', planoId), planoData);
      }
    } catch (e) { 
      console.warn('Firestore planos:', e.message);
    }
    
    adicionarLog('success', `Plano ${isEditing ? 'atualizado' : 'criado'}: ${nome} - R$ ${preco.toFixed(2)} (${duracao} dias)`);
    fecharModal('modalPlano');
    alert(`✅ Plano ${isEditing ? 'atualizado' : 'criado'} com sucesso!`);
    
    await carregarPlanos();
  } catch (err) {
    console.error('Erro ao salvar plano:', err);
    alert('❌ Erro: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// Form pagamento - COM ATUALIZAÇÃO AUTOMÁTICA DO PLANO DO CLIENTE
document.getElementById('formPagamento')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Processando...';
  
  const usuarioEmail = document.getElementById('pagamentoUsuario').value;
  const planoId = document.getElementById('pagamentoPlano').value;
  const valor = parseFloat(document.getElementById('pagamentoValor').value);
  const status = document.getElementById('pagamentoStatus').value;
  const atualizarCliente = document.getElementById('atualizarPlanoCliente')?.checked ?? true;
  
  const pagamentoId = push(ref(rtdb, 'pagamentos')).key;
  
  try {
    // 1. Registrar pagamento
    const pagamentoData = {
      usuario: usuarioEmail,
      user_email: usuarioEmail,
      plano: planoId,
      valor,
      status,
      pago: status === 'pago',
      data: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    await set(ref(rtdb, `pagamentos/${pagamentoId}`), pagamentoData);
    console.log('✅ Pagamento registrado:', pagamentoId);
    
    // 2. Se marcado para atualizar cliente E pagamento está pago
    if (atualizarCliente && status === 'pago') {
      // Encontrar usuário pelo email
      const usuario = usuariosCache.find(u => u.email === usuarioEmail || u.id === usuarioEmail);
      
      if (usuario) {
        // Buscar dados do plano
        const plano = planosCache.find(p => p.id === planoId);
        const duracaoDias = plano?.duracao || 30;
        
        // Calcular nova data de expiração
        const agora = new Date();
        const vencimentoAtual = usuario.data_expiracao || usuario.dataExpiracao;
        const baseDate = (vencimentoAtual && new Date(vencimentoAtual) > agora) 
          ? new Date(vencimentoAtual)  // Renovação: adicionar à data atual
          : agora;                      // Novo: começar de hoje
        
        const novaExpiracao = new Date(baseDate);
        novaExpiracao.setDate(novaExpiracao.getDate() + duracaoDias);
        
        const clienteUpdate = {
          plano: planoId,
          data_expiracao: novaExpiracao.toISOString(),
          dataExpiracao: novaExpiracao.toISOString(),
          status: 'ativo',
          suspenso: false,
          ultimoPagamento: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: 'admin-pagamento'
        };
        
        console.log('📝 Atualizando cliente:', usuario.id, clienteUpdate);
        
        // ===== ATUALIZAR NO FIREBASE RTDB =====
        await update(ref(rtdb, `usuarios/${usuario.id}`), clienteUpdate);
        console.log('✅ Cliente atualizado no Firebase RTDB');
        
        // ===== ATUALIZAR NO FIRESTORE =====
        try {
          await updateDoc(doc(firestore, 'usuarios', usuario.id), clienteUpdate);
          console.log('✅ Cliente atualizado no Firestore');
        } catch (fsErr) {
          if (fsErr.code === 'not-found') {
            await setDoc(doc(firestore, 'usuarios', usuario.id), {
              ...clienteUpdate,
              email: usuarioEmail,
              createdAt: new Date().toISOString()
            });
            console.log('✅ Cliente criado no Firestore');
          } else {
            console.warn('⚠️ Erro Firestore:', fsErr.message);
          }
        }
        
        adicionarLog('success', `🔄 Plano de ${usuarioEmail} atualizado para ${planoId} até ${novaExpiracao.toLocaleDateString('pt-BR')}`);
      } else {
        console.warn('⚠️ Usuário não encontrado para atualização:', usuarioEmail);
        adicionarLog('warning', `Pagamento registrado mas usuário ${usuarioEmail} não encontrado para atualização`);
      }
    }
    
    adicionarLog('success', `💰 Pagamento R$ ${valor.toFixed(2)} registrado para ${usuarioEmail}`);
    fecharModal('modalPagamento');
    alert(`✅ Pagamento registrado!${atualizarCliente && status === 'pago' ? '\n✅ Plano do cliente atualizado!' : ''}`);
    
    await carregarPagamentos();
    await carregarUsuarios();
    atualizarDashboard();
  } catch (err) {
    console.error('❌ Erro ao registrar pagamento:', err);
    alert('❌ Erro: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// ==================== BOTÕES ====================

// Novo usuário
document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
  document.getElementById('modalUsuarioTitle').textContent = 'Novo Usuário';
  document.getElementById('formUsuario').reset();
  document.getElementById('usuarioId').value = 'novo_' + Date.now();
  document.getElementById('modalUsuario').classList.add('active');
});

// Novo plano
document.getElementById('btnNovoPlano')?.addEventListener('click', () => {
  document.getElementById('modalPlanoTitle').textContent = 'Novo Plano';
  document.getElementById('formPlano').reset();
  document.getElementById('planoId').value = ''; // Limpar ID para criar novo
  document.getElementById('btnSalvarPlano').textContent = '💾 Criar Plano';
  document.getElementById('modalPlano').classList.add('active');
});

// Novo pagamento
document.getElementById('btnNovoPagamento')?.addEventListener('click', () => {
  // Preencher selects
  const selectUsuario = document.getElementById('pagamentoUsuario');
  const selectPlano = document.getElementById('pagamentoPlano');
  
  selectUsuario.innerHTML = '<option value="">Selecione...</option>' + 
    usuariosCache.map(u => `<option value="${u.email || u.id}" data-id="${u.id}">${u.nome || u.email || u.id}</option>`).join('');
  
  selectPlano.innerHTML = '<option value="">Selecione...</option>' + 
    planosCache.map(p => `<option value="${p.id}" data-preco="${p.preco || 0}">${p.nome || p.id} - R$ ${parseFloat(p.preco || 0).toFixed(2)}</option>`).join('');
  
  document.getElementById('formPagamento').reset();
  document.getElementById('atualizarPlanoCliente').checked = true;
  document.getElementById('modalPagamento').classList.add('active');
});

// Auto-preencher valor quando selecionar plano
document.getElementById('pagamentoPlano')?.addEventListener('change', (e) => {
  const option = e.target.selectedOptions[0];
  if (option && option.dataset.preco) {
    document.getElementById('pagamentoValor').value = parseFloat(option.dataset.preco).toFixed(2);
  }
});

// Exportar usuários
document.getElementById('btnExportUsers')?.addEventListener('click', () => {
  const csv = 'Nome,Email,Plano,Status,Vencimento\n' + 
    usuariosCache.map(u => {
      const venc = u.data_expiracao || u.dataExpiracao;
      return `"${u.nome || u.name || ''}","${u.email || ''}","${u.plano || ''}","${u.status || 'ativo'}","${venc ? new Date(venc).toLocaleDateString('pt-BR') : ''}"`;
    }).join('\n');
  
  downloadFile(csv, 'usuarios-orion.csv', 'text/csv');
  adicionarLog('info', 'Exportação de usuários realizada');
});

// Exportar pagamentos
document.getElementById('btnExportPagamentos')?.addEventListener('click', () => {
  const csv = 'ID,Usuário,Plano,Valor,Status,Data\n' + 
    pagamentosCache.map(p => {
      return `"${p.id}","${p.user_email || p.usuario || ''}","${p.plano || ''}","${p.valor || 0}","${p.status || ''}","${p.data ? new Date(p.data).toLocaleDateString('pt-BR') : ''}"`;
    }).join('\n');
  
  downloadFile(csv, 'pagamentos-orion.csv', 'text/csv');
  adicionarLog('info', 'Exportação de pagamentos realizada');
});

// Limpar logs
document.getElementById('btnLimparLogs')?.addEventListener('click', async () => {
  if (!confirm('Limpar todos os logs? Esta ação não pode ser desfeita.')) return;
  
  try {
    await remove(ref(rtdb, 'logs'));
    logsCache = [];
    renderizarLogs();
    alert('✅ Logs limpos');
  } catch (err) {
    console.error('Erro ao limpar logs:', err);
    alert('❌ Erro: ' + err.message);
  }
});

// ==================== FILTROS ====================

document.getElementById('searchUsuarios')?.addEventListener('input', renderizarUsuarios);
document.getElementById('filterPlano')?.addEventListener('change', renderizarUsuarios);
document.getElementById('filterStatus')?.addEventListener('change', renderizarUsuarios);
document.getElementById('searchPagamentos')?.addEventListener('input', renderizarPagamentos);
document.getElementById('filterPagamentoStatus')?.addEventListener('change', renderizarPagamentos);
document.getElementById('searchLogs')?.addEventListener('input', renderizarLogs);
document.getElementById('filterLogTipo')?.addEventListener('change', renderizarLogs);

// ==================== UTILITÁRIOS ====================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

console.log('🌌 Orion Admin Panel carregado');
