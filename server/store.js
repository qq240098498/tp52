const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

// 初始数据：当前版本只维护用例集合，示例用例都指向内置示例接口，装上依赖就能直接发送
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
    // 响应快照集合：保存的是某一次实际响应的状态、响应头与响应内容
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

// 快照里保存的响应只取结果对象中与响应本身相关的字段，来源请求信息与前端状态不进快照
function normalizeResponse(source) {
  const value = source && typeof source === 'object' ? source : {};
  return {
    ok: value.ok !== false,
    internal: value.internal === true,
    targetUrl: typeof value.targetUrl === 'string' ? value.targetUrl : '',
    status: Number.isInteger(value.status) ? value.status : 0,
    statusText: typeof value.statusText === 'string' ? value.statusText : '',
    timeMs: Number.isFinite(value.timeMs) ? value.timeMs : 0,
    size: Number.isFinite(value.size) ? value.size : 0,
    truncated: value.truncated === true,
    contentType: typeof value.contentType === 'string' ? value.contentType : '',
    body: typeof value.body === 'string' ? value.body : '',
    headers: Array.isArray(value.headers)
      ? value.headers
          .filter((row) => row && typeof row === 'object')
          .map((row) => ({
            key: typeof row.key === 'string' ? row.key : '',
            value: typeof row.value === 'string' ? row.value : '',
          }))
      : [],
  };
}

// 把单条快照整理成固定结构：名称、留存时刻、来源用例与留存时的响应
function normalizeSnapshot(item) {
  const source = item && typeof item === 'object' ? item : {};
  const savedAt = typeof source.savedAt === 'string' && source.savedAt ? source.savedAt : new Date().toISOString();
  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    sourceCaseId: typeof source.sourceCaseId === 'string' ? source.sourceCaseId : '',
    sourceCaseName: typeof source.sourceCaseName === 'string' ? source.sourceCaseName : '',
    request: normalizeSourceRequest(source.request),
    response: normalizeResponse(source.response),
    savedAt,
  };
}

// 留存时的请求信息（方式与目标地址）只用于在对比区说明快照从哪条链路来
function normalizeSourceRequest(source) {
  const value = source && typeof source === 'object' ? source : {};
  return {
    method: typeof value.method === 'string' && value.method ? value.method.toUpperCase() : '',
    url: typeof value.url === 'string' ? value.url : '',
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

module.exports = { load, save, seedData, DATA_FILE };
