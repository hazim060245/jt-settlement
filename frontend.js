'use strict';

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

/* ===================== DATE ===================== */
let today = new Date().toISOString().split('T')[0];

/* ===================== GLOBAL STATE ===================== */
let currentUser = null;
let appData = { opening: {}, actual: {}, packages: [], status: 'draft' };
let syncTimer = null;
let currentSessionDate = null;
let currentSessionCode = null;
let targetUserId = null; // สำหรับ admin ที่แก้ไขข้อมูลแทนพนักงาน

function load(t) { return appData[t] || null; }
function save(t, d) {
  appData[t] = d;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToDB, 1500);
}

/* ===================== DB SYNC ===================== */
async function syncToDB() {
  if (!currentUser || !currentSessionDate) return;
  const uid = targetUserId || currentUser.id;
  const openingTotal = cashTotal('opening');
  const actualTotal  = cashTotal('actual');
  const pkgs = appData['packages'] || [];
  let cashPkg = 0, transfer = 0;
  pkgs.forEach(p => { const a = parseFloat(p.amount)||0; if(p.payment==='เงินสด') cashPkg+=a; else transfer+=a; });
  const payload = {
    opening_total: openingTotal, actual_total: actualTotal,
    transfer_total: transfer, cash_pkg_total: cashPkg,
    drop_cash_total: parseFloat(appData.drop_cash)||0,
    pkg_count: pkgs.length, status: appData.status||'draft',
    session_code: currentSessionCode || '',
    data_json: appData
  };
  try {
    await fetch('/api/data/'+uid+'/'+currentSessionDate, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
  } catch(e) { console.error('Sync failed',e); }
}

async function fetchFromDB(date) {
  if (!currentUser) return;
  const uid = targetUserId || currentUser.id;
  try {
    const res = await fetch('/api/data/'+uid+'/'+date);
    const data = await res.json();
    if (data && Object.keys(data).length > 0) {
      appData = data;
    } else {
      appData = { opening:{}, actual:{}, packages:[], status:'draft' };
    }
  } catch(e) { appData = { opening:{}, actual:{}, packages:[], status:'draft' }; }
}

/* ===================== UTILS ===================== */
const fmt = n => '฿'+Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
function esc(s){ if(s==null)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const fmtDate = (iso) => { if(!iso)return'-'; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
function cashTotal(prefix){ const d=load(prefix)||{}; return DENOMS.reduce((s,dn)=>s+(d[dn]||0)*dn,0); }

/* ===================== TOAST ===================== */
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast'); if(!t)return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}
window.showToast=showToast;

/* ===================== SESSIONS VIEW ===================== */
async function showSessionsView() {
  document.getElementById('auth-view').style.display  = 'none';
  document.getElementById('app-view').style.display   = 'none';
  document.getElementById('sessions-view').style.display = 'flex';

  const svName = document.getElementById('sv-user-name');
  const svInit = document.getElementById('sv-user-initial');
  const svAdmin = document.getElementById('sv-admin-btn');
  if (svName) svName.textContent = currentUser.name;
  if (svInit) svInit.textContent = currentUser.name.charAt(0);
  if (svAdmin) svAdmin.style.display = currentUser.role === 'admin' ? 'block' : 'none';

  await renderSessionsList();
}

async function renderSessionsList() {
  const grid = document.getElementById('sessions-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-weight:700;">กำลังโหลด...</div>';

  let sessions = [];
  try {
    const res = await fetch('/api/history/'+currentUser.id);
    sessions = await res.json() || [];
  } catch(e) { sessions = []; }

  grid.innerHTML = '';

  // "Create new" card
  const newCard = document.createElement('div');
  newCard.className = 'session-card session-card-new';
  newCard.onclick = openCreateSessionModal;
  newCard.innerHTML = `<i class="fas fa-plus-circle"></i><span>เปิดรอบวันใหม่</span><span style="font-size:11px;color:var(--text-muted);">สร้าง session สำหรับวันที่ต้องการ</span>`;
  grid.appendChild(newCard);

  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);';
    empty.innerHTML = '<i class="fas fa-inbox" style="font-size:48px;display:block;margin-bottom:16px;opacity:0.3;"></i><div style="font-weight:700;">ยังไม่มีรอบการทำงาน</div>';
    grid.appendChild(empty);
    return;
  }

  sessions.forEach(r => {
    const isFinal = r.status === 'final';
    
    // ผู้ใช้ต้องการให้รอบที่ปิดแล้ว หายไปจากหน้าพนักงาน และไปอยู่ในหน้า Admin เท่านั้น
    if (isFinal) return; 

    const code = r.session_code || '-';
    const card = document.createElement('div');
    card.className = 'session-card status-draft';
    card.onclick = () => openSession(r.date, r.session_code || '', r.status);
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div class="session-card-date">${fmtDate(r.date)}</div>
        <span class="session-badge badge-draft">
          <i class="fas fa-lock-open"></i>
          กำลังเปิด
        </span>
      </div>
      <div class="session-card-code"><i class="fas fa-key"></i> ${esc(code)}</div>
      <div class="session-card-stats">
        <div class="session-stat">
          <div class="session-stat-val">${r.pkg_count||0}</div>
          <div class="session-stat-lbl">พัสดุ</div>
        </div>
        <div class="session-stat">
          <div class="session-stat-val">${fmt(r.cash_pkg_total||0)}</div>
          <div class="session-stat-lbl">เงินสด</div>
        </div>
        <div class="session-stat">
          <div class="session-stat-val">${fmt(r.opening_total||0)}</div>
          <div class="session-stat-lbl">ยอดตั้งต้น</div>
        </div>
        <div class="session-stat">
          <div class="session-stat-val" style="color:${((r.actual_total||0)-((r.opening_total||0)+(r.cash_pkg_total||0)))>=0?'var(--success)':'var(--danger)'}">
            ${r.actual_total != null ? fmt((r.actual_total||0)-((r.opening_total||0)+(r.cash_pkg_total||0))) : '-'}
          </div>
          <div class="session-stat-lbl">ส่วนต่าง</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;color:var(--primary);font-size:13px;font-weight:800;">
        <i class="fas fa-arrow-right-to-bracket"></i>
        ทำงานต่อ
      </div>`;
    grid.appendChild(card);
  });
}

function openCreateSessionModal() {
  const dateInput = document.getElementById('new-session-date');
  if (dateInput) dateInput.value = today;
  // แสดงรหัสพนักงานอัตโนมัติ
  const empIdEl = document.getElementById('new-session-empid');
  if (empIdEl) empIdEl.value = currentUser ? currentUser.username : '';
  const nickEl = document.getElementById('new-session-nickname');
  if (nickEl) { nickEl.value = ''; nickEl.focus(); }
  document.getElementById('modal-create-session').classList.add('open');
}

window.confirmCreateSession = async function() {
  const date     = document.getElementById('new-session-date').value;
  const nickname = document.getElementById('new-session-nickname').value.trim();
  if (!date)     { showToast('⚠️ กรุณาเลือกวันที่'); return; }
  if (!nickname) { showToast('⚠️ กรุณากรอกชื่อเล่น'); return; }
  const empId = currentUser.username;
  const code  = empId + ' ' + nickname;   // e.g. "008 เปรมวดี"
  closeModal();
  await openSession(date, code, 'draft');
};

window.closeModal = function() {
  document.getElementById('modal-create-session').classList.remove('open');
};

async function openSession(date, code, status) {
  currentSessionDate = date;
  currentSessionCode = code;

  const dateEl = document.getElementById('selectedDate');
  if (dateEl) dateEl.value = date;

  await fetchFromDB(date);

  // --- AUTOMATIC CARRY-OVER LOGIC ---
  const currentOpening = appData.opening || {};
  const hasOpening = Object.values(currentOpening).some(v => v > 0);
  if (!hasOpening) {
    try {
      const res = await fetch('/api/admin/summary');
      const allHistory = await res.json();
      const previous = allHistory
        .filter(r => r.date < date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (previous && previous.data_json) {
        const prevData = JSON.parse(previous.data_json);
        if (prevData.actual && Object.keys(prevData.actual).length > 0) {
          appData.opening = JSON.parse(JSON.stringify(prevData.actual));
          showToast('📥 ดึงยอดเงินยกมาจากรอบล่าสุดของสาขา');
          syncToDB();
        }
      }
    } catch(e) { console.error('Global carry over failed', e); }
  }

  document.getElementById('sessions-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';

  const infoBar = document.getElementById('session-info-bar');
  if (infoBar) infoBar.textContent = `📅 ${fmtDate(date)}  •  🔑 ${code || '-'}`;

  const isAdmin = currentUser.role === 'admin';

  // จัดการการล็อค UI (พนักงานดูได้อย่างเดียวถ้าปิดรอบแล้ว)
  const isFinal = status === 'final';
  
  if (isFinal && !isAdmin) {
    setTimeout(() => {
      document.querySelectorAll('.denom-qty-input, #drop-cash-input, #pkg-tracking, #pkg-amount, #pkg-payment').forEach(el => {
        el.setAttribute('readonly', true);
        el.setAttribute('disabled', true);
        el.style.opacity = '0.6';
      });
      const addBtn = document.querySelector('[onclick="addPackage()"]');
      if (addBtn) { addBtn.disabled = true; addBtn.style.opacity = '0.4'; }
      const commitBtn = document.getElementById('btn-finalize');
      if (commitBtn) { commitBtn.style.display = 'none'; }
    }, 300);
  } else {
    // ถ้ายังไม่ปิดรอบ พนักงานต้องกรอกช่องอื่นๆ ได้ (ยกเว้นยอดตั้งต้นที่ buildCash จัดการล็อคไว้แล้ว)
    setTimeout(() => {
      document.querySelectorAll('.denom-qty-input, #drop-cash-input, #pkg-tracking, #pkg-amount, #pkg-payment').forEach(el => {
        // เฉพาะ actual cash และ shipment เท่านั้นที่ต้องเปิดให้กรอก
        const isOpening = el.closest('#opening-list');
        if (!isOpening || isAdmin) {
          el.removeAttribute('readonly');
          el.removeAttribute('disabled');
          el.style.opacity = '1';
          el.style.cursor  = 'auto';
        }
      });
      const addBtn = document.querySelector('[onclick="addPackage()"]');
      if (addBtn) { addBtn.disabled = false; addBtn.style.opacity = '1'; }
      const commitBtn = document.getElementById('btn-finalize');
      if (commitBtn) { commitBtn.style.display = 'block'; }
    }, 300);
  }

  const adminSidebarItem = document.getElementById('admin-sidebar-item');
  const adminHeaderItem  = document.getElementById('admin-header-item');

  // แสดงเมนูแอดมินให้ทุกคนเห็น เพื่อให้พนักงานกดเข้าไปใส่รหัสแอดมินได้
  if (adminSidebarItem) adminSidebarItem.style.display = 'block';
  if (adminHeaderItem)  adminHeaderItem.style.display  = isAdmin ? 'flex'  : 'none';

  document.getElementById('display-user-name').textContent = currentUser.name;
  document.getElementById('user-initial').textContent = currentUser.name.charAt(0);

  const dropInp = document.getElementById('drop-cash-input');
  if (dropInp) dropInp.value = appData.drop_cash || '';
  const expNoteInp = document.getElementById('expenses-note-input');
  if (expNoteInp) expNoteInp.value = appData.expenses_note || '';
  const expAmtInp = document.getElementById('expenses-amount-input');
  if (expAmtInp) expAmtInp.value = appData.expenses_amount || '';
  buildCash('opening-list','opening','opening-total');
  buildCash('actual-list','actual','actual-total');
  renderPackages();
  updateDashboard();
  setLanguage(currentLang);
}

window.backToSessions = function() {
  if (targetUserId) {
    // ถ้า Admin เข้ามาแก้ข้อมูลพนักงาน พอกดกลับ ให้กลับไปหน้า admin
    window.location.href = 'admin.html';
    return;
  }
  document.getElementById('app-view').style.display = 'none';
  currentSessionDate = null;
  currentSessionCode = null;
  appData = { opening:{}, actual:{}, packages:[], status:'draft' };
  showSessionsView();
};

/* ===================== TABS ===================== */
const I18N_TITLES = {
  th: { 
    dashboard:'แดชบอร์ดตรวจสอบรายวัน', packages:'บันทึกพัสดุรับเข้า', opening:'บันทึกเงินตั้งต้น (เช้า)', actual:'นับเงินสด (เย็น)', history:'คลังจัดเก็บข้อมูล',
    authorize_session:'เข้าสู่ระบบเซสชัน', employee_id_placeholder:'รหัสพนักงาน', password_placeholder:'รหัสผ่าน',
    my_sessions:'รอบการทำงานของฉัน', sessions_subtitle:'เลือกรอบที่ต้องการทำงาน หรือสร้างรอบใหม่สำหรับวันนี้',
    new_session:'เปิดรอบวันใหม่', logout:'ออกจากระบบ', admin_panel:'หน้าควบคุมแอดมิน',
    overview_summary:'ภาพรวมสรุป', opening_tab:'เงินตั้งต้น (เช้า)', actual_tab:'นับเงินสด (เย็น)', shipment_log:'รายการพัสดุ', audit_history:'ประวัติการตรวจสอบ',
    admin_control:'ระบบจัดการแอดมิน', starting_balance:'ยอดเงินเริ่มต้น', daily_parcel_intake:'จำนวนพัสดุรับเข้าวันนี้', digital_verified:'ตรวจสอบยอดโอนแล้ว',
    expected_net_cash:'ยอดเงินสดที่ควรมี (สุทธิ)', initial_cash_sales:'(ยอดตั้งต้น + ขายเงินสด)', settlement_summary:'สรุปการปิดรอบ', export_report:'ส่งออกรายงาน',
    opening_float_label:'ยอดเงินตั้งต้นสาขา (1)', daily_sales_label:'ยอดขายเงินสดประจำวัน (2)', drop_cash_label:'ยอดนำส่งเงินพี่ก้อง', expenses_label:'ค่าใช้จ่ายอื่นๆ',
    actual_counted_label:'ยอดเงินสดที่นับได้จริง (สุทธิ)', net_variance:'ส่วนต่างยอดการตรวจสอบ', compliance_ready:'พร้อมรับการตรวจสอบ', compliance_desc:'ข้อมูลทั้งหมดถูกลงนามเข้ารหัส',
    cloud_sync_active:'ซิงค์ข้อมูลคลาวด์ทำงาน', sync_desc:'ข้อมูลถูกสำรองไปยังเซิร์ฟเวอร์หลักแล้ว', audit_lock_status:'สถานะการตรวจสอบ', draft_mode:'อยู่ระหว่างดำเนินการ',
    commit_audit:'ยืนยันการตรวจสอบ', reset_audit_logs:'ล้างข้อมูลบันทึกทั้งหมด', initial_phase_audit:'การตรวจสอบยอดตั้งต้น', final_phase_audit:'การตรวจสอบยอดเงินสดสุทธิ',
    new_shipment_entry:'บันทึกรายการพัสดุใหม่', scan_tracking_placeholder:'สแกนหรือพิมพ์รหัสพัสดุ...', amount_placeholder:'จำนวนเงิน (บาท)', physical_cash:'เงินสด', bank_transfer:'เงินโอน',
    record_shipment:'บันทึกข้อมูล', live_feed:'รายการล่าสุด', audit_logs:'บันทึกประวัติการตรวจสอบ', audit_date:'วันที่ตรวจสอบ', opening_col:'ยอดตั้งต้น', shipments:'จำนวนพัสดุ',
    cash_col:'ยอดเงินสด', digital_col:'ยอดโอน', expected_col:'ยอดรวมที่ควรมี', session_date_label:'📅 วันที่ของรอบ', employee_id_label:'🪪 รหัสพนักงาน', nickname_label:'👤 ชื่อเล่น',
    create_session_title:'เปิดรอบวันใหม่', create_session_subtitle:'กรอกข้อมูลรอบการทำงาน', confirm_open_session:'เปิดรอบนี้', cancel_btn:'ยกเลิก', back_btn:'ย้อนกลับ',
    actual_counted: 'ยอดเงินที่นับได้', shipments_count: 'พัสดุ', diff_label: 'ส่วนต่าง'
  },
  en: { 
    dashboard:'Daily Audit Dashboard', packages:'Intake Synchronization', opening:'Opening Float Phase', actual:'Final Cash Audit Phase', history:'Operation Archives',
    authorize_session:'Authorize Session', employee_id_placeholder:'Employee ID', password_placeholder:'Password',
    my_sessions:'My Daily Sessions', sessions_subtitle:'Select an active session or create a new one for today.',
    new_session:'Start New Session', logout:'Logout System', admin_panel:'Admin Control Panel',
    overview_summary:'Overview Summary', opening_tab:'Opening Float (Morning)', actual_tab:'Actual Cash (Evening)', shipment_log:'Shipment Log', audit_history:'Audit History',
    admin_control:'Admin Control', starting_balance:'Starting balance', daily_parcel_intake:'Daily parcel intake', digital_verified:'Digital verified',
    expected_net_cash:'Expected Net Cash', initial_cash_sales:'(Initial + Cash Sales)', settlement_summary:'Settlement Summary', export_report:'Export Report',
    opening_float_label:'Branch Opening Float (1)', daily_sales_label:'Daily Physical Cash Sales (2)', drop_cash_label:'Cash Drop (Sent to Bank)', expenses_label:'Other Expenses',
    actual_counted_label:'Actual Counted Cash (Final)', net_variance:'Net Reconciliation Variance', compliance_ready:'Compliance Ready', compliance_desc:'All audits are cryptographically signed.',
    cloud_sync_active:'Cloud Sync Active', sync_desc:'Data synchronized with Master Hub.', audit_lock_status:'Audit Lock Status', draft_mode:'DRAFT MODE',
    commit_audit:'COMMIT AUDIT', reset_audit_logs:'Reset Audit Logs', initial_phase_audit:'Initial Phase Audit', final_phase_audit:'Final Phase Audit',
    new_shipment_entry:'New Shipment Entry', scan_tracking_placeholder:'Scan Tracking ID...', amount_placeholder:'Amount (THB)', physical_cash:'Physical Cash', bank_transfer:'Bank Transfer',
    record_shipment:'Record Shipment', live_feed:'Live Feed', audit_logs:'Audit Logs', audit_date:'Audit Date', opening_col:'Opening Cash', shipments:'Shipments',
    cash_col:'Cash Col.', digital_col:'Digital Col.', expected_col:'Expected Total', session_date_label:'📅 Session Date', employee_id_label:'🪪 Employee ID', nickname_label:'👤 Nickname',
    create_session_title:'Start New Session', create_session_subtitle:'Enter session identification details', confirm_open_session:'Open Session', cancel_btn:'Cancel', back_btn:'Back',
    actual_counted: 'Actual Counted', shipments_count: 'Units', diff_label: 'Variance'
  }
};

let currentLang = localStorage.getItem('jnt_lang') || 'th';

function showTab(el) {
  document.querySelectorAll('.nav-item').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+el.dataset.tab).classList.add('active');
  const titleEl = document.getElementById('active-tab-title');
  if (titleEl) titleEl.textContent = I18N_TITLES[currentLang][el.dataset.tab] || 'Operations';
  if (el.dataset.tab === 'history') renderHistorySelect();
}
window.showTab = showTab;

/* ===================== CASH TABLES ===================== */
function buildCash(containerId, prefix, totalId) {
  const container = document.getElementById(containerId); if(!container)return;
  const saved = load(prefix)||{};
  container.innerHTML = '';
  const isReadonly = prefix==='opening' && currentUser && currentUser.role!=='admin';
  const roAttr = isReadonly ? 'readonly disabled style="opacity:0.6;cursor:not-allowed;"' : '';
  DENOMS.forEach(dn => {
    const qty = saved[dn]||0;
    const card = document.createElement('div');
    card.className='denom-card';
    card.innerHTML=`
      <div class="denom-info"><div class="denom-val">${dn.toLocaleString('th-TH')} <span>THB</span></div></div>
      <input type="number" min="0" value="${qty}" class="denom-qty-input" id="${prefix}_${dn}"
        oninput="window.onCashInput('${prefix}','${totalId}')" placeholder="0" ${roAttr}/>
      <div class="denom-subtotal" id="${prefix}_s_${dn}">${fmt(qty*dn)}</div>`;
    container.appendChild(card);
  });
  recalcCash(prefix,totalId);
}

window.onCashInput = function(prefix, totalId) {
  if (prefix==='opening' && currentUser && currentUser.role!=='admin') {
    showToast('เฉพาะแอดมินเท่านั้นที่แก้ไขได้');
    const data=load(prefix)||{};
    DENOMS.forEach(dn=>{ const inp=document.getElementById(`${prefix}_${dn}`); if(inp)inp.value=data[dn]||0; });
    return;
  }
  recalcCash(prefix,totalId); updateDashboard();
};

window.onDropCashInput = function(val) {
  appData.drop_cash=parseFloat(val)||0;
  save('drop_cash_dummy',appData.drop_cash);
  updateDashboard();
};

window.onExpensesNoteInput = function(val) {
  appData.expenses_note = val;
  save('expenses_note_dummy', val);
  updateDashboard();
};

window.onExpensesAmountInput = function(val) {
  appData.expenses_amount = parseFloat(val)||0;
  save('expenses_amount_dummy', appData.expenses_amount);
  updateDashboard();
};

function recalcCash(prefix,totalId){
  const data={}; let total=0;
  DENOMS.forEach(dn=>{
    const inp=document.getElementById(`${prefix}_${dn}`);
    const qty=Math.max(0,parseInt(inp?.value)||0);
    data[dn]=qty; const sub=qty*dn; total+=sub;
    const cell=document.getElementById(`${prefix}_s_${dn}`); if(cell)cell.textContent=fmt(sub);
  });
  save(prefix,data);
  const totalEl=document.getElementById(totalId); if(totalEl)totalEl.textContent=fmt(total);
}

/* ===================== PACKAGES ===================== */
function getPackages(){ return load('packages')||[]; }

window.addPackage = function() {
  const tracking = document.getElementById('pkg-tracking').value.trim();
  const amount   = parseFloat(document.getElementById('pkg-amount').value)||0;
  const payment  = document.getElementById('pkg-payment').value;
  if (!tracking){ showToast('⚠️ กรุณากรอกรหัสพัสดุ'); return; }
  const list=getPackages();
  if(list.some(p=>p.tracking===tracking)){ showToast('❌ รหัสพัสดุซ้ำ'); document.getElementById('pkg-tracking').select(); return; }
  list.unshift({id:Date.now(),tracking,amount,payment,time:new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})});
  save('packages',list);
  document.getElementById('pkg-tracking').value='';
  document.getElementById('pkg-amount').value='';
  document.getElementById('pkg-tracking').focus();
  renderPackages(); updateDashboard(); showToast('✅ บันทึกพัสดุแล้ว');
};

window.deletePackage = function(id) {
  if(!confirm('ลบรายการนี้ใช่หรือไม่?'))return;
  save('packages',getPackages().filter(p=>p.id!==id));
  renderPackages(); updateDashboard();
};

function renderPackages(){
  const list=getPackages(); const feed=document.getElementById('packages-tbody'); if(!feed)return;
  if(!list.length){ feed.innerHTML='<div style="padding:40px;text-align:center;opacity:0.3;">No active feed...</div>'; return; }
  feed.innerHTML='';
  list.forEach(p=>{
    const div=document.createElement('div');
    div.style.cssText='padding:16px 20px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;';
    div.innerHTML=`
      <div style="display:flex;flex-direction:column;gap:4px;">
        <span style="font-weight:800;font-size:14px;color:var(--text-main);">${esc(p.tracking)}</span>
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);opacity:0.6;">${p.time} • ${p.payment}</span>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <span style="font-weight:900;font-size:15px;">${fmt(p.amount)}</span>
        <i class="fas fa-trash" style="cursor:pointer;color:var(--danger);font-size:12px;" onclick="deletePackage(${p.id})"></i>
      </div>`;
    feed.appendChild(div);
  });
}

/* ===================== DASHBOARD ===================== */
function updateDashboard(){
  const opening=cashTotal('opening'), actual=cashTotal('actual');
  const pkgs=getPackages(), dropCash=parseFloat(appData.drop_cash)||0;
  const expensesAmount=parseFloat(appData.expenses_amount)||0;
  let cashPkg=0, transfer=0;
  pkgs.forEach(p=>{ if(p.payment==='เงินสด')cashPkg+=parseFloat(p.amount)||0; else transfer+=parseFloat(p.amount)||0; });
  const expected=opening+cashPkg-dropCash-expensesAmount, diff=actual-expected;
  const upd=(id,val)=>{ const el=document.getElementById(id); if(el)el.textContent=val; };
  upd('d-opening',fmt(opening)); upd('d-pkg-count',pkgs.length);
  upd('d-transfer',fmt(transfer)); upd('s-expected',fmt(expected));
  upd('s-opening-dash',fmt(opening)); 
  upd('opening-total',fmt(opening)); // Update Morning Summary Card
  upd('s-cash-pkg-dash',fmt(cashPkg));
  upd('s-drop-cash-dash','-'+fmt(dropCash)); 
  upd('s-expenses-dash','-'+fmt(expensesAmount));
  const expNoteEl = document.getElementById('s-expenses-note');
  if(expNoteEl) { expNoteEl.textContent = appData.expenses_note ? `(${appData.expenses_note})` : ''; }
  upd('s-actual-dash',fmt(actual)); 
  upd('actual-total',fmt(actual));   // Update Evening Summary Card

  // แสดงผลส่วนต่างให้ชัดเจน (เกิน/ขาด)
  const diffEl = document.getElementById('actual-diff-dash');
  if(diffEl){
    if(diff > 0) {
      diffEl.textContent = `+ ${fmt(diff)} (ยอดเกิน)`;
      diffEl.style.color = '#10b981';
    } else if(diff < 0) {
      diffEl.textContent = `- ${fmt(Math.abs(diff))} (ยอดขาด)`;
      diffEl.style.color = '#ef4444';
    } else {
      diffEl.textContent = '฿0.00 (ยอดตรงพอดี)';
      diffEl.style.color = '#10b981';
    }
  }
  
  upd('s-diff',fmt(diff));
  const fState=document.getElementById('finalize-state');
  const btn=document.getElementById('btn-finalize');
  const lockIcon=document.getElementById('lock-icon');
  if(appData.status==='final'){
    if(fState){fState.textContent='ปิดยอดเรียบร้อยแล้ว';fState.style.color='var(--success)';}
    if(btn){btn.disabled=true;btn.textContent='ยืนยันแล้ว';btn.style.opacity='0.5';}
    if(lockIcon){lockIcon.className='fas fa-lock';lockIcon.style.color='var(--success)';}
  } else {
    if(fState){fState.textContent='อยู่ระหว่างดำเนินการ';fState.style.color='var(--warning)';}
    if(btn){btn.disabled=false;btn.textContent='ยืนยันการตรวจสอบ';btn.style.opacity='1';}
    if(lockIcon){lockIcon.className='fas fa-lock-open';lockIcon.style.color='var(--primary)';}
  }
}

/* ===================== CLEAR ===================== */
window.clearDayData = function(){
  if(!confirm('ต้องการล้างบันทึกรายวันใช่หรือไม่?\nการดำเนินการนี้ไม่สามารถย้อนกลับได้'))return;
  appData={opening:{},actual:{},packages:[],status:'draft'};
  syncToDB();
  buildCash('opening-list','opening','opening-total');
  buildCash('actual-list','actual','actual-total');
  renderPackages(); updateDashboard(); showToast('🗑️ ล้างข้อมูลเรียบร้อย');
};

/* ===================== FINALIZE ===================== */
window.finalizeSettlement = function(){
  if(!confirm('ยืนยันการปิดยอดรายวัน?\nจะไม่สามารถแก้ไขข้อมูลได้อีก'))return;
  appData.status='final';
  syncToDB(); showToast('✅ ล็อคเซสชันเรียบร้อย'); updateDashboard();
  setTimeout(()=>{ showToast('📊 ข้อมูลถูกส่งไปยังหน้า Admin แล้ว'); },2000);
};

/* ===================== HISTORY ===================== */
let userHistory=[];
async function renderHistorySelect(){
  if(!currentUser)return;
  try{ 
    // ดึงประวัติรวมของทั้งสาขามาแสดงผล (ให้ทุกคนเห็นยอดของกันและกันได้ในหน้าประวัติ)
    const res = await fetch('/api/admin/summary'); 
    userHistory = await res.json(); 
  } catch(e) { userHistory=[]; }
  const select=document.getElementById('hist-month-select'); if(!select)return;
  select.innerHTML='<option value="all">คลังบันทึกทั้งหมด</option>';
  const months=new Set();
  userHistory.forEach(r=>months.add(r.date.substring(0,7)));
  Array.from(months).forEach(ym=>{
    const [y,m]=ym.split('-');
    const mName=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][parseInt(m)-1];
    const opt=document.createElement('option');
    opt.value=ym; opt.textContent=`${mName} ${y}`;
    if(ym===(currentSessionDate||today).substring(0,7))opt.selected=true;
    select.appendChild(opt);
  });
  renderHistory();
}

window.renderHistory = function(){
  const val=document.getElementById('hist-month-select').value;
  const filtered=val==='all'?userHistory:userHistory.filter(r=>r.date.startsWith(val));
  const tbody=document.getElementById('hist-daily-tbody'); if(!tbody)return;
  tbody.innerHTML='';
  filtered.forEach(r=>{
    let expensesTotal = 0;
    try { if(r.data_json) expensesTotal = parseFloat(JSON.parse(r.data_json).expenses_amount) || 0; } catch(e){}
    const expected=(r.opening_total||0)+(r.cash_pkg_total||0)-(r.drop_cash_total||0)-expensesTotal;
    const diff=r.actual_total!=null?(r.actual_total-expected):0;
    const color=diff>=0?'var(--success)':'var(--danger)';
    const tr=document.createElement('tr');
    tr.style.cssText='height:64px;border-bottom:1px solid var(--border-color);';
    tr.innerHTML=`
      <td style="padding:0 24px;"><strong>${fmtDate(r.date)}</strong><div style="font-size:11px;color:var(--text-muted);">${esc(r.session_code||'-')}</div></td>
      <td style="padding:0 24px;">${fmt(r.opening_total)}</td>
      <td style="padding:0 24px;font-weight:700;">${r.pkg_count||0}</td>
      <td style="padding:0 24px;">${fmt(r.cash_pkg_total)}</td>
      <td style="padding:0 24px;">${fmt(r.transfer_total)}</td>
      <td style="padding:0 24px;font-weight:700;color:var(--primary);">${fmt(expected)}</td>
      <td style="padding:0 24px;font-weight:900;text-align:right;color:${color};">${r.actual_total!=null?fmt(diff):'-'}</td>`;
    tbody.appendChild(tr);
  });
};

/* ===================== AUTH ===================== */
window.checkAuth = async function(){
  const cu=localStorage.getItem('jnt_current_user');
  if(cu){
    currentUser=JSON.parse(cu);
    document.getElementById('auth-view').style.display='none';
    
    // Check if URL has edit params for Admin
    const params = new URLSearchParams(window.location.search);
    const editUid = params.get('edit_uid');
    const editDate = params.get('edit_date');
    if (currentUser.role === 'admin' && editUid && editDate) {
      targetUserId = editUid;
      // Get the code from DB if exists
      let code = '-';
      try {
        const hRes = await fetch('/api/history/'+editUid);
        const hData = await hRes.json();
        const rec = hData.find(r => r.date === editDate);
        if(rec) code = rec.session_code || '-';
      }catch(e){}
      await openSession(editDate, code, 'edit_mode');
    } else {
      showSessionsView();
    }
  } else {
    document.getElementById('auth-view').style.display='flex';
    document.getElementById('sessions-view').style.display='none';
    document.getElementById('app-view').style.display='none';
  }
};

window.doLogin = async function(){
  const u=document.getElementById('l-user').value.trim();
  const p=document.getElementById('l-pass').value.trim();
  if(!u||!p)return showToast('MISSING CREDENTIALS');
  try{
    const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const data=await res.json();
    if(data.error)return showToast(data.error);
    localStorage.setItem('jnt_current_user',JSON.stringify(data));
    checkAuth();
  }catch(e){showToast('SERVER DISCONNECTED');}
};

window.doLogout = function(){
  if(confirm('ต้องการออกจากระบบหรือไม่?')){
    localStorage.removeItem('jnt_current_user');
    location.reload();
  }
};

/* ===================== I18N ===================== */
function translatePage() {
  const lang = currentLang;
  const dict = I18N_TITLES[lang];
  if (!dict) return;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      // Check if it's a button with an icon
      const icon = el.querySelector('i');
      if (icon) {
        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) node.textContent = ' ' + dict[key];
        });
      } else {
        el.textContent = dict[key];
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.placeholder = dict[key];
  });

  // Update dynamic titles
  const activeTab = document.querySelector('.nav-item.active');
  if (activeTab) {
    const titleEl = document.getElementById('active-tab-title');
    if (titleEl) titleEl.textContent = dict[activeTab.dataset.tab] || 'Operations';
  }
}

function setLanguage(lang){
  currentLang=lang;
  localStorage.setItem('jnt_lang',lang);
  const btn=document.getElementById('lang-toggle-btn');
  if(btn&&btn.querySelector('span'))btn.querySelector('span').textContent=lang==='th'?'EN':'TH';
  translatePage();
  updateDashboard();
}
window.toggleLanguage = function(){ setLanguage(currentLang==='th'?'en':'th'); };

/* ===================== EXPORT ===================== */
window.exportReport = function(){
  const body=document.getElementById('app-body');
  if(body)body.setAttribute('data-date',currentSessionDate||today);
  window.print();
};

/* ===================== KEYBOARD ===================== */
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    if(document.activeElement.id==='pkg-tracking')document.getElementById('pkg-amount').focus();
    else if(document.activeElement.id==='pkg-amount')addPackage();
    else if(document.activeElement.id==='l-pass')doLogin();
    else if(document.activeElement.id==='new-session-code')confirmCreateSession();
  }
});

/* ===================== INIT ===================== */
checkAuth();
setLanguage(currentLang);
