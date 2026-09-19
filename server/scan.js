const { load, LEVELS, STATUSES, FILE_TYPES } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

// 命中条数上限：不填表示不限；填了就必须是正整数，零、负数、小数或不是整数当场拒绝
function parseLimit(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') {
    throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限要填正整数，不能填 0、负数或其他非数字内容', 'scanLimit');
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限要填正整数，不能填 0、负数或小数', 'scanLimit');
    }
    return value;
  }
  const text = pickText(value);
  if (!text) return null;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new ApiError(400, 'LIMIT_INVALID', '命中条数上限要填正整数，不能填 0、负数、小数或其他文字', 'scanLimit');
  }
  return Number(text);
}

// 多条规则的入参可以是数组，也可以兼容单条文本；去空白、去重、丢掉空值
function parseIdList(value) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const ids = [];
  raw.forEach((item) => {
    const id = pickText(item);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

// 级别筛选既支持单个也支持多个，值不在三个级别里的当场指出来
function parseLevels(value) {
  const raw = Array.isArray(value) ? value : [value];
  const levels = [];
  raw.forEach((item) => {
    const level = pickText(item);
    if (!level) return;
    if (!LEVELS.includes(level)) {
      throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevels');
    }
    if (!levels.includes(level)) levels.push(level);
  });
  return levels;
}

// 目录前缀：去掉首尾空白，不允许绝对路径与跳到上级的写法，斜杠统一成 /
function parseDirPrefix(value) {
  const prefix = pickText(value);
  if (!prefix) return '';
  const normalized = prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new ApiError(400, 'DIR_PREFIX_INVALID', '目录前缀要写成相对路径，例如 src/server，不能用 / 开头或 .. 跳到上级', 'scanDirPrefix');
  }
  return normalized;
}

// 文件在不在选中的目录前缀下：前缀本身或它的下一级目录开头都算
function fileUnderPrefix(file, prefix) {
  if (!prefix) return true;
  return file.path === prefix || file.path.startsWith(`${prefix}/`);
}

// 扫一遍：启用的规则逐条去比对范围内的文件，命中记到具体行上。
// 目录前缀、文件类型、具体规则、级别几项范围可以叠加，命中清单可以设上限
function scan(options) {
  const input = options && typeof options === 'object' ? options : {};
  const dirPrefix = parseDirPrefix(input.dirPrefix);
  const fileType = pickText(input.fileType);
  const levels = parseLevels(input.levels !== undefined ? input.levels : input.level);
  const ruleIds = parseIdList(input.ruleIds !== undefined ? input.ruleIds : input.ruleId);
  const limit = parseLimit(input.limit);

  if (fileType && !(FILE_TYPES.includes(fileType) && fileType !== '全部')) {
    throw new ApiError(400, 'FILE_TYPE_INVALID', `文件类型只能是 ${FILE_TYPES.filter((item) => item !== '全部').join('、')} 其中之一`, 'scanFileType');
  }

  const data = load();

  ruleIds.forEach((id) => {
    if (!data.rules.some((item) => item.id === id)) {
      throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里，可能已被删除', 'scanRules');
    }
  });

  // 这一轮的文件范围：目录前缀与文件类型叠加
  const filesInScopeList = data.files
    .filter((file) => fileUnderPrefix(file, dirPrefix))
    .filter((file) => !fileType || file.type === fileType);

  // 这一轮的规则范围：勾了具体规则就只看勾的，再叠加级别；停用规则永远不参与
  const enabled = data.rules.filter((item) => item.status === STATUSES[0]);
  const selectedRules = ruleIds
    .map((id) => data.rules.find((item) => item.id === id))
    .filter(Boolean);
  const rulesUsed = enabled
    .filter((item) => !ruleIds.length || selectedRules.some((rule) => rule.id === item.id))
    .filter((item) => !levels.length || levels.includes(item.level));

  // 勾了但这一轮不参与的规则要在页面上说清楚：停用，或级别被级别筛选挡掉
  const notes = [];
  selectedRules.forEach((rule) => {
    if (rule.status !== STATUSES[0]) {
      notes.push(`${rule.code}（${rule.name}）当前是停用状态，这一轮不参与比对`);
    } else if (levels.length && !levels.includes(rule.level)) {
      notes.push(`${rule.code}（${rule.name}）的级别是${rule.level}，被级别筛选挡掉，这一轮不参与比对`);
    }
  });

  // 范围一个文件都不覆盖、规则一条都没选中时，不出空清单，直接说明原因
  let emptyReason = '';
  if (!filesInScopeList.length) {
    const parts = [];
    if (dirPrefix) parts.push(`目录前缀 ${dirPrefix}/`);
    if (fileType) parts.push(`文件类型 ${fileType}`);
    emptyReason = parts.length
      ? `范围里一个文件都没有：${parts.join(' 且 ')} 下没有收录的文件，放宽范围再扫`
      : '清单里一个文件都没有，先到文件区收录文件';
  } else if (!rulesUsed.length) {
    if (ruleIds.length) {
      emptyReason = '勾选的规则这一轮都不参与比对（可能已停用或被级别筛选挡掉），页面上方有逐条说明';
    } else if (levels.length) {
      emptyReason = `级别只选了 ${levels.join('、')}，启用规则里没有这个级别的规则`;
    } else {
      emptyReason = '现在没有启用的规则，先到规则区启用至少一条';
    }
  }

  const hits = [];
  if (!emptyReason) {
    rulesUsed.forEach((rule) => {
      filesInScopeList.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
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

  // 汇总按全部命中统计，不受上限影响；清单本身按排序后的顺序只留前 limit 条
  const totalHits = hits.length;
  const truncated = limit !== null && totalHits > limit;
  const truncatedCount = truncated ? totalHits - limit : 0;
  const shownHits = truncated ? hits.slice(0, limit) : hits;

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
    scope: {
      dirPrefix: dirPrefix || '',
      fileType: fileType || '',
      ruleIds: ruleIds.slice(),
      levels: levels.slice(),
      limit,
    },
    enabledRules: enabled.length,
    rulesTotal: data.rules.length,
    rulesSelected: ruleIds.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScopeList.length,
    filesTotal: data.files.length,
    notes,
    emptyReason,
    hits: shownHits,
    limit,
    totalHits,
    truncated,
    truncatedCount,
    summary: {
      total: totalHits,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

module.exports = {
  scan,
  ruleAppliesToFile,
  levelOrder,
  parseLimit,
  parseDirPrefix,
  fileUnderPrefix,
};
