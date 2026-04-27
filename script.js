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
let filters = { url: '', source: '', medium: '' };
const _BITLY_INJECTED = '__BITLY_TOKEN__';
let BITLY_TOKEN = _BITLY_INJECTED.startsWith('__') ? '' : _BITLY_INJECTED;
const _shorteningQueue = new Set();

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
    const prevUtm2 = buildUTM(row);
    const prevShortUrl2 = row.shortUrl;
    row.medium = sel.value;
    const newUtm2 = buildUTM(row);
    if (prevUtm2 !== newUtm2 && prevShortUrl2) {
      _archiveBitlyLink(prevShortUrl2);
      row.shortUrl = null;
      row.shortUrlFor = null;
    }
    maybeStampDate(row);
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) {
      const utm = buildUTM(row);
      const ok = isComplete(row);
      const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');
      const resultCell = tr.querySelector('.utm-result');
      if (resultCell) {
        resultCell.innerHTML = utmResultCellHTML(row);
      }
      const shortTd = tr.querySelector('.short-td');
      if (shortTd) {
        shortTd.innerHTML = shortUrlCellHTML(row);
      }
      const copyTd = tr.querySelector('.copy-td');
      if (copyTd) {
        const utm2 = buildUTM(row);
        copyTd.innerHTML = utm2 ? `<button class="copy-btn" onclick="copyUTM(this,'${escAttr(utm2)}')">복사</button>` : '';
      }
      if (!row.createdAt) {
        const dateBadge = tr.querySelector('.date-badge');
        if (dateBadge && row.createdAt) { dateBadge.textContent = row.createdAt; dateBadge.classList.add('set'); }
      }
    }
    if (row.firebaseId) {
      const update = { medium: row.medium };
      if (row.createdAt) update.createdAt = row.createdAt;
      if (prevUtm2 !== newUtm2 && prevShortUrl2) {
        update.shortUrl = firebase.firestore.FieldValue.delete();
        update.shortUrlFor = firebase.firestore.FieldValue.delete();
      }
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

// ── 단축 URL 셀 HTML 헬퍼 ────────────────────────────────────
function shortUrlCellHTML(row) {
  const utm = buildUTM(row);
  if (!utm || !BITLY_TOKEN) return '<div class="short-cell-empty">—</div>';
  if (row.shortUrl && row.shortUrlFor === utm) {
    return `<div class="short-cell">
      <a class="short-url-text" href="${escHtml(row.shortUrl)}" target="_blank" rel="noopener">${escHtml(row.shortUrl)}</a>
      <button class="copy-btn" onclick="copyUTM(this,'${escAttr(row.shortUrl)}')">복사</button>
    </div>`;
  }
  if (_shorteningQueue.has(row.firebaseId)) {
    return '<div class="utm-short-pending">생성 중…</div>';
  }
  return `<button class="short-gen-btn" onclick="generateShortUrl(${row.id})">생성</button>`;
}

// ── UTM 결과 셀 HTML 헬퍼 ────────────────────────────────────
function utmResultCellHTML(row) {
  const utm = buildUTM(row);
  const ok = isComplete(row);
  const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');

  return `<div class="utm-result-main">
      <div class="status-dot ${dotClass}"></div>
      <div class="utm-url ${utm ? '' : 'empty'}">${utm ? escHtml(utm) : '— 필수 항목을 입력하세요'}</div>
    </div>`;
}

// ── Render ───────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('utm-tbody');
  const empty = document.getElementById('empty-state');

  const filteredRows = rows.filter(r => {
    if (filters.url && r.url !== filters.url) return false;
    if (filters.source && r.source !== filters.source) return false;
    if (filters.medium && r.medium !== filters.medium) return false;
    return true;
  });

  if (filteredRows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    updateStats(filteredRows);
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filteredRows.map((row) => {
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
      <td><div class="utm-result">${utmResultCellHTML(row)}</div></td>
      <td class="short-td">${shortUrlCellHTML(row)}</td>
      <td class="copy-td">${utm ? `<button class="copy-btn" onclick="copyUTM(this,'${escAttr(utm)}')">복사</button>` : ''}</td>
      <td class="del-td"><button class="delete-row-btn" onclick="deleteRow(${row.id})">삭제</button></td>
    </tr>`;
  }).join('');

  updateStats(filteredRows);
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

  const prevUtm = buildUTM(row);
  const prevShortUrl = row.shortUrl;
  row[field] = value;
  const newUtm = buildUTM(row);
  const clearShortUrl = prevUtm !== newUtm && !!prevShortUrl;
  if (clearShortUrl) {
    _archiveBitlyLink(prevShortUrl);
    row.shortUrl = null;
    row.shortUrlFor = null;
  }

  const wasComplete = !!row.createdAt;
  maybeStampDate(row);

  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    const utm = buildUTM(row);
    const ok = isComplete(row);
    const dotClass = ok ? 'dot-ok' : (row.url || row.source || row.medium || row.campaign ? 'dot-partial' : 'dot-empty');
    const resultCell = tr.querySelector('.utm-result');
    if (resultCell) {
      resultCell.innerHTML = utmResultCellHTML(row);
    }
    const shortTd = tr.querySelector('.short-td');
    if (shortTd) {
      shortTd.innerHTML = shortUrlCellHTML(row);
    }
    const copyTd = tr.querySelector('.copy-td');
    if (copyTd) {
      const utm2 = buildUTM(row);
      copyTd.innerHTML = utm2 ? `<button class="copy-btn" onclick="copyUTM(this,'${escAttr(utm2)}')">복사</button>` : '';
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
      if (clearShortUrl) {
        update.shortUrl = firebase.firestore.FieldValue.delete();
        update.shortUrlFor = firebase.firestore.FieldValue.delete();
      }
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
  if (!confirm('이 행을 삭제할까요?\n삭제된 항목은 휴지통에서 30일간 보관됩니다.')) return;
  const row = rows.find(r => r.id === id);
  if (!row || !row.firebaseId) return;
  if (row.shortUrl) _archiveBitlyLink(row.shortUrl);
  _moveToTrash(row).then(() => {
    db.collection('utm_rows').doc(row.firebaseId).delete().catch(console.error);
  });
}

function _moveToTrash(row) {
  return db.collection('utm_trash').add({
    url: row.url, source: row.source, medium: row.medium,
    campaign: row.campaign, term: row.term, content: row.content,
    dept: row.dept, createdAt: row.createdAt,
    deletedAt: Date.now(), _order: row._order || 0
  });
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
  if (!confirm(`선택한 ${selected.length}개 행을 삭제할까요?\n삭제된 항목은 휴지통에서 30일간 보관됩니다.`)) return;
  selected.forEach(row => { if (row.shortUrl) _archiveBitlyLink(row.shortUrl); });
  Promise.all(selected.map(row => _moveToTrash(row))).then(() => {
    const batch = db.batch();
    selected.forEach(row => {
      if (row.firebaseId) batch.delete(db.collection('utm_rows').doc(row.firebaseId));
    });
    batch.commit().catch(console.error);
  });
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

function updateStats(displayRows) {
  const target = displayRows || rows;
  const total = target.length;
  const complete = target.filter(r => isComplete(r)).length;
  const incomplete = total - complete;
  document.getElementById('row-count').textContent = total;
  document.getElementById('complete-count').textContent = complete;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-complete').textContent = complete;
  document.getElementById('stat-incomplete').textContent = incomplete;
}

function updateFilterOptions() {
  const urls = [...new Set(rows.map(r => r.url).filter(Boolean))].sort();
  const sources = [...new Set(rows.map(r => r.source).filter(Boolean))].sort();
  const mediums = [...new Set(rows.map(r => r.medium).filter(Boolean))].sort();

  _setFilterOpts('filter-url', urls, filters.url, 'Base URL 전체');
  _setFilterOpts('filter-source', sources, filters.source, 'Source 전체');
  _setFilterOpts('filter-medium', mediums, filters.medium, 'Medium 전체');

  const hasFilter = filters.url || filters.source || filters.medium;
  const resetBtn = document.getElementById('filter-reset');
  if (resetBtn) resetBtn.style.display = hasFilter ? 'block' : 'none';
}

function _setFilterOpts(id, values, current, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  if (current && !values.includes(current)) {
    filters[id.replace('filter-', '')] = '';
    current = '';
  }
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escHtml(v)}" ${current === v ? 'selected' : ''}>${escHtml(v)}</option>`).join('');
  sel.classList.toggle('active', !!current);
}

function applyFilter(field, value) {
  filters[field] = value;
  const sel = document.getElementById(`filter-${field}`);
  if (sel) sel.classList.toggle('active', !!value);
  const hasFilter = filters.url || filters.source || filters.medium;
  const resetBtn = document.getElementById('filter-reset');
  if (resetBtn) resetBtn.style.display = hasFilter ? 'block' : 'none';
  renderTable();
}

function resetFilters() {
  filters = { url: '', source: '', medium: '' };
  ['filter-url', 'filter-source', 'filter-medium'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { sel.value = ''; sel.classList.remove('active'); }
  });
  const resetBtn = document.getElementById('filter-reset');
  if (resetBtn) resetBtn.style.display = 'none';
  renderTable();
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
      shortUrl: data.shortUrl || null,
      shortUrlFor: data.shortUrlFor || null,
      _order: data._order || 0
    };
  }).sort((a, b) => a._order - b._order);

  updateFilterOptions();
  if (!isEditing) renderTable();
}, error => {
  console.error('Firestore 오류:', error);
});

// ── 휴지통 ──────────────────────────────────────────────────
const TRASH_TTL = 30 * 24 * 60 * 60 * 1000;

db.collection('utm_trash').onSnapshot(snapshot => {
  const now = Date.now();
  let activeCount = 0;
  snapshot.docs.forEach(d => {
    const deletedAt = d.data().deletedAt || 0;
    if (now - deletedAt > TRASH_TTL) {
      d.ref.delete().catch(console.error);
    } else {
      activeCount++;
    }
  });
  const badge = document.getElementById('trash-count');
  if (badge) {
    badge.textContent = activeCount;
    badge.style.display = activeCount > 0 ? 'inline' : 'none';
  }
}, error => { console.error('Trash 오류:', error); });

function openTrash() {
  document.getElementById('trash-overlay').style.display = 'block';
  document.getElementById('trash-modal').classList.add('open');
  loadTrash();
}

function closeTrash() {
  document.getElementById('trash-overlay').style.display = 'none';
  document.getElementById('trash-modal').classList.remove('open');
}

function loadTrash() {
  const now = Date.now();
  const listEl = document.getElementById('trash-list');

  db.collection('utm_trash').get().then(snapshot => {
    const valid = snapshot.docs
      .filter(d => now - (d.data().deletedAt || 0) <= TRASH_TTL)
      .sort((a, b) => (b.data().deletedAt || 0) - (a.data().deletedAt || 0));

    if (valid.length === 0) {
      listEl.innerHTML = '<div class="trash-empty">휴지통이 비어 있습니다.</div>';
      return;
    }

    listEl.innerHTML = valid.map(d => {
      const data = d.data();
      const daysLeft = Math.ceil((TRASH_TTL - (now - data.deletedAt)) / (24 * 60 * 60 * 1000));
      const utm = buildUTM(data);
      const deletedDate = new Date(data.deletedAt).toLocaleDateString('ko-KR');
      return `<div class="trash-item">
        <div class="trash-item-info">
          <div class="trash-item-url ${utm ? '' : 'no-url'}">${utm ? escHtml(utm) : '— 미완성 URL'}</div>
          <div class="trash-item-meta">
            <span>${deletedDate} 삭제</span>
            ${data.dept ? `<span>${escHtml(data.dept)}</span>` : ''}
            ${data.source ? `<span>${escHtml(data.source)}</span>` : ''}
            ${data.campaign ? `<span>${escHtml(data.campaign)}</span>` : ''}
          </div>
        </div>
        <span class="trash-days ${daysLeft <= 3 ? 'urgent' : ''}">${daysLeft}일 후 삭제</span>
        <button class="trash-restore-btn" onclick="restoreTrashItem('${d.id}')">복원</button>
        <button class="trash-permdel-btn" onclick="permanentDeleteTrashItem('${d.id}')">영구삭제</button>
      </div>`;
    }).join('');
  }).catch(console.error);
}

function restoreTrashItem(trashId) {
  db.collection('utm_trash').doc(trashId).get().then(d => {
    if (!d.exists) return;
    const { deletedAt, ...rowData } = d.data();
    rowData._order = Date.now();
    db.collection('utm_rows').add(rowData).then(() => {
      d.ref.delete();
      loadTrash();
      showToast('복원되었습니다');
    });
  }).catch(console.error);
}

function permanentDeleteTrashItem(trashId) {
  if (!confirm('영구 삭제하면 복원할 수 없습니다. 계속할까요?')) return;
  db.collection('utm_trash').doc(trashId).delete().then(() => {
    loadTrash();
    showToast('영구 삭제되었습니다');
  }).catch(console.error);
}

// ── Bitly ────────────────────────────────────────────────────
async function generateShortUrl(id) {
  const row = rows.find(r => r.id === id);
  if (!row || !row.firebaseId) return;
  if (!BITLY_TOKEN) { showToast('Bitly 토큰이 설정되지 않았습니다'); return; }
  const utm = buildUTM(row);
  if (!utm) return;
  if (_shorteningQueue.has(row.firebaseId)) return;

  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const shortTd = tr && tr.querySelector('.short-td');
  if (shortTd) shortTd.innerHTML = '<div class="utm-short-pending">생성 중…</div>';

  _shorteningQueue.add(row.firebaseId);
  try {
    const res = await fetch('https://api-ssl.bitly.com/v4/shorten', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BITLY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ long_url: utm })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.message || errData.description || '';
      if (res.status === 401) showToast('Bitly 토큰이 유효하지 않습니다');
      else if (res.status === 403) showToast(`Bitly 권한 오류 — 토큰을 재발급해 주세요 (${errMsg})`);
      else showToast(`Bitly 오류: ${res.status} ${errMsg}`);
      const tr2 = document.querySelector(`tr[data-id="${id}"]`);
      const std2 = tr2 && tr2.querySelector('.short-td');
      if (std2) std2.innerHTML = shortUrlCellHTML(row);
      return;
    }
    const data = await res.json();
    if (data.link) {
      row.shortUrl = data.link;
      row.shortUrlFor = utm;
      await db.collection('utm_rows').doc(row.firebaseId).update({
        shortUrl: data.link,
        shortUrlFor: utm
      });
      const tr2 = document.querySelector(`tr[data-id="${id}"]`);
      const std2 = tr2 && tr2.querySelector('.short-td');
      if (std2) std2.innerHTML = shortUrlCellHTML(row);
    }
  } catch (e) {
    console.error('Bitly 오류:', e);
    showToast('단축 URL 생성에 실패했습니다');
    const tr2 = document.querySelector(`tr[data-id="${id}"]`);
    const std2 = tr2 && tr2.querySelector('.short-td');
    if (std2) std2.innerHTML = shortUrlCellHTML(row);
  } finally {
    _shorteningQueue.delete(row.firebaseId);
  }
}

async function _archiveBitlyLink(shortUrl) {
  if (!shortUrl || !BITLY_TOKEN) return;
  const bitlinkId = shortUrl.replace(/^https?:\/\//, '');
  try {
    await fetch(`https://api-ssl.bitly.com/v4/bitlinks/${bitlinkId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${BITLY_TOKEN}` }
    });
  } catch (e) {
    console.error('Bitly 삭제 오류:', e);
  }
}
