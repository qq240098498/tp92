// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  allRules: [],
  allFiles: [],
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  scanFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  lastScan: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  renderRuleFilters();
  renderRules();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
}

// 扫描区要看到全部规则与全部文件，不受规则区、文件区当前筛选条件影响
async function loadScanOptions() {
  const [rulesPayload, filesPayload] = await Promise.all([
    request('/api/rules'),
    request('/api/files'),
  ]);
  state.allRules = rulesPayload.rules || [];
  state.allFiles = filesPayload.files || [];
  state.scanFileTypes = filesPayload.fileTypes || [];
  renderScanScope();
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

// 扫描范围区：级别勾选、规则勾选、文件类型下拉与目录前缀候选。重新渲染时保留之前的勾选
function renderScanScope() {
  const prevLevels = new Set(readCheckedValues('scan-level-picks'));
  const prevRules = new Set(readCheckedValues('scan-rule-picks'));

  const levels = state.levels.length ? state.levels : ['提示', '警告', '错误'];
  el('scan-level-picks').innerHTML = levels.map((item) => {
    const checked = prevLevels.has(item);
    return `<label class="scan-chip${checked ? ' checked' : ''}"><input type="checkbox" value="${escapeHtml(item)}"${checked ? ' checked' : ''}>${escapeHtml(item)}</label>`;
  }).join('');

  const typeSelect = el('scan-file-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.scanFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.scanFileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const sortedRules = state.allRules.slice().sort((a, b) => (a.code < b.code ? -1 : 1));
  el('scan-rule-picks').innerHTML = sortedRules.map((rule) => {
    const checked = prevRules.has(rule.id);
    const off = rule.status !== '启用';
    return `<label class="rule-pick${off ? ' off' : ''}" title="${off ? '停用规则：勾选后这一轮也不参与，会在结果里说明' : ''}">
      <input type="checkbox" value="${escapeHtml(rule.id)}"${checked ? ' checked' : ''}>
      <span><span class="mono">${escapeHtml(rule.code)}</span> ${escapeHtml(rule.name)}
        <span class="pick-meta">${escapeHtml(rule.level)} · ${escapeHtml(rule.status)} · 适用 ${escapeHtml(rule.fileType)}</span>
      </span>
    </label>`;
  }).join('');

  const dirs = new Set();
  state.allFiles.forEach((file) => {
    const parts = file.path.split('/');
    parts.slice(0, -1).forEach((_part, index) => dirs.add(parts.slice(0, index + 1).join('/')));
  });
  el('scan-dir-list').innerHTML = Array.from(dirs).sort()
    .map((dir) => `<option value="${escapeHtml(dir)}"></option>`).join('');

  evaluateScanScope();
}

function readCheckedValues(containerId) {
  return Array.from(el(containerId).querySelectorAll('input:checked')).map((input) => input.value);
}

function readScanLimit() {
  const text = el('scan-limit').value.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) <= 0) return { ok: false, value: null };
  return { ok: true, value: Number(text) };
}

function pathUnderPrefix(filePath, prefix) {
  return !prefix || filePath === prefix || filePath.startsWith(`${prefix}/`);
}

// 扫描前先在本地把这一轮的账算清楚：用到几条规则、覆盖几个文件，范围为空或上限不合法当场说明。
// 返回 { ok, params }：ok 为 false 时不允许发请求
function evaluateScanScope() {
  const box = el('scan-preview');
  el('scan-level-picks').querySelectorAll('.scan-chip').forEach((label) => {
    label.classList.toggle('checked', label.querySelector('input').checked);
  });

  const show = (kind, message) => {
    box.textContent = message;
    box.className = `scan-preview ${kind}`;
  };
  const fail = (message, field) => {
    show('bad', message);
    return { ok: false, message, field };
  };

  const prefixRaw = el('scan-dir-prefix').value.trim();
  const prefix = prefixRaw.replace(/\/+$/, '');
  if (prefixRaw && (prefixRaw.startsWith('/') || prefixRaw.split('/').includes('..'))) {
    return fail('目录前缀要写成相对路径，例如 src/server，不能用 / 开头或用 .. 跳到上级', 'scanDirPrefix');
  }

  const limitRead = readScanLimit();
  if (!limitRead.ok) {
    return fail('命中条数上限要填正整数（至少 1）；填 0、负数、小数或文字都不会出结果，留空表示不限', 'scanLimit');
  }

  const fileType = el('scan-file-type').value;
  const levels = readCheckedValues('scan-level-picks');
  const ruleIds = readCheckedValues('scan-rule-picks');

  const files = state.allFiles
    .filter((file) => pathUnderPrefix(file.path, prefix))
    .filter((file) => !fileType || file.type === fileType);
  const enabledRules = state.allRules.filter((rule) => rule.status === '启用');
  const selectedRules = ruleIds
    .map((id) => state.allRules.find((rule) => rule.id === id))
    .filter(Boolean);
  const usedRules = enabledRules
    .filter((rule) => !ruleIds.length || selectedRules.some((item) => item.id === rule.id))
    .filter((rule) => !levels.length || levels.includes(rule.level));
  const excludedRules = selectedRules.filter((rule) => rule.status !== '启用'
    || (levels.length && !levels.includes(rule.level)));

  const scopeParts = [];
  if (prefix) scopeParts.push(`前缀 ${prefix}/`);
  if (fileType) scopeParts.push(`类型 ${fileType}`);
  const scopeText = scopeParts.length ? `，范围限定为 ${scopeParts.join(' 且 ')}` : '';

  if (!state.allFiles.length) {
    show('bad', '文件清单是空的，先到文件区收录文件再扫');
    return { ok: false, previewed: true };
  }
  if (!files.length) {
    show('bad', `这个范围一个文件都不覆盖${scopeText || ''}：${scopeParts.join(' 且 ') || '文件清单'}下没有收录的文件，请放宽范围`);
    return { ok: false, previewed: true };
  }
  if (!usedRules.length) {
    let reason = '现在没有启用的规则，先到规则区启用至少一条';
    if (ruleIds.length) reason = '勾选的规则这一轮都不参与比对（已停用或被级别筛选挡掉），结果上方会逐条说明；换几条规则或放开级别';
    else if (levels.length) reason = `级别只勾选了 ${levels.join('、')}，启用规则里没有这个级别的规则，换个级别或放开级别`;
    show('bad', reason);
    return { ok: false, previewed: true };
  }

  let message = `这一轮会用 ${usedRules.length} 条规则（启用共 ${enabledRules.length} 条），覆盖 ${files.length} 个文件（清单共 ${state.allFiles.length} 个）${scopeText}`;
  if (ruleIds.length) message += `；共勾选 ${ruleIds.length} 条规则，其中 ${excludedRules.length} 条不参与`;
  if (levels.length) message += `；只看级别：${levels.join('、')}`;
  if (limitRead.value !== null) {
    message += `；命中清单最多保留前 ${limitRead.value} 条，超过会标明一共命中多少条、截掉多少条`;
  }
  show('ok', message);
  return {
    ok: true,
    params: {
      dirPrefix: prefix,
      fileType,
      levels,
      ruleIds,
      limit: limitRead.value,
    },
  };
}

function setRuleChecks(predicate) {
  el('scan-rule-picks').querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const rule = state.allRules.find((item) => item.id === input.value);
    input.checked = Boolean(rule && predicate(rule));
  });
  evaluateScanScope();
}

function renderRules() {
  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
    await loadScanOptions();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
    await loadScanOptions();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍：先在本地把范围账算清楚（规则数、文件数、上限合法性），再发请求
async function runScan() {
  clearNotice();
  clearFieldMarks();
  const evaluation = evaluateScanScope();
  if (!evaluation.ok) {
    if (evaluation.field) {
      markField(evaluation.field);
      notify(evaluation.message, 'error');
    }
    return;
  }
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(evaluation.params) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

function renderScan(result) {
  const scopeText = [
    result.scope.dirPrefix ? `前缀 ${result.scope.dirPrefix}/` : '',
    result.scope.fileType ? `类型 ${result.scope.fileType}` : '',
    result.scope.levels.length ? `级别 ${result.scope.levels.join('、')}` : '',
    result.scope.ruleIds.length ? `指定规则 ${result.scope.ruleIds.length} 条` : '',
  ].filter(Boolean).join('　');
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）${scopeText ? `　${scopeText}` : ''}`;

  const notesBox = el('scan-notes');
  if (result.notes && result.notes.length) {
    notesBox.innerHTML = `这一轮有 ${result.notes.length} 条勾选的规则没有参与比对：<ul>${result.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    notesBox.classList.remove('hidden');
  } else {
    notesBox.classList.add('hidden');
    notesBox.innerHTML = '';
  }

  // 范围为空（一个文件都没有 / 一条规则都没选中）：给明确说明，不装作“扫完没有命中”
  const emptyBox = el('scan-empty');
  if (result.emptyReason) {
    emptyBox.textContent = result.emptyReason;
    emptyBox.classList.remove('hidden');
  } else {
    emptyBox.classList.add('hidden');
    emptyBox.textContent = '';
  }

  // 超过上限：清单里只留前若干条，必须写明被截断、一共多少条、截掉多少条
  const truncBox = el('scan-truncated');
  if (result.truncated) {
    truncBox.textContent = `命中清单已按上限截断：一共命中 ${result.totalHits} 条，清单里只保留排序后的前 ${result.hits.length} 条，截掉了后面的 ${result.truncatedCount} 条。把上限调大或缩小范围可以看到其余命中。`;
    truncBox.classList.remove('hidden');
  } else {
    truncBox.classList.add('hidden');
    truncBox.textContent = '';
  }

  const summaryBox = el('scan-summary');
  const levelText = Object.keys(result.summary.byLevel)
    .map((key) => `${key} ${result.summary.byLevel[key]} 条`)
    .join('　');
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  const totalText = result.truncated
    ? `一共命中 <strong>${result.totalHits}</strong> 条（清单只显示前 ${result.hits.length} 条，截掉 ${result.truncatedCount} 条）`
    : `一共命中 <strong>${result.summary.total}</strong> 条`;
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>${totalText}</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.toggle('hidden', Boolean(result.emptyReason));

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => `<tr>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
    </tr>`).join('');
  // 空范围显示的是“没扫成”的说明；真正扫完但没命中才显示“这一轮没有命中”
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0 || Boolean(result.emptyReason));
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
      await loadScanOptions();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
      await loadScanOptions();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .then(loadScanOptions)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('scan-rules-enabled').addEventListener('click', () => setRuleChecks((rule) => rule.status === '启用'));
el('scan-rules-all').addEventListener('click', () => setRuleChecks(() => true));
el('scan-rules-none').addEventListener('click', () => setRuleChecks(() => false));
el('scan-rule-picks').addEventListener('change', evaluateScanScope);
el('scan-level-picks').addEventListener('change', evaluateScanScope);
el('scan-file-type').addEventListener('change', evaluateScanScope);
el('scan-dir-prefix').addEventListener('input', evaluateScanScope);
el('scan-limit').addEventListener('input', evaluateScanScope);
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时把规则与文件都拉一遍；扫描范围区单独再拉全量清单，不受上面两个筛选影响
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadScanOptions)
  .catch((err) => notify(err.message, 'error'));
