function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

function formatLine(raw) {
  const clean = stripAnsi(raw);

  if (/^Count=\d+/.test(clean)) {
    return [{ text: clean, className: 'cyan' }];
  }

  if (!/TotalCells=/.test(clean)) {
    return [{ text: clean, className: '' }];
  }

  const segments = [];
  const re = /(TotalCells=\d+)|(TotalPrice=\d+)|(Count=\d+)/g;
  let last = 0;
  let match;

  while ((match = re.exec(clean)) !== null) {
    if (match.index > last) {
      segments.push({ text: clean.slice(last, match.index), className: '' });
    }
    segments.push({
      text: match[0],
      className: match[1] ? 'cells' : match[2] ? 'price' : 'cyan',
    });
    last = re.lastIndex;
  }

  if (last < clean.length) {
    segments.push({ text: clean.slice(last), className: '' });
  }

  return segments;
}

function parseResultRow(line) {
  const clean = stripAnsi(line.text);
  const match = clean.match(/^\s*TotalCells=(\d+),\s*TotalPrice=(\d+),\s*Count=(\d+):\s*(.*)$/);
  if (!match) return null;

  return {
    id: line.id,
    text: clean,
    totalCells: Number(match[1]),
    totalPrice: Number(match[2]),
    count: Number(match[3]),
    combo: match[4],
  };
}

function isCountHeader(line) {
  return /^Count=\d+/.test(stripAnsi(line.text));
}

function isEmptyCombinationLine(line) {
  return stripAnsi(line.text).trim() === '(no combination found)';
}

function getLineTotalCells(line) {
  const match = stripAnsi(line.text).match(/^\s*TotalCells=(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeSort(sort) {
  if (!sort?.key) return { key: '', direction: 'asc' };
  return {
    key: sort.key,
    direction: sort.direction === 'desc' ? 'desc' : 'asc',
  };
}

function makeStoredLine(id, text, className = '') {
  return {
    id,
    text: String(text ?? ''),
    className,
  };
}

function appendTextLines(state, text, className = '') {
  const lines = String(text ?? '').split('\n');
  const rawLines = [...state.rawLines];
  let nextLineId = state.nextLineId;

  lines.forEach((line, lineIndex) => {
    if (lineIndex === lines.length - 1 && line === '') return;
    rawLines.push(makeStoredLine(`line-${nextLineId}`, line, className));
    nextLineId += 1;
  });

  return {
    ...state,
    rawLines: state.shouldSortTotalCellsBlocks ? sortTotalCellsBlocks(rawLines) : rawLines,
    nextLineId,
  };
}

function sortTotalCellsBlocks(lines) {
  const nextLines = [...lines];
  let start = null;

  function sortBlock(end) {
    if (start === null || end - start <= 1) return;
    const sorted = nextLines
      .slice(start, end)
      .sort((left, right) => getLineTotalCells(left) - getLineTotalCells(right));
    nextLines.splice(start, end - start, ...sorted);
  }

  nextLines.forEach((line, lineIndex) => {
    if (getLineTotalCells(line) !== null) {
      if (start === null) start = lineIndex;
      return;
    }
    sortBlock(lineIndex);
    start = null;
  });
  sortBlock(nextLines.length);

  return nextLines;
}

function getStatusLine(line) {
  const clean = stripAnsi(line.text).trim();
  if (!clean || isCountHeader(line) || isEmptyCombinationLine(line) || parseResultRow(line)) return '';
  return clean;
}

function getStatusKind(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const clean = getStatusLine(lines[index]);
    if (!clean) continue;
    if (clean === '请输入参数' || clean.toLowerCase().includes('error') || clean.includes('错误')) return 'error';
    return 'default';
  }
  return 'default';
}

function getStatusLineFromLines(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const clean = getStatusLine(lines[index]);
    if (clean) return clean;
  }
  return '';
}

export function createSolverOutputRunState(config = {}) {
  return {
    runId: config.runId ?? 0,
    resultMode: config.resultMode === 'text' ? 'text' : 'table',
    script: String(config.script ?? ''),
    args: String(config.args ?? ''),
    filter: String(config.filter ?? ''),
    sort: normalizeSort(config.sort),
    rawLines: [],
    nextLineId: 1,
    shouldSortTotalCellsBlocks: String(config.script ?? '') === 'solve-purple-combo.js' &&
      /\bdedupe-total-cells\b/.test(String(config.args ?? '')),
  };
}

export function applySolverOutputMessage(state, message = {}) {
  if (!state) return state;

  if (message.type === 'append-source') {
    const sourceMessage = message.message ?? {};
    if (sourceMessage.type === 'out') {
      return appendTextLines(state, sourceMessage.text, '');
    }
    if (sourceMessage.type === 'err') {
      return appendTextLines(state, sourceMessage.text, 'err');
    }
    if (sourceMessage.type === 'done') {
      return appendTextLines(state, `[完成，退出码 ${sourceMessage.code}]`, 'dim');
    }
    if (sourceMessage.type === 'status') {
      return appendTextLines(state, sourceMessage.text, sourceMessage.className ?? '');
    }
    return state;
  }

  if (message.type === 'set-filter') {
    return {
      ...state,
      filter: String(message.filter ?? ''),
    };
  }

  if (message.type === 'set-sort') {
    return {
      ...state,
      sort: normalizeSort(message.sort),
    };
  }

  if (message.type === 'hydrate-lines') {
    let nextLineId = 1;
    return {
      ...state,
      rawLines: (message.rawLines ?? []).map((line) => {
        const id = `line-${nextLineId}`;
        nextLineId += 1;
        return makeStoredLine(id, line?.text ?? '', typeof line?.className === 'string' ? line.className : '');
      }),
      nextLineId,
    };
  }

  return state;
}

export function buildSolverOutputSnapshot(state) {
  const query = state.filter.trim().toLowerCase();
  const filteredLines = query
    ? state.rawLines.filter((line) => line.text.toLowerCase().includes(query))
    : state.rawLines;
  const rows = filteredLines
    .map(parseResultRow)
    .filter(Boolean);
  const sort = normalizeSort(state.sort);
  const orderedRows = !sort.key ? rows : [...rows].sort((left, right) => {
    const direction = sort.direction === 'desc' ? -1 : 1;
    if (left[sort.key] === right[sort.key]) return 0;
    return left[sort.key] > right[sort.key] ? direction : -direction;
  });

  return {
    rawLines: state.rawLines.map((line) => ({
      text: line.text,
      className: line.className,
    })),
    rows: orderedRows,
    lines: filteredLines.map((line) => ({
      ...line,
      segments: line.className ? [{ text: line.text, className: line.className }] : formatLine(line.text),
    })),
    statusLine: getStatusLineFromLines(state.rawLines),
    statusKind: getStatusKind(state.rawLines),
  };
}
