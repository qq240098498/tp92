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
  editingRuleId: '',
  editingFileId: '',
  lastScan: null,
  scanReady: false,
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

// 扫描区的规则清单不走上面的筛选，始终拿全量，免得勾选项被规则区的筛选条件藏掉
async function loadAllRules() {
  const payload = await request('/api/rules');
  state.allRules = payload.rules || [];
  renderScanRulePicker();
  updateScanPreview();
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

// 扫描区算覆盖文件数时也要用全量文件，不受文件区筛选影响
async function loadAllFiles() {
  const payload = await request('/api/files');
  state.allFiles = payload.files || [];
  renderScanTypeOptions();
  state.scanReady = true;
  updateScanPreview();
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

  renderScanLevelChecks();
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

// 级别复选框：重绘时保住已经勾上的级别
function renderScanLevelChecks() {
  const box = el('scan-levels');
  const checked = new Set(Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map((node) => node.value));
  box.innerHTML = state.levels.map((item) => `
    <label class="check-item"><input type="checkbox" value="${escapeHtml(item)}" ${checked.has(item) ? 'checked' : ''}>${escapeHtml(item)}</label>
  `).join('');
}

function renderScanTypeOptions() {
  const select = el('scan-type');
  const current = select.value;
  select.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) select.value = current;
}

// 规则勾选清单：停用的规则也列出来但标灰，勾了会明确提示它不参与
function renderScanRulePicker() {
  const box = el('scan-rule-list');
  const checked = new Set(Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map((node) => node.value));
  const sorted = state.allRules.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  box.innerHTML = sorted.map((item) => {
    const disabled = item.status !== '启用';
    return `<label class="rule-pick ${disabled ? 'is-off' : ''}" title="${disabled ? '停用规则不参与比对' : ''}">
      <input type="checkbox" value="${escapeHtml(item.id)}" ${checked.has(item.id) ? 'checked' : ''}>
      <span class="mono">${escapeHtml(item.code)}</span>
      <span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span>
      <span>${escapeHtml(item.name)}</span>
      <span class="pick-status">${disabled ? '停用' : escapeHtml(item.fileType)}</span>
    </label>`;
  }).join('');
}

// 目录前缀的口径跟服务端一致：等于这个目录或落在它下面才算覆盖到
function normalizePrefixInput() {
  return el('scan-prefix').value.trim().replace(/\/+$/, '');
}

function pathMatchesPrefixLocally(filePath, prefix) {
  if (!prefix) return true;
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function checkedValues(containerId) {
  return Array.from(el(containerId).querySelectorAll('input[type="checkbox"]:checked')).map((node) => node.value);
}

// 扫之前就算清楚：这一轮用几条启用规则、覆盖几个文件、有没有被条件挑空
function evaluateScope() {
  const prefix = normalizePrefixInput();
  const fileType = el('scan-type').value;
  const levelPicks = checkedValues('scan-levels');
  const rulePicks = checkedValues('scan-rule-list');

  const files = state.allFiles
    .filter((item) => pathMatchesPrefixLocally(item.path, prefix))
    .filter((item) => !fileType || item.type === fileType);

  const enabled = state.allRules.filter((item) => item.status === '启用');
  const selected = enabled.filter((item) => rulePicks.length === 0 || rulePicks.includes(item.id));
  const used = levelPicks.length === 0
    ? selected
    : selected.filter((item) => levelPicks.includes(item.level));

  const inactivePicked = state.allRules.filter((item) => rulePicks.includes(item.id) && item.status !== '启用');

  return { prefix, fileType, levelPicks, rulePicks, files, enabled, used, inactivePicked };
}

function updateScanPreview() {
  const box = el('scan-preview');
  if (!box) return;
  if (!state.scanReady) return;
  const scope = evaluateScope();
  const limitText = readLimitText();
  const parts = [];

  if (scope.files.length === 0) {
    const conds = [];
    if (scope.prefix) conds.push(`目录前缀「${scope.prefix}」`);
    if (scope.fileType) conds.push(`文件类型「${scope.fileType}」`);
    parts.push(conds.length
      ? `按${conds.join('加上')}挑下来覆盖 0 个文件（共 ${state.allFiles.length} 个），扫之前先换个范围`
      : `文件清单里一个文件都没有（当前 0 个），先去文件区收录文件`);
  }
  if (scope.used.length === 0) {
    if (scope.rulePicks.length > 0 && scope.inactivePicked.length > 0) {
      parts.push(`勾选的规则全是停用状态，这一轮没有规则参与比对`);
    } else if (scope.enabled.length === 0) {
      parts.push(`当前没有启用的规则，先去规则区启用至少一条`);
    } else if (scope.levelPicks.length > 0) {
      parts.push(`启用规则里没有级别为 ${scope.levelPicks.join('、')} 的，这一轮用 0 条规则`);
    } else {
      parts.push(`这一轮没有可参与的启用规则`);
    }
  }
  if (parts.length === 0) {
    parts.push(`这一轮将使用 ${scope.used.length} 条规则，覆盖 ${scope.files.length} 个文件`);
  }
  if (scope.inactivePicked.length > 0 && scope.used.length > 0) {
    parts.push(`另有 ${scope.inactivePicked.length} 条勾选的停用规则不参与`);
  }
  if (!limitText.ok) {
    parts.push(limitText.message);
  } else if (limitText.value !== null) {
    parts.push(`命中清单最多保留前 ${limitText.value} 条`);
  }

  box.textContent = parts.join('；');
  box.classList.toggle('preview-warn', scope.files.length === 0 || scope.used.length === 0 || !limitText.ok);
}

// 上限只在发请求时严格拦：0、负数、小数、非整数文本一律不让扫
function readLimitText() {
  const raw = el('scan-limit').value.trim();
  if (!raw) return { ok: true, value: null };
  if (!/^\d+$/.test(raw)) return { ok: false, message: '命中条数上限只能填正整数；不需要限制就留空' };
  const num = Number(raw);
  if (num < 1) return { ok: false, message: '命中条数上限必须大于 0，填 0 或负数等于一条都不留；不需要限制就留空' };
  return { ok: true, value: num };
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
    await loadAllRules();
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
    await loadAllFiles();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍：范围为空、上限不合法当场拦住；扫完把概要、截断说明与命中清单都画出来
async function runScan() {
  clearNotice();
  clearFieldMarks();

  const limit = readLimitText();
  if (!limit.ok) {
    notify(limit.message, 'error');
    markField('limit');
    return;
  }

  const scope = evaluateScope();
  if (scope.files.length === 0 || scope.used.length === 0) {
    notify(scope.files.length === 0
      ? '当前范围一个文件都覆盖不到，先把目录前缀或文件类型放宽再扫'
      : '当前范围一条参与比对的规则都没有，勾至少一条规则或放宽级别', 'error');
    return;
  }

  const body = {
    dirPrefix: scope.prefix,
    fileType: scope.fileType,
    levels: scope.levelPicks,
    ruleIds: scope.rulePicks,
  };
  if (limit.value !== null) body.limit = limit.value;

  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

function renderScan(result) {
  const scopeParts = [];
  if (result.scope.dirPrefix) scopeParts.push(`目录前缀「${result.scope.dirPrefix}」`);
  if (result.scope.fileType) scopeParts.push(`文件类型「${result.scope.fileType}」`);
  if (result.scope.levels.length) scopeParts.push(`级别「${result.scope.levels.join('、')}」`);
  if (result.scope.ruleIds.length) scopeParts.push(`指定规则 ${result.scope.ruleIds.length} 条`);
  const scopeText = scopeParts.length ? `范围：${scopeParts.join('，')}` : '范围：全部规则、全部文件';
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　${scopeText}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　覆盖文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.inactiveNote) {
    warningBox.textContent = result.inactiveNote;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  // 范围一个文件都覆盖不到、或一条规则都没选出来时：只给说明，不摆一份空清单
  if (result.notice) {
    el('scan-summary').classList.add('hidden');
    el('scan-summary').innerHTML = '';
    el('hit-table-wrap').classList.add('hidden');
    el('hit-empty').classList.add('hidden');
    const extra = result.rulesUsed > 0 && result.inactiveNote ? `（${result.inactiveNote}）` : '';
    warningBox.textContent = `${result.notice}${extra}`;
    warningBox.classList.remove('hidden');
    return;
  }

  el('hit-table-wrap').classList.remove('hidden');

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

  // 超上限时把总数、清单里的条数、截掉多少都摆明，不能让人误以为只有清单里这些
  const truncLine = result.summary.truncated
    ? `<div class="summary-line trunc-line">命中超过上限：一共命中 <strong>${result.summary.total}</strong> 条，清单只保留按规则编码、路径、行号排序后的前 <strong>${result.summary.returned}</strong> 条，截掉 ${result.summary.omitted} 条；放宽上限或缩小范围可以看全</div>`
    : '';

  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>　${escapeHtml(levelText)}</div>
    ${truncLine}
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => `<tr>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
    </tr>`).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
}

// 清空扫描范围：条件与上一轮结果都回到初始样子
function resetScanScope() {
  el('scan-prefix').value = '';
  el('scan-type').value = '';
  el('scan-limit').value = '';
  el('scan-rule-list').querySelectorAll('input[type="checkbox"]').forEach((node) => { node.checked = false; });
  el('scan-levels').querySelectorAll('input[type="checkbox"]').forEach((node) => { node.checked = false; });
  clearNotice();
  clearFieldMarks();
  updateScanPreview();
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
      await loadAllRules();
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
      await loadAllFiles();
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
    .then(loadAllRules)
    .then(loadFiles)
    .then(loadAllFiles)
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
el('scan-reset').addEventListener('click', resetScanScope);
el('scan-prefix').addEventListener('input', updateScanPreview);
el('scan-type').addEventListener('change', updateScanPreview);
el('scan-limit').addEventListener('input', updateScanPreview);
el('scan-levels').addEventListener('change', updateScanPreview);
el('scan-rule-list').addEventListener('change', updateScanPreview);
el('scan-rules-enabled').addEventListener('click', () => {
  el('scan-rule-list').querySelectorAll('input[type="checkbox"]').forEach((node) => {
    const rule = state.allRules.find((item) => item.id === node.value);
    node.checked = Boolean(rule && rule.status === '启用');
  });
  updateScanPreview();
});
el('scan-rules-none').addEventListener('click', () => {
  el('scan-rule-list').querySelectorAll('input[type="checkbox"]').forEach((node) => { node.checked = false; });
  updateScanPreview();
});
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则与文件都拉一遍（筛选清单与全量清单各一份），扫描范围依赖全量那两份
restoreOperator();
loadHealth();
loadRules()
  .then(loadAllRules)
  .then(loadFiles)
  .then(loadAllFiles)
  .catch((err) => notify(err.message, 'error'));
