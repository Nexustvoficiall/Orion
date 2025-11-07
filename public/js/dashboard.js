// public/js/dashboard.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  onValue,
  update,
  set,
  push,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* --------- CONFIG FIREBASE (use sua config) --------- */
const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.firebasestorage.app",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6"
};

const ADMIN_EMAIL = "orioncreatoroficial@gmail.com"; // ⚠️ ajuste se necessário

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

/* ---------- UI refs ---------- */
const adminInfoEl = document.getElementById("admin-info");
const btnLogout = document.getElementById("btn-logout");
const btnExport = document.getElementById("btn-export");
const btnAddLog = document.getElementById("btn-add-log");
const tblUsuarios = document.querySelector("#tbl-usuarios tbody");
const tblPlanos = document.querySelector("#tbl-planos tbody");
const tblPagamentos = document.querySelector("#tbl-pagamentos tbody");
const usuariosCount = document.getElementById("usuarios-count");
const pagamentosCount = document.getElementById("pagamentos-count");
const logList = document.getElementById("log-list");
const btnClearLogs = document.getElementById("btn-clear-logs");
const searchGlobal = document.getElementById("search-global");
const selectFilter = document.getElementById("select-filter");

/* ---------- Auth guard ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "admin.html";
    return;
  }
  const email = user.email || "";
  if (ADMIN_EMAIL && email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    await signOut(auth);
    alert("Acesso restrito. Conta não autorizada.");
    window.location.href = "admin.html";
    return;
  }
  adminInfoEl.innerHTML = `<strong>${user.displayName || "Admin"}</strong><br/><div class="muted">${email}</div>`;
  startRealtimeListeners();
  loadOnceCounts();
});

/* ---------- Logout ---------- */
btnLogout.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "admin.html";
});

/* ---------- Export backup (download JSON) ---------- */
btnExport.addEventListener("click", async () => {
  const rootRef = ref(db, "/");
  const snap = await get(rootRef);
  if (!snap.exists()) return alert("Nada para exportar");
  const data = snap.val();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orion-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ---------- Add quick log ---------- */
btnAddLog.addEventListener("click", async () => {
  const message = prompt("Digite a mensagem do log (ex: backup realizado):");
  if (!message) return;
  const p = push(ref(db, "logs"));
  await set(p, { text: message, ts: Date.now() });
  alert("Log adicionado.");
});

/* ---------- Clear logs ---------- */
btnClearLogs.addEventListener("click", async () => {
  if (!confirm("Limpar todos os logs? Isso é irreversível.")) return;
  await remove(ref(db, "logs"));
  logList.innerHTML = "";
});

/* ---------- Listeners em tempo real ---------- */
function startRealtimeListeners() {
  onValue(ref(db, "usuarios"), (snap) => renderUsuarios(snap.val() || {}));
  onValue(ref(db, "planos"), (snap) => renderPlanos(snap.val() || {}));
  onValue(ref(db, "pagamentos"), (snap) => renderPagamentos(snap.val() || {}));
  onValue(ref(db, "logs"), (snap) => renderLogs(snap.val() || {}));
}

/* ---------- One-time counts for header ---------- */
async function loadOnceCounts(){
  const [uSnap, pSnap] = await Promise.all([get(ref(db, "usuarios")), get(ref(db, "pagamentos"))]);
  usuariosCount.textContent = uSnap.exists()? Object.keys(uSnap.val()||{}).length : 0;
  pagamentosCount.textContent = pSnap.exists()? Object.keys(pSnap.val()||{}).length : 0;
}

/* ---------- Render functions ---------- */
function renderUsuarios(obj){
  tblUsuarios.innerHTML = "";
  const arr = Object.entries(obj || {}).map(([id,data]) => ({ id, ...data }));
  usuariosCount.textContent = arr.length;
  const filter = selectFilter.value;
  const search = (searchGlobal.value||"").toLowerCase();

  arr.filter(u => {
    if (filter==="ativo") return new Date(u.data_expiracao || 0) > new Date();
    if (filter==="expirado") return new Date(u.data_expiracao || 0) <= new Date();
    return true;
  }).filter(u => {
    if (!search) return true;
    return (u.nome||"").toLowerCase().includes(search) || (u.email||"").toLowerCase().includes(search) || (u.plano||"").toLowerCase().includes(search);
  }).forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(u.nome||"—")}</td>
      <td>${escapeHTML(u.email||"—")}</td>
      <td>${escapeHTML(u.plano||"—")}</td>
      <td>${u.data_expiracao ? new Date(u.data_expiracao).toLocaleDateString('pt-BR') : '—'}</td>
      <td>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" onclick='toggleUser("${u.id}")'>${isActive(u) ? "Suspender":"Ativar"}</button>
          <button class="btn" onclick='editPlanPrompt("${u.id}")'>Mudar Plano</button>
        </div>
      </td>
    `;
    tblUsuarios.appendChild(tr);
  });
}

function renderPlanos(obj){
  tblPlanos.innerHTML = "";
  const arr = Object.entries(obj || {}).map(([id,data]) => ({ id, ...data }));
  arr.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(p.id)}</td>
      <td>${escapeHTML(p.nome||"—")}</td>
      <td>${escapeHTML(p.preco||"—")}</td>
      <td>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" onclick='removePlan("${p.id}")'>Remover</button>
        </div>
      </td>
    `;
    tblPlanos.appendChild(tr);
  });
}

function renderPagamentos(obj){
  tblPagamentos.innerHTML = "";
  const arr = Object.entries(obj || {}).map(([id,data]) => ({ id, ...data }));
  pagamentosCount.textContent = arr.length;
  arr.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(p.id)}</td>
      <td>${escapeHTML(p.user_email||p.user||"—")}</td>
      <td>${escapeHTML(p.valor||"—")}</td>
      <td>${p.pago ? '<span class="badge ok">Pago</span>' : '<span class="badge" style="background:rgba(255,165,0,.12)">Pendente</span>'}</td>
      <td>
        <div style="display:flex;gap:8px">
          ${p.pago ? '' : `<button class="btn" onclick='markPaymentPaid("${p.id}")'>Marcar Pago</button>`}
          <button class="btn ghost" onclick='removePayment("${p.id}")'>Remover</button>
        </div>
      </td>
    `;
    tblPagamentos.appendChild(tr);
  });
}

function renderLogs(obj){
  logList.innerHTML = "";
  const arr = Object.entries(obj || {}).map(([id,data]) => ({ id, ...data }));
  arr.sort((a,b) => (b.ts||0) - (a.ts||0));
  arr.forEach(l => {
    const d = new Date(l.ts || Date.now()).toLocaleString();
    const div = document.createElement("div");
    div.style.padding="8px";
    div.style.borderBottom="1px solid rgba(255,255,255,0.03)";
    div.innerHTML = `<strong style="color:${l.level==="err"?"#ff6b6b":"#cfc1ff"}">${escapeHTML(l.text||"")}</strong><div class="muted" style="font-size:.85rem">${d}</div>`;
    logList.appendChild(div);
  });
}

/* ---------- Helpers & Actions ---------- */
function escapeHTML(s){
  return String(s||"").replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m]));
}

function isActive(user){
  return new Date(user.data_expiracao || 0) > new Date();
}

window.toggleUser = async function(uid){
  const uRef = ref(db, `usuarios/${uid}`);
  const snap = await get(uRef);
  if (!snap.exists()) return alert("Usuário não encontrado");
  const u = snap.val();
  if (isActive(u)){
    const d = new Date(); d.setDate(d.getDate() - 1);
    await update(uRef, { data_expiracao: d.toISOString() });
    push(ref(db, "logs"), { text: `Usuário ${u.email} suspenso pelo admin`, ts: Date.now() });
  } else {
    const d = new Date(); d.setDate(d.getDate() + 30);
    await update(uRef, { data_expiracao: d.toISOString() });
    push(ref(db, "logs"), { text: `Usuário ${u.email} ativado por 30 dias`, ts: Date.now() });
  }
};

window.editPlanPrompt = async function(uid){
  const pSnap = await get(ref(db, "planos"));
  const planos = pSnap.exists() ? pSnap.val() : {};
  const planoKeys = Object.keys(planos);
  if (planoKeys.length === 0) return alert("Nenhum plano cadastrado.");
  const pick = prompt(`Digite o ID do plano entre: ${planoKeys.join(",")}`);
  if (!pick || !planos[pick]) return alert("Plano inválido.");
  await update(ref(db, `usuarios/${uid}`), { plano: pick, data_expiracao: new Date(Date.now()+30*24*3600*1000).toISOString() });
  push(ref(db, "logs"), { text: `Plano do usuário ${uid} alterado para ${pick}`, ts: Date.now() });
};

window.removePlan = async function(planId){
  if (!confirm("Remover plano?")) return;
  await remove(ref(db, `planos/${planId}`));
  push(ref(db, "logs"), { text: `Plano ${planId} removido`, ts: Date.now() });
};

window.markPaymentPaid = async function(paymentId){
  await update(ref(db, `pagamentos/${paymentId}`), { pago: true });
  push(ref(db, "logs"), { text: `Pagamento ${paymentId} marcado como pago`, ts: Date.now() });
};

window.removePayment = async function(paymentId){
  if (!confirm("Remover pagamento?")) return;
  await remove(ref(db, `pagamentos/${paymentId}`));
  push(ref(db, "logs"), { text: `Pagamento ${paymentId} removido`, ts: Date.now() });
};

/* ---------- Small utilities ---------- */
searchGlobal.addEventListener("input", () => get(ref(db, "usuarios")).then(s => renderUsuarios(s.val() || {})));
selectFilter.addEventListener("change", () => get(ref(db, "usuarios")).then(s => renderUsuarios(s.val() || {})));
