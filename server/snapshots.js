const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError } = require('./api');

const MAX_NAME_LENGTH = 60;
// 与 target.js 里单次响应内容的留存上限保持一致
const MAX_BODY_LENGTH = 1024 * 1024;

function pickText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 快照名称单独校验：为空或超长都当场拒绝，由页面把问题标到名称这一项上
function validateSnapshotName(value, data) {
  const name = pickText(value);
  if (!name) {
    throw new ApiError(400, 'SNAPSHOT_NAME_REQUIRED', '请填写快照名称，名称为空时不能留存', 'snapshotName');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError(400, 'SNAPSHOT_NAME_TOO_LONG', `快照名称不能超过 ${MAX_NAME_LENGTH} 个字符`, 'snapshotName');
  }
  const duplicated = (data.snapshots || []).some((item) => item.name === name);
  if (duplicated) {
    throw new ApiError(400, 'SNAPSHOT_NAME_DUPLICATE', `快照名称「${name}」已经存在，请换一个名称`, 'snapshotName');
  }
  return name;
}

// 只接受真正收到的响应：网络层失败、没有响应内容的结果不能留成快照
function validateResponse(input) {
  if (!input || typeof input !== 'object' || input.ok !== true) {
    throw new ApiError(400, 'SNAPSHOT_RESPONSE_INCOMPLETE', '这次请求没有收到可留存的响应，请先成功发送一次', 'response');
  }
  if (typeof input.targetUrl !== 'string' || !input.targetUrl) {
    throw new ApiError(400, 'SNAPSHOT_RESPONSE_INVALID', '留存内容缺少目标地址，响应信息不完整', 'response');
  }
  if (!Number.isInteger(input.status)) {
    throw new ApiError(400, 'SNAPSHOT_RESPONSE_INVALID', '留存内容缺少响应状态，响应信息不完整', 'response');
  }
  if (typeof input.body !== 'string') {
    throw new ApiError(400, 'SNAPSHOT_RESPONSE_INVALID', '留存内容缺少响应正文，响应信息不完整', 'response');
  }
  if (input.body.length > MAX_BODY_LENGTH) {
    throw new ApiError(400, 'SNAPSHOT_BODY_TOO_LARGE', '响应内容过大，不能留存为快照', 'response');
  }
}

function listSnapshots() {
  const data = load();
  return data.snapshots
    .slice()
    .sort((a, b) => {
      if (a.savedAt === b.savedAt) return a.id < b.id ? 1 : -1;
      return a.savedAt < b.savedAt ? 1 : -1;
    });
}

function getSnapshot(id) {
  const data = load();
  const found = data.snapshots.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', '快照不存在或已被删除', '');
  return found;
}

// 留存一次响应：记下名称、留存时刻与来源用例（用例被删除或本次为手工发送时来源留空）
function createSnapshot(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  validateResponse(input.response);

  const data = load();
  const name = validateSnapshotName(input.name, data);

  let sourceCaseId = typeof input.sourceCaseId === 'string' ? input.sourceCaseId : '';
  let sourceCaseName = '';
  if (sourceCaseId) {
    const sourceCase = data.cases.find((item) => item.id === sourceCaseId);
    if (sourceCase) {
      sourceCaseName = sourceCase.name;
    } else {
      // 来源用例已经被删除时，这次留存只记成普通响应，不再挂用例
      sourceCaseId = '';
    }
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    name,
    savedAt: now,
    sourceCaseId,
    sourceCaseName,
    sourceMethod: typeof input.sourceMethod === 'string' ? input.sourceMethod : '',
    sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : '',
    response: input.response,
  };
  data.snapshots.push(created);
  save(data);
  return created;
}

function deleteSnapshot(id) {
  const data = load();
  const index = data.snapshots.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', '快照不存在或已被删除', '');
  const [removed] = data.snapshots.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = {
  listSnapshots,
  getSnapshot,
  createSnapshot,
  deleteSnapshot,
};
