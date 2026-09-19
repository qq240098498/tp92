const { load, LEVELS, STATUSES, FILE_TYPES, MAX_PATH_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

// 目录前缀只放行文件路径允许的那批字符，不能用相对上级或绝对路径的写法
const PREFIX_PATTERN = /^[A-Za-z0-9._/-]+$/;

function normalizePrefix(value) {
  return pickText(value).replace(/\/+$/, '');
}

function validateDirPrefix(value) {
  const prefix = normalizePrefix(value);
  if (!prefix) return '';
  if (prefix.length > MAX_PATH_LENGTH) {
    throw new ApiError(400, 'DIR_PREFIX_TOO_LONG', `目录前缀不能超过 ${MAX_PATH_LENGTH} 个字符`, 'dirPrefix');
  }
  if (!PREFIX_PATTERN.test(prefix) || prefix.startsWith('/') || prefix.includes('..')) {
    throw new ApiError(400, 'DIR_PREFIX_INVALID', '目录前缀只能用字母数字、点、下划线、短横线与斜线，且不能用相对上级的写法', 'dirPrefix');
  }
  return prefix;
}

function validateFileType(value) {
  const fileType = pickText(value);
  if (!fileType) return '';
  if (fileType === '全部' || !FILE_TYPES.includes(fileType)) {
    throw new ApiError(400, 'FILE_TYPE_INVALID', `文件类型只能是 ${FILE_TYPES.filter((item) => item !== '全部').join('、')} 其中之一，留空表示不按类型挑`, 'fileType');
  }
  return fileType;
}

// 复选框过来的是数组，逐个认；空数组等于这一项不挑
function readStringList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.map((item) => pickText(item)).filter(Boolean);
}

function validateLevels(values) {
  const levels = Array.from(new Set(readStringList(values)));
  levels.forEach((level) => {
    if (!LEVELS.includes(level)) {
      throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'levels');
    }
  });
  return levels;
}

// 上限只能留空（不限制）或者写大于 0 的整数；0、负数、小数、乱七八糟的文本一律拒绝
function parseLimit(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限只能是大于 0 的整数；不需要限制就留空', 'limit');
    }
    return value;
  }
  const text = pickText(value);
  if (!text) return null;
  if (!/^\d+$/.test(text)) {
    throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限只能填整数；不需要限制就留空', 'limit');
  }
  const num = Number(text);
  if (!Number.isSafeInteger(num) || num < 1) {
    throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限必须大于 0，填 0 或负数等于一条都不留；不需要限制就留空', 'limit');
  }
  return num;
}

function pathMatchesPrefix(filePath, prefix) {
  if (!prefix) return true;
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

// 范围一个文件都覆盖不到时，把是哪道条件挑空的写清楚
function explainEmptyFiles(prefix, fileType, total) {
  const parts = [];
  if (prefix) parts.push(`目录前缀「${prefix}」`);
  if (fileType) parts.push(`文件类型「${fileType}」`);
  if (parts.length === 0) return `清单里一个文件都没有，先去文件区收录文件（当前共 ${total} 个）`;
  return `按${parts.join('加上')}挑下来，一个文件都没有覆盖到（文件清单共 ${total} 个），换个范围再扫`;
}

// 一条规则都没选出来时，分清是停用、级别卡掉还是压根没有启用规则
function explainNoRules({ enabled, selectedIds, levels, inactiveSelected }) {
  if (selectedIds.length > 0) {
    if (enabled.length === 0) {
      return `选中的 ${selectedIds.length} 条规则全是停用状态，停用规则不参与比对，先去规则区把它们启用`;
    }
    if (levels.length > 0) {
      return `选中的启用规则里没有级别为 ${levels.join('、')} 的，这一轮一条规则都没剩下`;
    }
  }
  if (levels.length > 0 && enabled.length > 0) {
    return `启用规则里没有级别为 ${levels.join('、')} 的，这一轮一条规则都没剩下`;
  }
  if (inactiveSelected.length > 0) {
    return `选中的 ${inactiveSelected.length} 条规则全是停用状态，停用规则不参与比对`;
  }
  return '当前没有启用的规则，先去规则区启用至少一条';
}

// 扫一遍：先按目录前缀、文件类型、具体规则与级别把这一轮的范围圈出来，再逐条比对
function scan(options) {
  const input = options && typeof options === 'object' ? options : {};
  const prefix = validateDirPrefix(input.dirPrefix);
  const fileType = validateFileType(input.fileType);
  const levels = validateLevels(input.levels);
  const selectedIds = Array.from(new Set(readStringList(input.ruleIds)));
  const limit = parseLimit(input.limit);

  const data = load();

  selectedIds.forEach((id) => {
    if (!data.rules.some((item) => item.id === id)) {
      throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里，可能已被删除', 'ruleIds');
    }
  });

  const enabled = data.rules.filter((item) => item.status === STATUSES[0]);
  const inactiveSelected = selectedIds
    .map((id) => data.rules.find((item) => item.id === id))
    .filter((rule) => rule && rule.status !== STATUSES[0]);

  const rulesSelected = enabled.filter((item) => selectedIds.length === 0 || selectedIds.includes(item.id));
  const rulesUsed = levels.length === 0
    ? rulesSelected
    : rulesSelected.filter((item) => levels.includes(item.level));

  const filesInScope = data.files
    .filter((file) => pathMatchesPrefix(file.path, prefix))
    .filter((file) => !fileType || file.type === fileType);

  const inactiveRules = inactiveSelected.map((rule) => ({ id: rule.id, code: rule.code, name: rule.name }));
  const inactiveNote = inactiveRules.length > 0
    ? `选中的规则里有 ${inactiveRules.length} 条是停用状态（${inactiveRules.map((item) => item.code).join('、')}），停用规则不参与比对，这一轮按其余规则扫`
    : '';

  const notices = [];
  if (filesInScope.length === 0) notices.push(explainEmptyFiles(prefix, fileType, data.files.length));
  if (rulesUsed.length === 0) {
    notices.push(explainNoRules({
      enabled: rulesSelected,
      selectedIds,
      levels,
      inactiveSelected,
    }));
  }
  const notice = notices.join('；');

  const hits = [];
  if (!notice) {
    rulesUsed.forEach((rule) => {
      filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
        file.content.split('\n').forEach((text, index) => {
          if (text.includes(rule.pattern)) {
            hits.push({
              ruleId: rule.id,
              code: rule.code,
              ruleName: rule.name,
              level: rule.level,
              pattern: rule.pattern,
              fileId: file.id,
              path: file.path,
              fileType: file.type,
              lineNo: index + 1,
              lineText: text.trim(),
            });
          }
        });
      });
    });
  }

  hits.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  });

  const total = hits.length;
  const truncated = limit !== null && total > limit;
  const shownHits = truncated ? hits.slice(0, limit) : hits;

  // 汇总按全部命中算，不能因为清单截断就把总数也算少了
  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  hits.forEach((hit) => { byLevel[hit.level] += 1; });

  const byRuleMap = new Map();
  hits.forEach((hit) => {
    const key = hit.code;
    if (!byRuleMap.has(key)) {
      byRuleMap.set(key, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0 });
    }
    byRuleMap.get(key).count += 1;
  });

  const byFileMap = new Map();
  hits.forEach((hit) => {
    const key = hit.path;
    if (!byFileMap.has(key)) byFileMap.set(key, { path: hit.path, fileType: hit.fileType, count: 0 });
    byFileMap.get(key).count += 1;
  });

  return {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesSelected: rulesSelected.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    scope: {
      dirPrefix: prefix,
      fileType,
      levels,
      ruleIds: selectedIds,
      limit,
    },
    inactiveRules,
    notice,
    inactiveNote,
    hits: shownHits,
    summary: {
      total,
      returned: shownHits.length,
      truncated,
      limit,
      omitted: total - shownHits.length,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

module.exports = { scan, ruleAppliesToFile, pathMatchesPrefix };
