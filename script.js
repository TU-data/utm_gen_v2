// ── Firebase ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDS_l3bAuXMgXVOC5NCEeBfJnLey5PluWI",
  authDomain: "utm-gen-efc65.firebaseapp.com",
  projectId: "utm-gen-efc65",
  storageBucket: "utm-gen-efc65.firebasestorage.app",
  messagingSenderId: "281400998954",
  appId: "1:281400998954:web:26c0d9fa1d93d45a01d753"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ── Local state ─────────────────────────────────────────────
let rows = [];
let nextId = 1;
let _pendingUpdates = {};

const DEPT_OPTIONS = ['바이럴팀', '데이터팀', '컨텐츠팀'];

function generateId() { return nextId++; }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function sanitize(val) {
  return (val || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function buildUTM(row) {
  const base = (row.url || '').trim();
  const src = sanitize(row.source);
  const med = sanitize(row.medium);
  const cam = sanitize(row.campaign);
  const ter = sanitize(row.term);
  const con = sanitize(row.content);

  if (!base || !src || !med || !cam) return null;

  const params = [];
  if (src) params.push(`utm_source=${encodeURIComponent(src)}`);
  if (med) params.push(`utm_medium=${encodeURIComponent(med)}`);
  if (cam) params.push(`utm_campaign=${encodeURIComponent(cam)}`);
  if (ter) params.push(`utm_term=${encodeURIComponent(ter)}`);
  if (con) params.push(`utm_content=${encodeURIComponent(con)}`);

  const sep = base.includes('?') ? '&' : '?';
  return base + sep + params.join('&');
}

function maybeStampDate(row) {
  if (!row.createdAt && row.url && row.source && row.medium && row.campaign) {
    row.createdAt = todayStr();
  }
}

function isComplete(row) {
  return !!(row.url && row.source && row.medium && row.campaign);
}

// ── Cell HTML helpers ────────────────────────────────────────
function deptCellHTML(row) {
  const isCustom = row.dept && !DEPT_OPTIONS.includes(row.dept);
  const selectVal = isCustom ? '기타' : (row.dept || '');

  const options = [
    `<option value="">— 선택 —</option>`,
    ...DEPT_OPTIONS.map(d => `<option value="${d}" ${selectVal===d?'selected':''}>${d}</option>`),
    `<option value="기타" ${selectVal==='기타'?'selected':''}>기타 (직접입력)</option>`
  ].join('');

  if (isCustom) {
    return `<div class="dept-cell">
      <input class="dept-custom-input" value="${escHtml(row.dept)}"
        placeholder="부서명 직접 입력..."
        oninput="updateCell(${row.id},'dept',this.value)"
        onblur="if(!this.value.trim()){updateCell(${row.id},'dept','');rerenderDeptCell(${row.id});}" />
    </div>`;
  }
  return `<div class="dept-cell">
    <select class="dept-select" onchange="handleDeptChange(${row.id},this)">
      ${options}
    </select>
  </div>`;
}

function rerenderDeptCell(id) {
  const row = rows.find(r => r.id === id);
  if (!row) return;
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (!tr) return;
  const deptTd = tr.querySelector('.dept-td');
  if (deptTd) deptTd.innerHTML = deptCellHTML(row);
}

function handleDeptChange(id, sel) {
  const row = rows.find(r => r.id === id);
  if (!row) return;
  if (sel.value === '기타') {
    row.dept = '';
    rerenderDeptCell(id);
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) { const inp = tr.querySelector('.dept-custom-input'); if (inp) inp.focus(); }
  } else {
    row.dept = sel.value;
    if (row.firebaseId) {
      db.collection('utm_rows').doc(row.firebaseId).update({ dept: row.dept }).catch(console.error);
    }
  }
}

function handleSidebarMediumChange(sel) {
  const customInput = document.getElementById('new-medium-custom');
  if (sel.value === '기타') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = '';
  }
}

const MEDIUM_OPTIONS_LIST = ['cpc','display','social','paid_social','sms','email','push'];

function handleMediumCellChange(id, sel) {
  const row = rows.find(r => r.id === id);
  if (!row) return;
  if (sel.value === '기타') {
    row.medium = '';
    renderTable();
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) {
      const inp = tr.querySelectorAll('.dept-custom-input')[0];
      if (inp) inp.focus();
    }
  } else {
    row.medium = sel.value;
    maybeStampDate(row);
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) {
      const utm = buildUTM(row);
      const ok = isComplete(row);
      const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');
      const resultCell = tr.querySelector('.utm-result');
      if (resultCell) {
        resultCell.innerHTML = `
          <div class="status-dot ${dotClass}"></div>
          <div class="utm-url ${utm ? '' : 'empty'}">${utm ? escHtml(utm) : '— 필수 항목을 입력하세요'}</div>
          ${utm ? `<button class="copy-btn" onclick="copyUTM(this, '${escAttr(utm)}')">복사</button>` : ''}
          <button class="delete-row-btn" onclick="deleteRow(${row.id})">삭제</button>
        `;
      }
      if (!row.createdAt) {
        const dateBadge = tr.querySelector('.date-badge');
        if (dateBadge && row.createdAt) { dateBadge.textContent = row.createdAt; dateBadge.classList.add('set'); }
      }
    }
    if (row.firebaseId) {
      const update = { medium: row.medium };
      if (row.createdAt) update.createdAt = row.createdAt;
      db.collection('utm_rows').doc(row.firebaseId).update(update).catch(console.error);
    }
    updateStats();
  }
}

function handleSidebarDeptChange(sel) {
  const customInput = document.getElementById('new-dept-custom');
  if (sel.value === '기타') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = '';
  }
}

// ── Render ───────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('utm-tbody');
  const empty = document.getElementById('empty-state');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    updateStats();
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map((row) => {
    const utm = buildUTM(row);
    const ok = isComplete(row);
    const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');

    return `<tr data-id="${row.id}" class="${row.selected ? 'selected' : ''}">
      <td style="text-align:center; position:sticky;left:0;background:var(--surface);">
        <input type="checkbox" class="row-check" ${row.selected ? 'checked' : ''}
          onchange="toggleRow(${row.id}, this)" />
      </td>
      <td><input class="cell-input" value="${escHtml(row.url||'')}" placeholder="https://..." oninput="updateCell(${row.id},'url',this.value)" /></td>
      <td><div class="dept-cell">
        <select class="dept-select" onchange="updateCell(${row.id},'source',this.value)">
          <option value="">— 선택 —</option>
          ${['naver','google','kakao','sms','meta','x'].map(s => `<option value="${s}" ${(row.source||'') === s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div></td>
      <td><div class="dept-cell">
        <select class="dept-select" onchange="handleMediumCellChange(${row.id},this)">
          <option value="">— 선택 —</option>
          ${['cpc','display','social','paid_social','sms','email','push'].map(m => `<option value="${m}" ${(row.medium||'')=== m?'selected':''}>${m}</option>`).join('')}
          <option value="기타" ${row.medium && !['cpc','display','social','paid_social','sms','email','push'].includes(row.medium)?'selected':''}>기타 (직접입력)</option>
        </select>
      </div>
      ${row.medium && !['cpc','display','social','paid_social','sms','email','push'].includes(row.medium) ? `<div style="padding:0 8px;"><input class="dept-custom-input" style="border-left-color:var(--accent)" value="${escHtml(row.medium)}" placeholder="직접 입력..." oninput="updateCell(${row.id},'medium',this.value)" /></div>` : ''}
      </td>
      <td><input class="cell-input" value="${escHtml(row.campaign||'')}" placeholder="campaign" oninput="updateCell(${row.id},'campaign',this.value)" /></td>
      <td><input class="cell-input" value="${escHtml(row.term||'')}" placeholder="keyword" oninput="updateCell(${row.id},'term',this.value)" /></td>
      <td><input class="cell-input" value="${escHtml(row.content||'')}" placeholder="banner_a" oninput="updateCell(${row.id},'content',this.value)" /></td>
      <td>
        <div class="date-cell">
          <span class="date-badge ${row.createdAt ? 'set' : ''}">${row.createdAt || '—'}</span>
        </div>
      </td>
      <td class="dept-td">${deptCellHTML(row)}</td>
      <td>
        <div class="utm-result">
          <div class="status-dot ${dotClass}"></div>
          <div class="utm-url ${utm ? '' : 'empty'}">${utm ? escHtml(utm) : '— 필수 항목을 입력하세요'}</div>
          ${utm ? `<button class="copy-btn" onclick="copyUTM(this, '${escAttr(utm)}')">복사</button>` : ''}
          <button class="delete-row-btn" onclick="deleteRow(${row.id})">삭제</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  updateStats();
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return String(str).replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

function updateCell(id, field, value) {
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row[field] = value;

  const wasComplete = !!row.createdAt;
  maybeStampDate(row);

  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    const utm = buildUTM(row);
    const ok = isComplete(row);
    const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');
    const resultCell = tr.querySelector('.utm-result');
    if (resultCell) {
      resultCell.innerHTML = `
        <div class="status-dot ${dotClass}"></div>
        <div class="utm-url ${utm ? '' : 'empty'}">${utm ? escHtml(utm) : '— 필수 항목을 입력하세요'}</div>
        ${utm ? `<button class="copy-btn" onclick="copyUTM(this, '${escAttr(utm)}')">복사</button>` : ''}
      `;
    }
    if (!wasComplete && row.createdAt) {
      const dateBadge = tr.querySelector('.date-badge');
      if (dateBadge) {
        dateBadge.textContent = row.createdAt;
        dateBadge.classList.add('set');
      }
    }
  }
  updateStats();

  // Firestore 업데이트 (디바운스 800ms)
  if (row.firebaseId) {
    clearTimeout(_pendingUpdates[id]);
    _pendingUpdates[id] = setTimeout(() => {
      const update = { [field]: value };
      if (row.createdAt) update.createdAt = row.createdAt;
      db.collection('utm_rows').doc(row.firebaseId).update(update).catch(console.error);
    }, 800);
  }
}

function addRow(data = {}) {
  const deptSel = document.getElementById('new-dept');
  const deptCustom = document.getElementById('new-dept-custom');
  let dept = '';
  if (deptSel.value === '기타') {
    dept = deptCustom.value.trim();
  } else {
    dept = deptSel.value;
  }

  const url = data.url || document.getElementById('new-url').value.trim();
  const source = data.source || document.getElementById('new-source').value.trim();
  const medSelEl = document.getElementById('new-medium');
  const medCustomEl = document.getElementById('new-medium-custom');
  let medium = data.medium || (medSelEl.value === '기타' ? medCustomEl.value.trim() : medSelEl.value);
  const campaign = data.campaign || document.getElementById('new-campaign').value.trim();
  const term = data.term || document.getElementById('new-term').value.trim();
  const content = data.content || document.getElementById('new-content').value.trim();

  const newRowData = { url, source, medium, campaign, term, content,
    dept: data.dept || dept, createdAt: data.createdAt || null, _order: Date.now() };
  maybeStampDate(newRowData);

  db.collection('utm_rows').add(newRowData).catch(console.error);

  ['new-url','new-campaign','new-term','new-content'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('new-source').value = '';
  document.getElementById('new-medium').value = '';
  document.getElementById('new-medium-custom').value = '';
  document.getElementById('new-medium-custom').style.display = 'none';
  deptSel.value = '';
  deptCustom.value = '';
  deptCustom.style.display = 'none';
  showToast('행이 추가되었습니다');
}

function addMultipleRows() {
  db.collection('utm_rows').add({ url:'', source:'', medium:'', campaign:'', term:'', content:'',
    dept:'', createdAt: null, _order: Date.now() }).catch(console.error);
}

function deleteRow(id) {
  if (!confirm('이 행을 삭제할까요?')) return;
  const row = rows.find(r => r.id === id);
  if (!row || !row.firebaseId) return;
  db.collection('utm_rows').doc(row.firebaseId).delete().catch(console.error);
}

function toggleRow(id, el) {
  const row = rows.find(r => r.id === id);
  if (row) row.selected = el.checked;
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) tr.classList.toggle('selected', el.checked);
  updateStats();
}

function toggleAll(el) {
  rows.forEach(r => r.selected = el.checked);
  renderTable();
}

function selectAll() {
  rows.forEach(r => r.selected = true);
  renderTable();
  document.getElementById('check-all').checked = true;
}

function clearSelected() {
  const selected = rows.filter(r => r.selected);
  if (selected.length === 0) { showToast('선택된 행이 없습니다'); return; }
  const batch = db.batch();
  selected.forEach(row => {
    if (row.firebaseId) batch.delete(db.collection('utm_rows').doc(row.firebaseId));
  });
  batch.commit().catch(console.error);
  showToast(`${selected.length}개 행이 삭제되었습니다`);
}

function copyUTM(btn, url) {
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '완료!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('copied'); }, 1500);
  });
}

function copyAllUTMs() {
  const utms = rows.map(r => buildUTM(r)).filter(Boolean);
  if (utms.length === 0) { showToast('완성된 URL이 없습니다'); return; }
  navigator.clipboard.writeText(utms.join('\n')).then(() => {
    showToast(`${utms.length}개 URL이 복사되었습니다`);
  });
}

function exportCSV() {
  if (rows.length === 0) { showToast('데이터가 없습니다'); return; }
  const headers = ['생성 날짜','생성 부서','Base URL','UTM Source','UTM Medium','UTM Campaign','UTM Term','UTM Content','UTM URL'];
  const csvRows = rows.map(r => {
    const utm = buildUTM(r) || '';
    return [r.createdAt||'', r.dept||'', r.url, r.source, r.medium, r.campaign, r.term, r.content, utm]
      .map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',');
  });
  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `utm_links_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('CSV 파일이 다운로드됩니다');
}

function applyPreset(source, medium) {
  const sel = document.getElementById('new-source');
  const options = Array.from(sel.options).map(o => o.value);
  const match = options.find(o => o.toLowerCase() === source.toLowerCase());
  sel.value = match || '';
  const medSel = document.getElementById('new-medium');
  const medCustom = document.getElementById('new-medium-custom');
  const medOpts = Array.from(medSel.options).map(o => o.value);
  if (medOpts.includes(medium)) {
    medSel.value = medium;
    medCustom.style.display = 'none';
    medCustom.value = '';
  } else {
    medSel.value = '기타';
    medCustom.style.display = 'block';
    medCustom.value = medium;
  }
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  event.target.classList.add('active');
}

function updateStats() {
  const total = rows.length;
  const complete = rows.filter(r => isComplete(r)).length;
  const incomplete = total - complete;
  document.getElementById('row-count').textContent = total;
  document.getElementById('complete-count').textContent = complete;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-complete').textContent = complete;
  document.getElementById('stat-incomplete').textContent = incomplete;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('.sidebar')) addRow();
});

// ── Firestore 실시간 동기화 ──────────────────────────────────
db.collection('utm_rows').onSnapshot(snapshot => {
  const active = document.activeElement;
  const isEditing = active && active.closest && active.closest('#utm-tbody');

  rows = snapshot.docs.map(d => {
    const data = d.data();
    const existing = rows.find(r => r.firebaseId === d.id);
    return {
      id: existing ? existing.id : generateId(),
      firebaseId: d.id,
      url: data.url || '',
      source: data.source || '',
      medium: data.medium || '',
      campaign: data.campaign || '',
      term: data.term || '',
      content: data.content || '',
      dept: data.dept || '',
      createdAt: data.createdAt || null,
      selected: existing ? existing.selected : false,
      _order: data._order || 0
    };
  }).sort((a, b) => a._order - b._order);

  if (!isEditing) renderTable();
}, error => {
  console.error('Firestore 오류:', error);
});
