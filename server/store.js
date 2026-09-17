const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

// 初始数据：用例集合与响应快照集合都从空开始，示例用例指向内置示例接口，装上依赖就能直接发送
function seedData() {
  return {
    cases: [
      {
        id: 'case-1001',
        name: '回声接口连通性检查',
        method: 'GET',
        url: '/demo/echo?from=workbench',
        headers: [{ key: 'Accept', value: 'application/json' }],
        body: '',
        createdAt: '2026-09-17T01:20:00.000Z',
        updatedAt: '2026-09-17T01:20:00.000Z',
      },
      {
        id: 'case-1002',
        name: '回声接口请求内容回显',
        method: 'POST',
        url: '/demo/echo',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        body: '{\n  "sku": "SKU-1001",\n  "count": 2\n}',
        createdAt: '2026-09-17T01:45:00.000Z',
        updatedAt: '2026-09-17T01:45:00.000Z',
      },
      {
        id: 'case-1003',
        name: '列表接口分页取值',
        method: 'GET',
        url: '/demo/items?page=2&size=2',
        headers: [{ key: 'Accept', value: 'application/json' }],
        body: '',
        createdAt: '2026-09-17T02:10:00.000Z',
        updatedAt: '2026-09-17T02:10:00.000Z',
      },
      {
        id: 'case-1004',
        name: '报错接口状态码核对',
        method: 'GET',
        url: '/demo/status?code=500',
        headers: [{ key: 'Accept', value: 'application/json' }],
        body: '',
        createdAt: '2026-09-17T02:30:00.000Z',
        updatedAt: '2026-09-17T02:30:00.000Z',
      },
    ],
    snapshots: [],
  };
}

// 把单条用例整理成固定结构，避免数据文件被手工改动后出现缺字段
function normalizeCase(item) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    method: typeof source.method === 'string' && source.method ? source.method.toUpperCase() : 'GET',
    url: typeof source.url === 'string' ? source.url : '',
    headers: Array.isArray(source.headers)
      ? source.headers
          .filter((row) => row && typeof row === 'object')
          .map((row) => ({
            key: typeof row.key === 'string' ? row.key : '',
            value: typeof row.value === 'string' ? row.value : '',
          }))
      : [],
    body: typeof source.body === 'string' ? source.body : '',
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

function textOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

// 快照里留存的单次响应：成功时记下状态、响应头与响应内容，失败时记下失败原因
function normalizeResponse(source) {
  const input = source && typeof source === 'object' ? source : {};
  const ok = input.ok === true;
  const response = {
    ok,
    internal: input.internal === true,
    targetUrl: textOrEmpty(input.targetUrl),
    timeMs: Number.isFinite(Number(input.timeMs)) ? Number(input.timeMs) : 0,
  };
  if (ok) {
    response.status = Number.isInteger(input.status) ? input.status : 0;
    response.statusText = textOrEmpty(input.statusText);
    response.size = Number.isFinite(Number(input.size)) ? Number(input.size) : 0;
    response.truncated = input.truncated === true;
    response.contentType = textOrEmpty(input.contentType);
    response.headers = Array.isArray(input.headers)
      ? input.headers
          .filter((row) => row && typeof row === 'object')
          .map((row) => ({ key: textOrEmpty(row.key), value: textOrEmpty(row.value) }))
      : [];
    response.body = textOrEmpty(input.body);
  } else {
    const failure = input.failure && typeof input.failure === 'object' ? input.failure : {};
    response.failure = {
      reason: textOrEmpty(failure.reason),
      detail: textOrEmpty(failure.detail),
      code: textOrEmpty(failure.code),
    };
  }
  return response;
}

// 把单条快照整理成固定结构：名称、留存时刻、来源用例与留存的响应缺一不可
function normalizeSnapshot(item) {
  const source = item && typeof item === 'object' ? item : {};
  const savedAt = typeof source.savedAt === 'string' && source.savedAt ? source.savedAt : new Date().toISOString();
  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    savedAt,
    sourceCaseId: typeof source.sourceCaseId === 'string' ? source.sourceCaseId : '',
    sourceCaseName: typeof source.sourceCaseName === 'string' ? source.sourceCaseName : '',
    sourceMethod: typeof source.sourceMethod === 'string' ? source.sourceMethod : '',
    sourceUrl: typeof source.sourceUrl === 'string' ? source.sourceUrl : '',
    response: normalizeResponse(source.response),
  };
}

// 整份数据保证 cases 与 snapshots 都存在且元素结构一致
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const cases = Array.isArray(source.cases) ? source.cases.map(normalizeCase).filter((item) => item.id) : [];
  const snapshots = Array.isArray(source.snapshots)
    ? source.snapshots.map(normalizeSnapshot).filter((item) => item.id)
    : [];
  return { ...source, cases, snapshots };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = { load, save, seedData, normalizeSnapshot, DATA_FILE };
