(function () {
  'use strict';

  // 页面状态：用例列表、内置示例接口、请求头草稿行、最近一次响应结果与结果视图
  const state = {
    cases: [],
    selectedId: '',
    headers: [{ key: '', value: '' }],
    demos: [],
    busy: false,
    result: null,
    resultView: 'structured',
    // 最近一次已发出的请求方式与目标地址、当时选用的来源用例，用于响应留存
    resultRequest: null,
    resultSourceCaseId: '',
    snapshots: [],
    compareLeft: '',
    compareRight: '',
  };

  const dom = {
    health: document.getElementById('health-badge'),
    notice: document.getElementById('notice'),
    name: document.getElementById('field-name'),
    method: document.getElementById('field-method'),
    url: document.getElementById('field-url'),
    body: document.getElementById('field-body'),
    headerRows: document.getElementById('header-rows'),
    addHeader: document.getElementById('add-header'),
    demos: document.getElementById('demo-list'),
    demoSummary: document.getElementById('demo-summary'),
    sendRequest: document.getElementById('send-request'),
    saveCase: document.getElementById('save-case'),
    resetDraft: document.getElementById('reset-draft'),
    resultBody: document.getElementById('result-body'),
    resultSummary: document.getElementById('result-summary'),
    clearResult: document.getElementById('clear-result'),
    caseList: document.getElementById('case-list'),
    caseSummary: document.getElementById('case-summary'),
    refreshCases: document.getElementById('refresh-cases'),
    caseDetail: document.getElementById('case-detail'),
    closeDetail: document.getElementById('close-detail'),
    snapshotSave: document.getElementById('snapshot-save'),
    snapshotName: document.getElementById('snapshot-name'),
    saveSnapshot: document.getElementById('save-snapshot'),
    snapshotPanel: document.getElementById('snapshot-panel'),
    snapshotSummary: document.getElementById('snapshot-summary'),
    refreshSnapshots: document.getElementById('refresh-snapshots'),
    snapshotList: document.getElementById('snapshot-list'),
    selectLeft: document.getElementById('snapshot-select-left'),
    selectRight: document.getElementById('snapshot-select-right'),
    snapshotDiff: document.getElementById('snapshot-diff'),
  };

  const emptyDetailHint = '在用例列表点「详情」，这里显示该用例保存下来的目标地址、请求头与请求内容。';
  // 结构化视图最多铺开的层级条目数量，避免内容过大时页面卡顿
  const TREE_LIMIT = 800;
  // 逐层对比最多铺开的对齐行数量，超出部分提示去看原始响应
  const DIFF_ROW_LIMIT = 1500;
  let noticeTimer = 0;

  // ---------------- 后端交互 ----------------

  // 统一请求入口：把服务端返回的错误码与出错位置打包进异常对象
  async function request(path, options) {
    const config = options || {};
    const init = { method: config.method || 'GET' };
    if (config.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(config.body);
    }

    let response = null;
    try {
      response = await fetch(path, init);
    } catch (err) {
      const error = new Error('无法连接服务，请确认服务已启动');
      error.code = 'NETWORK_ERROR';
      error.field = '';
      throw error;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok) {
      const info = (payload && payload.error) || {};
      const error = new Error(info.message || `操作失败（状态码 ${response.status}）`);
      error.code = info.code || 'request_failed';
      error.field = typeof info.field === 'string' ? info.field : '';
      throw error;
    }
    return payload;
  }

  function setBusy(busy, activeAction) {
    state.busy = busy;
    dom.sendRequest.disabled = busy;
    dom.saveCase.disabled = busy;
    dom.resetDraft.disabled = busy;
    dom.refreshCases.disabled = busy;
    dom.saveSnapshot.disabled = busy;
    dom.refreshSnapshots.disabled = busy;
    dom.sendRequest.textContent = busy && activeAction === 'send' ? '发送中…' : '发送请求';
    dom.saveCase.textContent = busy && activeAction === 'save' ? '正在保存…' : '保存为用例';
    dom.saveSnapshot.textContent = busy && activeAction === 'snapshot' ? '正在留存…' : '留存为快照';
  }

  // ---------------- 页面消息与出错标记 ----------------

  function showNotice(message, type) {
    dom.notice.textContent = message;
    dom.notice.className = `notice notice-${type || 'info'}`;
    dom.notice.hidden = false;
    window.clearTimeout(noticeTimer);
    const stay = type === 'error' ? 6000 : 3500;
    noticeTimer = window.setTimeout(() => {
      dom.notice.hidden = true;
    }, stay);
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach((node) => {
      node.hidden = true;
      node.textContent = '';
    });
    [dom.name, dom.url, dom.body, dom.headerRows, dom.snapshotName].forEach((node) => {
      if (node) node.classList.remove('invalid');
    });
  }

  // 服务端给出的位置可能是 headers.2.key 这种形式，标记时按区块归位
  function normalizeField(field) {
    if (typeof field !== 'string' || !field) return '';
    const key = field.split('.')[0];
    return ['name', 'method', 'url', 'headers', 'body', 'snapshotName'].includes(key) ? key : '';
  }

  function showFieldError(field, message) {
    const key = normalizeField(field);
    if (!key) return;
    const slot = document.querySelector(`[data-error="${key}"]`);
    if (slot) {
      slot.textContent = message;
      slot.hidden = false;
    }
    const target = {
      name: dom.name,
      method: dom.method,
      url: dom.url,
      headers: dom.headerRows,
      body: dom.body,
      snapshotName: dom.snapshotName,
    }[key];
    if (target) target.classList.add('invalid');
  }

  // ---------------- 请求区 ----------------

  function renderHeaderRows() {
    dom.headerRows.textContent = '';
    if (!state.headers.length) {
      const empty = document.createElement('p');
      empty.className = 'rows-empty';
      empty.textContent = '暂无请求头';
      dom.headerRows.appendChild(empty);
      return;
    }

    state.headers.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'header-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'header-key';
      keyInput.value = row.key;
      keyInput.autocomplete = 'off';
      keyInput.dataset.index = String(index);
      keyInput.dataset.part = 'key';
      keyInput.setAttribute('aria-label', `第 ${index + 1} 行请求头名称`);

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'header-value';
      valueInput.value = row.value;
      valueInput.autocomplete = 'off';
      valueInput.dataset.index = String(index);
      valueInput.dataset.part = 'value';
      valueInput.setAttribute('aria-label', `第 ${index + 1} 行请求头取值`);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-small';
      remove.textContent = '删除';
      remove.dataset.action = 'remove-header';
      remove.dataset.index = String(index);

      line.append(keyInput, valueInput, remove);
      dom.headerRows.appendChild(line);
    });
  }

  function collectDraft() {
    return {
      name: dom.name.value.trim(),
      method: dom.method.value,
      url: dom.url.value.trim(),
      headers: state.headers.map((row) => ({ key: row.key.trim(), value: row.value })),
      body: dom.body.value,
    };
  }

  // 把一份请求内容写回表单，既用于示例接口填入，也用于用例回填
  function fillDraft(draft) {
    dom.name.value = typeof draft.name === 'string' ? draft.name : '';
    dom.method.value = draft.method || 'GET';
    dom.url.value = draft.url || '';
    dom.body.value = typeof draft.body === 'string' ? draft.body : '';
    state.headers = Array.isArray(draft.headers) && draft.headers.length
      ? draft.headers.map((row) => ({
          key: typeof row.key === 'string' ? row.key : '',
          value: typeof row.value === 'string' ? row.value : '',
        }))
      : [{ key: '', value: '' }];
    renderHeaderRows();
    clearFieldErrors();
  }

  function resetDraft(silent) {
    fillDraft({ name: '', method: 'GET', url: '', headers: [], body: '' });
    if (!silent) showNotice('草稿已清空', 'info');
  }

  // ---------------- 内置示例接口 ----------------

  async function loadDemos() {
    try {
      const data = await request('/api/demos');
      state.demos = data && Array.isArray(data.endpoints) ? data.endpoints : [];
    } catch (err) {
      state.demos = [];
    }
    renderDemos();
  }

  function renderDemos() {
    dom.demos.textContent = '';
    if (!state.demos.length) {
      dom.demoSummary.textContent = '读取失败';
      const hint = document.createElement('p');
      hint.className = 'rows-empty';
      hint.textContent = '内置示例接口暂时读取不到，可以直接在目标地址里填写完整地址';
      dom.demos.appendChild(hint);
      return;
    }

    dom.demoSummary.textContent = `共 ${state.demos.length} 个`;
    state.demos.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'demo-item';

      const main = document.createElement('div');
      main.className = 'demo-main';

      const title = document.createElement('div');
      title.className = 'demo-title';
      const nameNode = document.createElement('span');
      nameNode.className = 'demo-name';
      nameNode.textContent = item.name;
      title.append(nameNode, buildTag(item.method, item.method === 'GET' ? 'get' : 'any'));

      const pathNode = document.createElement('p');
      pathNode.className = 'demo-path';
      pathNode.textContent = item.path;

      const summaryNode = document.createElement('p');
      summaryNode.className = 'demo-summary';
      summaryNode.textContent = item.summary;

      main.append(title, pathNode, summaryNode);

      const fill = document.createElement('button');
      fill.type = 'button';
      fill.className = 'btn btn-small';
      fill.textContent = '填入请求区';
      fill.addEventListener('click', () => {
        fillDraft(item.example);
        state.selectedId = '';
        renderCases();
        showNotice(`已把「${item.name}」填入请求区，点发送请求即可看到结果`, 'info');
      });

      row.append(main, fill);
      dom.demos.appendChild(row);
    });
  }

  // ---------------- 发送请求与结果展示 ----------------

  async function sendRequest() {
    if (state.busy) return;
    clearFieldErrors();

    const draft = collectDraft();
    if (!draft.url) {
      showFieldError('url', '请填写目标地址');
      showNotice('请填写目标地址', 'error');
      dom.url.focus();
      return;
    }
    if (draft.body.trim() && (draft.method === 'GET' || draft.method === 'HEAD')) {
      showFieldError('body', `请求方式为 ${draft.method} 时不带请求内容，请清空请求内容或更换请求方式`);
      showNotice('请求方式与请求内容不匹配，请调整后再发送', 'error');
      return;
    }

    setBusy(true, 'send');
    renderResultPending(draft);
    const sourceCaseId = state.selectedId;
    try {
      const result = await request('/api/send', { method: 'POST', body: draft });
      state.result = result;
      state.resultRequest = { method: draft.method, url: draft.url };
      state.resultSourceCaseId = sourceCaseId;
      renderResult(result);
      setSnapshotSaveVisible(Boolean(result.ok));
      if (result.ok) {
        showNotice(`请求已完成：状态码 ${result.status}，耗时 ${formatDuration(result.timeMs)}`, 'success');
      } else {
        showNotice(`请求失败：${result.failure.reason}`, 'error');
      }
    } catch (err) {
      state.result = null;
      state.resultRequest = null;
      state.resultSourceCaseId = '';
      setSnapshotSaveVisible(false);
      if (err.field) showFieldError(err.field, err.message);
      dom.resultSummary.textContent = '';
      dom.resultBody.textContent = '';
      dom.clearResult.hidden = false;
      dom.resultBody.appendChild(buildFailurePanel('这次请求没有发出去', err.message, ''));
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderResultPending(draft) {
    dom.resultSummary.textContent = '正在等待响应';
    dom.clearResult.hidden = true;
    dom.resultBody.textContent = '';
    setSnapshotSaveVisible(false);

    const block = document.createElement('div');
    block.className = 'result-pending';
    const title = document.createElement('p');
    title.className = 'pending-title';
    title.textContent = '请求已发出，正在等待响应…';
    const sub = document.createElement('p');
    sub.className = 'empty-sub';
    sub.textContent = `${draft.method} ${draft.url} 已按照填写的内容发出去，收到回应后这里会显示状态、耗时、响应头与响应内容。`;
    block.append(title, sub);
    dom.resultBody.appendChild(block);
  }

  function renderEmptyResult() {
    dom.resultSummary.textContent = '';
    dom.clearResult.hidden = true;
    dom.resultBody.textContent = '';
    setSnapshotSaveVisible(false);
    dom.resultBody.appendChild(
      buildEmptyBlock(
        '还没有发送过请求',
        '填好请求方式与目标地址后点「发送请求」，这里会显示响应状态、耗时、响应头与响应内容。'
      )
    );
  }

  function renderResult(result) {
    dom.resultBody.textContent = '';
    dom.clearResult.hidden = false;

    const head = document.createElement('div');
    head.className = 'result-head';

    if (result.ok) {
      head.appendChild(buildStatusBadge(result.status, result.statusText));
      head.appendChild(buildChip(`耗时 ${formatDuration(result.timeMs)}`));
      head.appendChild(buildChip(`内容 ${formatBytes(result.size)}`));
      // 状态码落在 400 及以上时，页面同样按失败口径提醒
      if (result.status >= 400) head.appendChild(buildChip('本次响应为失败状态', 'chip-bad'));
      dom.resultSummary.textContent = `最近一次：${result.status} ${result.statusText}`.trim();
    } else {
      head.appendChild(buildStatusBadge(0, '未完成'));
      head.appendChild(buildChip(`已等待 ${formatDuration(result.timeMs)}`));
      dom.resultSummary.textContent = '最近一次：请求未完成';
    }
    dom.resultBody.appendChild(head);

    const targetLine = document.createElement('p');
    targetLine.className = 'result-target';
    targetLine.textContent = result.internal
      ? `目标地址（本机内置示例接口）：${result.targetUrl}`
      : `目标地址：${result.targetUrl}`;
    dom.resultBody.appendChild(targetLine);

    if (!result.ok) {
      dom.resultBody.appendChild(
        buildFailurePanel('请求没有完成', result.failure.reason, result.failure.detail)
      );
      return;
    }

    const headerSection = buildSection('响应头');
    if (result.headers.length) {
      headerSection.appendChild(buildHeaderTable(result.headers));
    } else {
      headerSection.appendChild(buildTextNote('本次响应没有返回响应头'));
    }
    dom.resultBody.appendChild(headerSection);

    const bodySection = buildSection('响应内容');
    bodySection.appendChild(buildBodyView(result));
    dom.resultBody.appendChild(bodySection);
  }

  function buildFailurePanel(title, reason, detail) {
    const panel = document.createElement('div');
    panel.className = 'failure-panel';

    const titleNode = document.createElement('p');
    titleNode.className = 'failure-title';
    titleNode.textContent = title;

    const reasonNode = document.createElement('p');
    reasonNode.className = 'failure-reason';
    reasonNode.textContent = `失败原因：${reason}`;

    panel.append(titleNode, reasonNode);

    if (detail) {
      const detailNode = document.createElement('p');
      detailNode.className = 'failure-detail';
      detailNode.textContent = `详细信息：${detail}`;
      panel.appendChild(detailNode);
    }
    return panel;
  }

  function buildBodyView(result) {
    const wrap = document.createElement('div');
    wrap.className = 'body-view';

    const text = typeof result.body === 'string' ? result.body : '';
    if (!text.trim()) {
      wrap.appendChild(buildTextNote(result.status === 204 ? '本次响应为成功且没有返回内容' : '本次响应没有返回内容'));
      return wrap;
    }

    const tabs = document.createElement('div');
    tabs.className = 'view-tabs';
    tabs.append(
      buildTab('结构化', state.resultView === 'structured', () => switchResultView('structured')),
      buildTab('原始文本', state.resultView === 'raw', () => switchResultView('raw'))
    );
    wrap.appendChild(tabs);

    const parsed = tryParseJson(text);
    if (state.resultView === 'raw') {
      wrap.appendChild(buildPre(text));
    } else if (parsed.ok) {
      wrap.appendChild(buildJsonTree(parsed.value, '', { left: TREE_LIMIT }));
    } else {
      wrap.appendChild(buildTextNote('响应内容不是结构化数据，已按文本显示'));
      wrap.appendChild(buildPre(text));
    }

    if (result.truncated) {
      wrap.appendChild(buildTextNote('响应内容较大，这里只保留了开头的一部分用于展示'));
    }
    return wrap;
  }

  function switchResultView(view) {
    state.resultView = view;
    if (state.result) renderResult(state.result);
  }

  function tryParseJson(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return { ok: false, value: null };
    }
  }

  function buildPre(text) {
    const pre = document.createElement('pre');
    pre.className = 'result-pre';
    pre.textContent = text;
    return pre;
  }

  // 结构化视图：对象与数组逐层铺开，取值按类型区分显示
  function buildJsonTree(value, label, counter) {
    counter.left -= 1;
    const node = document.createElement('div');
    node.className = 'json-node';

    if (value !== null && typeof value === 'object') {
      const isArray = Array.isArray(value);
      const keys = isArray ? value.map((_, index) => index) : Object.keys(value);

      const head = document.createElement('div');
      head.className = 'json-line';
      head.appendChild(buildJsonKey(label));
      head.appendChild(buildJsonTag(`${isArray ? '数组' : '对象'} ${keys.length} 项`));
      node.appendChild(head);

      const children = document.createElement('div');
      children.className = 'json-children';

      if (!keys.length) {
        children.appendChild(buildJsonLine('', isArray ? '空数组' : '空对象', 'empty'));
      } else {
        let shown = 0;
        for (let index = 0; index < keys.length; index += 1) {
          if (counter.left <= 0) break;
          const key = keys[index];
          children.appendChild(
            buildJsonTree(value[key], isArray ? `[${key}]` : String(key), counter)
          );
          shown += 1;
        }
        if (shown < keys.length) {
          children.appendChild(buildTextNote(`还有 ${keys.length - shown} 项未展开，可切换到原始文本查看完整内容`));
        }
      }

      node.appendChild(children);
      return node;
    }

    node.appendChild(buildJsonLine(label, describePrimitive(value), primitiveKind(value)));
    return node;
  }

  function buildJsonLine(label, text, kind) {
    const line = document.createElement('div');
    line.className = 'json-line';
    if (label) line.appendChild(buildJsonKey(label));
    const valueNode = document.createElement('span');
    valueNode.className = `json-value json-${kind}`;
    valueNode.textContent = text;
    line.appendChild(valueNode);
    return line;
  }

  function buildJsonKey(label) {
    const key = document.createElement('span');
    key.className = 'json-key';
    key.textContent = label || '整体内容';
    return key;
  }

  function buildJsonTag(text) {
    const tag = document.createElement('span');
    tag.className = 'json-tag';
    tag.textContent = text;
    return tag;
  }

  function describePrimitive(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  }

  function primitiveKind(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
  }

  // ---------------- 用例区 ----------------

  async function loadCases() {
    const list = await request('/api/cases');
    state.cases = Array.isArray(list) ? list : [];
    if (state.selectedId && !state.cases.some((item) => item.id === state.selectedId)) {
      state.selectedId = '';
    }
    renderCases();
  }

  function renderCases() {
    dom.caseSummary.textContent = `共 ${state.cases.length} 条`;
    dom.caseList.textContent = '';

    if (!state.cases.length) {
      dom.caseList.appendChild(
        buildEmptyBlock('还没有保存过用例', '在请求区填好内容后点「保存为用例」，用例会出现在这里。')
      );
      return;
    }
    state.cases.forEach((item) => {
      dom.caseList.appendChild(buildCaseRow(item));
    });
  }

  function buildEmptyBlock(title, subtitle) {
    const block = document.createElement('div');
    block.className = 'empty';
    const titleNode = document.createElement('p');
    titleNode.className = 'empty-title';
    titleNode.textContent = title;
    const subNode = document.createElement('p');
    subNode.className = 'empty-sub';
    subNode.textContent = subtitle;
    block.append(titleNode, subNode);
    return block;
  }

  function buildTextNote(text) {
    const note = document.createElement('p');
    note.className = 'text-note';
    note.textContent = text;
    return note;
  }

  function buildTag(text, kind) {
    const tag = document.createElement('span');
    tag.className = `method method-${kind || 'any'}`;
    tag.textContent = text;
    return tag;
  }

  function buildCaseRow(item) {
    const row = document.createElement('article');
    row.className = 'case-item';
    if (item.id === state.selectedId) row.classList.add('active');

    const main = document.createElement('div');
    main.className = 'case-main';

    const title = document.createElement('div');
    title.className = 'case-title';
    const nameNode = document.createElement('span');
    nameNode.className = 'case-name';
    nameNode.textContent = item.name;
    title.append(buildTag(item.method, String(item.method).toLowerCase()), nameNode);
    if (item.url.startsWith('/')) title.appendChild(buildTag('内置', 'inner'));

    const urlNode = document.createElement('p');
    urlNode.className = 'case-url';
    urlNode.textContent = item.url;

    const metaNode = document.createElement('p');
    metaNode.className = 'case-meta';
    metaNode.textContent = `请求头 ${item.headers.length} 行 · 保存于 ${formatTime(item.createdAt)}`;

    main.append(title, urlNode, metaNode);

    const actions = document.createElement('div');
    actions.className = 'case-actions';

    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.className = 'btn btn-small';
    fillButton.textContent = '回填';
    fillButton.addEventListener('click', () => {
      applyCase(item);
    });

    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'btn btn-small';
    viewButton.textContent = '详情';
    viewButton.addEventListener('click', () => {
      openDetail(item.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-small btn-danger';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      removeCase(item);
    });

    actions.append(fillButton, viewButton, deleteButton);
    row.append(main, actions);
    return row;
  }

  // 回填：把用例保存下来的内容写回请求区，可以直接点发送请求重发一次
  function applyCase(item) {
    if (state.busy) return;
    fillDraft(item);
    state.selectedId = item.id;
    renderCases();
    renderDetail(item);
    showNotice(`用例「${item.name}」已回填到请求区，可直接点发送请求`, 'success');
  }

  async function openDetail(id) {
    if (state.busy) return;
    try {
      const item = await request(`/api/cases/${encodeURIComponent(id)}`);
      state.selectedId = item.id;
      renderCases();
      renderDetail(item);
    } catch (err) {
      showNotice(err.message, 'error');
      if (err.code === 'CASE_NOT_FOUND') {
        state.selectedId = '';
        renderEmptyDetail();
        try {
          await loadCases();
        } catch (reloadError) {
          showNotice(reloadError.message, 'error');
        }
      }
    }
  }

  function renderDetail(item) {
    dom.caseDetail.textContent = '';

    const head = document.createElement('div');
    head.className = 'detail-head';
    const nameNode = document.createElement('h3');
    nameNode.textContent = item.name;
    head.append(buildTag(item.method, String(item.method).toLowerCase()), nameNode);

    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.className = 'btn btn-small';
    fillButton.textContent = '回填到请求区';
    fillButton.addEventListener('click', () => {
      applyCase(item);
    });
    head.appendChild(fillButton);

    dom.caseDetail.append(head);
    dom.caseDetail.append(buildDetailRow('目标地址', item.url, false));
    dom.caseDetail.append(
      buildDetailRow(
        '请求头',
        item.headers.length ? item.headers.map((row) => `${row.key}: ${row.value}`).join('\n') : '暂无内容',
        true
      )
    );
    dom.caseDetail.append(buildDetailRow('请求内容', item.body || '暂无内容', true));
    dom.caseDetail.append(
      buildDetailRow('保存时间', `${formatTime(item.createdAt)}（最近更新 ${formatTime(item.updatedAt)}）`, false)
    );
    dom.closeDetail.hidden = false;
  }

  function buildDetailRow(label, text, block) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-row';

    const labelNode = document.createElement('span');
    labelNode.className = 'detail-label';
    labelNode.textContent = label;

    const valueNode = document.createElement(block ? 'pre' : 'p');
    valueNode.className = 'detail-value';
    valueNode.textContent = text;

    wrap.append(labelNode, valueNode);
    return wrap;
  }

  function renderEmptyDetail() {
    dom.closeDetail.hidden = true;
    dom.caseDetail.textContent = '';
    const subNode = document.createElement('p');
    subNode.className = 'empty-sub';
    subNode.textContent = emptyDetailHint;
    dom.caseDetail.appendChild(subNode);
  }

  // ---------------- 保存与删除 ----------------

  async function saveCase() {
    if (state.busy) return;
    clearFieldErrors();

    const draft = collectDraft();
    if (!draft.name) {
      showFieldError('name', '请填写用例名称');
      showNotice('请填写用例名称', 'error');
      dom.name.focus();
      return;
    }
    if (!draft.url) {
      showFieldError('url', '请填写目标地址');
      showNotice('请填写目标地址', 'error');
      dom.url.focus();
      return;
    }

    setBusy(true, 'save');
    try {
      const created = await request('/api/cases', { method: 'POST', body: draft });
      state.selectedId = created.id;
      await loadCases();
      renderDetail(created);
      showNotice(`用例「${created.name}」已保存，请求区内容保留可直接发送`, 'success');
    } catch (err) {
      if (err.field) showFieldError(err.field, err.message);
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeCase(item) {
    if (state.busy) return;
    const confirmed = window.confirm(`确认删除用例「${item.name}」？删除后无法恢复。`);
    if (!confirmed) return;

    setBusy(true);
    try {
      await request(`/api/cases/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (state.selectedId === item.id) state.selectedId = '';
      await loadCases();
      if (!state.selectedId) renderEmptyDetail();
      showNotice(`用例「${item.name}」已删除`, 'success');
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 响应快照：留存 ----------------

  function setSnapshotSaveVisible(visible) {
    dom.snapshotSave.hidden = !visible;
    if (!visible) {
      dom.snapshotName.value = '';
      const slot = document.querySelector('[data-error="snapshotName"]');
      if (slot) {
        slot.hidden = true;
        slot.textContent = '';
      }
      dom.snapshotName.classList.remove('invalid');
    }
  }

  async function saveSnapshot() {
    if (state.busy) return;
    if (!state.result || !state.result.ok) {
      showNotice('还没有可留存的响应，请先成功发送一次请求', 'error');
      return;
    }

    const name = dom.snapshotName.value.trim();
    const snapshotSlot = document.querySelector('[data-error="snapshotName"]');
    if (snapshotSlot) {
      snapshotSlot.hidden = true;
      snapshotSlot.textContent = '';
    }
    dom.snapshotName.classList.remove('invalid');
    // 名称为空在页面上当场拒绝，不发请求
    if (!name) {
      if (snapshotSlot) {
        snapshotSlot.textContent = '快照名称不能为空，请先给这一次响应起个名字';
        snapshotSlot.hidden = false;
      }
      dom.snapshotName.classList.add('invalid');
      showNotice('快照名称不能为空', 'error');
      dom.snapshotName.focus();
      return;
    }

    const payload = {
      name,
      sourceCaseId: state.resultSourceCaseId || '',
      request: state.resultRequest || { method: '', url: state.result.targetUrl },
      response: state.result,
    };

    setBusy(true, 'snapshot');
    try {
      const created = await request('/api/snapshots', { method: 'POST', body: payload });
      dom.snapshotName.value = '';
      await loadSnapshots();
      // 新留存的快照默认放到左侧，方便立刻选另一份对比
      state.compareLeft = created.id;
      syncSnapshotPickers();
      renderDiff();
      showNotice(`快照「${created.name}」已留存，记录了留存时刻与来源用例`, 'success');
    } catch (err) {
      if (err.field === 'snapshotName') {
        if (snapshotSlot) {
          snapshotSlot.textContent = err.message;
          snapshotSlot.hidden = false;
        }
        dom.snapshotName.classList.add('invalid');
        dom.snapshotName.focus();
      }
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 响应快照：列表与删除 ----------------

  async function loadSnapshots() {
    const list = await request('/api/snapshots');
    state.snapshots = Array.isArray(list) ? list : [];
    // 已删除或已不存在的快照不能再参与对比，从选择槽里清掉
    const ids = new Set(state.snapshots.map((item) => item.id));
    if (state.compareLeft && !ids.has(state.compareLeft)) state.compareLeft = '';
    if (state.compareRight && !ids.has(state.compareRight)) state.compareRight = '';
    renderSnapshotList();
    syncSnapshotPickers();
    renderDiff();
  }

  function renderSnapshotList() {
    dom.snapshotSummary.textContent = `共 ${state.snapshots.length} 份`;
    dom.snapshotList.textContent = '';

    if (!state.snapshots.length) {
      dom.snapshotList.appendChild(
        buildEmptyBlock(
          '还没有留存过快照',
          '在响应结果里给这一次响应命名并点「留存为快照」，保存后的快照会列在这里；选择两份即可左右并排逐层对比。'
        )
      );
      return;
    }

    state.snapshots.forEach((item) => {
      dom.snapshotList.appendChild(buildSnapshotRow(item));
    });
  }

  function buildSnapshotRow(item) {
    const row = document.createElement('article');
    row.className = 'snapshot-item';

    const main = document.createElement('div');
    main.className = 'snapshot-main';

    const title = document.createElement('div');
    title.className = 'snapshot-title';
    const nameNode = document.createElement('span');
    nameNode.className = 'snapshot-name';
    nameNode.textContent = item.name;
    const method = item.request && item.request.method ? item.request.method : '';
    title.append(buildTag(method || '快照', method ? String(method).toLowerCase() : 'any'), nameNode);
    if (isLeft(item.id)) title.appendChild(buildSlotChip('左', 'slot-left'));
    if (isRight(item.id)) title.appendChild(buildSlotChip('右', 'slot-right'));

    const metaParts = [
      `留存于 ${formatTime(item.savedAt)}`,
      item.sourceCaseName
        ? `来源用例：${item.sourceCaseName}`
        : '来源用例：临时请求（未保存为用例）',
      item.response && item.response.status ? `状态码 ${item.response.status}` : '',
    ].filter(Boolean);

    const metaNode = document.createElement('p');
    metaNode.className = 'snapshot-meta';
    metaNode.textContent = metaParts.join(' · ');

    const urlNode = document.createElement('p');
    urlNode.className = 'snapshot-url';
    urlNode.textContent = (item.request && item.request.url) || (item.response && item.response.targetUrl) || '';

    main.append(title, metaNode, urlNode);

    const actions = document.createElement('div');
    actions.className = 'snapshot-actions';

    const pickLeft = document.createElement('button');
    pickLeft.type = 'button';
    pickLeft.className = 'btn btn-small';
    pickLeft.textContent = isLeft(item.id) ? '取消左侧' : '放到左侧';
    pickLeft.addEventListener('click', () => {
      if (!isLeft(item.id) && item.id === state.compareRight) {
        showNotice('这份快照已经在右侧，左右两侧需要选择两份不同的快照', 'error');
        return;
      }
      state.compareLeft = isLeft(item.id) ? '' : item.id;
      syncSnapshotPickers();
      renderSnapshotList();
      renderDiff();
    });

    const pickRight = document.createElement('button');
    pickRight.type = 'button';
    pickRight.className = 'btn btn-small';
    pickRight.textContent = isRight(item.id) ? '取消右侧' : '放到右侧';
    pickRight.addEventListener('click', () => {
      if (!isRight(item.id) && item.id === state.compareLeft) {
        showNotice('这份快照已经在左侧，左右两侧需要选择两份不同的快照', 'error');
        return;
      }
      state.compareRight = isRight(item.id) ? '' : item.id;
      syncSnapshotPickers();
      renderSnapshotList();
      renderDiff();
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-small btn-danger';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      removeSnapshot(item);
    });

    actions.append(pickLeft, pickRight, deleteButton);
    row.append(main, actions);
    return row;
  }

  function isLeft(id) {
    return state.compareLeft === id;
  }

  function isRight(id) {
    return state.compareRight === id;
  }

  function buildSlotChip(text, kind) {
    const chip = document.createElement('span');
    chip.className = `slot-chip ${kind}`;
    chip.textContent = text;
    return chip;
  }

  // 顶部两个下拉选择槽与列表按钮共用同一份选择状态
  function syncSnapshotPickers() {
    fillPicker(dom.selectLeft, state.compareLeft, '请选择一份快照作为左侧');
    fillPicker(dom.selectRight, state.compareRight, '请选择一份快照作为右侧');
  }

  function fillPicker(select, selectedId, placeholder) {
    select.textContent = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);
    state.snapshots.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
    // selectedId 不在列表（快照被删除）时回落到空槽
    select.value = state.snapshots.some((item) => item.id === selectedId) ? selectedId : '';
  }

  async function removeSnapshot(item) {
    if (state.busy) return;
    const confirmed = window.confirm(`确认删除快照「${item.name}」？删除后它将不能再参与对比，且无法恢复。`);
    if (!confirmed) return;

    setBusy(true, 'snapshot');
    try {
      await request(`/api/snapshots/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (state.compareLeft === item.id) state.compareLeft = '';
      if (state.compareRight === item.id) state.compareRight = '';
      await loadSnapshots();
      showNotice(`快照「${item.name}」已删除，不再参与对比`, 'success');
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 响应快照：逐层对比 ----------------

  function renderDiff() {
    dom.snapshotDiff.textContent = '';
    const left = state.snapshots.find((s) => s.id === state.compareLeft) || null;
    const right = state.snapshots.find((s) => s.id === state.compareRight) || null;

    if (!left || !right) {
      const picked = [left, right].filter(Boolean).length;
      const note = document.createElement('p');
      note.className = 'empty-sub diff-hint';
      note.textContent = picked
        ? `已选好 ${picked} 份，再把另一份快照放到${left ? '右侧' : '左侧'}，即可左右并排逐层对比响应内容。`
        : '在快照列表里选择两份（点「放到左侧 / 放到右侧」，或用上方下拉框），这里会把两边的响应内容按层级对齐，标出新增、删除与取值改动。';
      dom.snapshotDiff.appendChild(note);
      return;
    }

    dom.snapshotDiff.appendChild(buildDiffMeta(left, right));
    const envelopeSection = buildSection('状态码与响应头对比');
    envelopeSection.appendChild(buildEnvelopeDiff(left, right));
    dom.snapshotDiff.appendChild(envelopeSection);

    const bodySection = buildSection('响应内容逐层对比');
    bodySection.appendChild(buildBodyCompareView(compareBodies(left.response, right.response)));
    dom.snapshotDiff.appendChild(bodySection);
  }

  function buildDiffMeta(left, right) {
    const grid = document.createElement('div');
    grid.className = 'diff-meta';
    grid.appendChild(buildDiffMetaCard('左侧快照', left, 'meta-left'));
    grid.appendChild(buildDiffMetaCard('右侧快照', right, 'meta-right'));
    return grid;
  }

  function buildDiffMetaCard(sideLabel, snapshot, extraClass) {
    const card = document.createElement('div');
    card.className = `diff-meta-card ${extraClass}`;

    const head = document.createElement('p');
    head.className = 'diff-meta-side';
    head.textContent = sideLabel;
    const name = document.createElement('span');
    name.className = 'diff-meta-name';
    name.textContent = snapshot.name;
    head.appendChild(name);

    const response = snapshot.response || {};
    const rows = [
      `留存于 ${formatTime(snapshot.savedAt)}`,
      snapshot.sourceCaseName
        ? `来源用例：${snapshot.sourceCaseName}`
        : '来源用例：临时请求（未保存为用例）',
      `${snapshot.request && snapshot.request.method ? snapshot.request.method : ''} ${
        (snapshot.request && snapshot.request.url) || response.targetUrl || ''
      }`.trim(),
      response.status ? `响应状态：${response.status} ${response.statusText || ''}`.trim() : '响应状态：未完成',
    ];
    card.appendChild(head);
    rows.forEach((text) => {
      const line = document.createElement('p');
      line.className = 'diff-meta-line';
      line.textContent = text;
      card.appendChild(line);
    });
    return card;
  }

  // 状态码与响应头也对齐展示，但不属于响应内容主体，单独放一块
  function buildEnvelopeDiff(left, right) {
    const wrap = document.createElement('div');
    wrap.className = 'diff-envelope';

    const statusChanged = Number(left.response.status) !== Number(right.response.status);
    wrap.appendChild(
      buildEnvelopeRow(
        '状态码',
        left.response.status ? String(left.response.status) : '未完成',
        right.response.status ? String(right.response.status) : '未完成',
        statusChanged ? 'change' : 'equal'
      )
    );

    const leftHeaders = headerMap(left.response.headers);
    const rightHeaders = headerMap(right.response.headers);
    const keys = Array.from(new Set([...leftHeaders.keys(), ...rightHeaders.keys()])).sort();
    keys.forEach((key) => {
      const hasLeft = leftHeaders.has(key);
      const hasRight = rightHeaders.has(key);
      const status = !hasLeft ? 'add' : !hasRight ? 'del'
        : leftHeaders.get(key) !== rightHeaders.get(key) ? 'change' : 'equal';
      wrap.appendChild(
        buildEnvelopeRow(
          key,
          hasLeft ? leftHeaders.get(key) : '',
          hasRight ? rightHeaders.get(key) : '',
          status
        )
      );
    });
    return wrap;
  }

  function headerMap(rows) {
    const map = new Map();
    (rows || []).forEach((row) => {
      if (row && row.key) map.set(row.key.toLowerCase(), String(row.value));
    });
    return map;
  }

  function buildEnvelopeRow(label, leftText, rightText, status) {
    const row = document.createElement('div');
    row.className = `diff-row envelope-row diff-${status}`;

    const leftCell = document.createElement('div');
    leftCell.className = 'diff-cell diff-cell-left';
    leftCell.appendChild(buildCellContent(label, leftText, 'left', status, true));

    const mid = document.createElement('div');
    mid.className = 'diff-mid';
    const marker = document.createElement('span');
    marker.className = `diff-marker marker-${status}`;
    marker.textContent = STATUS_MARK[status] || '';
    mid.appendChild(marker);

    const rightCell = document.createElement('div');
    rightCell.className = 'diff-cell diff-cell-right';
    rightCell.appendChild(buildCellContent('', rightText, 'right', status, true));

    row.append(leftCell, mid, rightCell);
    return row;
  }

  const STATUS_MARK = { add: '新增', del: '删除', change: '改动', mismatch: '类型不一致', equal: '' };

  // 先判断两边响应内容能否按 JSON 层级对齐：有一方不是合法 JSON 就不硬拼
  function compareBodies(leftResponse, rightResponse) {
    const leftText = typeof leftResponse.body === 'string' ? leftResponse.body : '';
    const rightText = typeof rightResponse.body === 'string' ? rightResponse.body : '';
    const leftBlank = !leftText.trim();
    const rightBlank = !rightText.trim();

    if (leftBlank && rightBlank) {
      return { comparable: true, bothEmpty: true };
    }
    if (leftBlank || rightBlank) {
      return {
        comparable: false,
        reason: leftBlank
          ? '左侧响应内容为空、右侧有内容，两边不在同一结构上，无法逐层对齐。'
          : '右侧响应内容为空、左侧有内容，两边不在同一结构上，无法逐层对齐。',
        leftText,
        rightText,
      };
    }

    const leftParsed = tryParseJson(leftText);
    const rightParsed = tryParseJson(rightText);
    if (!leftParsed.ok || !rightParsed.ok) {
      const failed = [];
      if (!leftParsed.ok) failed.push('左侧');
      if (!rightParsed.ok) failed.push('右侧');
      return {
        comparable: false,
        reason: `${failed.join('与')}响应内容不是合法 JSON，只能按原始文本各自展示，无法逐层对齐。`,
        leftText,
        rightText,
      };
    }
    return { comparable: true, leftValue: leftParsed.value, rightValue: rightParsed.value };
  }

  function buildBodyCompareView(compare) {
    const view = document.createElement('div');
    view.className = 'body-compare';

    if (compare.bothEmpty) {
      view.appendChild(buildTextNote('两边的响应内容都为空，没有可对比的层级。'));
      return view;
    }
    if (!compare.comparable) {
      view.appendChild(buildMismatchBanner(compare.reason));
      const sides = document.createElement('div');
      sides.className = 'diff-standalone';
      sides.appendChild(buildStandalonePanel('左侧响应原文', compare.leftText));
      sides.appendChild(buildStandalonePanel('右侧响应原文', compare.rightText));
      view.appendChild(sides);
      return view;
    }

    const rows = [];
    const budget = { left: DIFF_ROW_LIMIT };
    buildAlignedRows(compare.leftValue, compare.rightValue, '', '', 0, rows, budget);
    const changedCount = rows.filter((row) => ['add', 'del', 'change', 'mismatch'].includes(row.status)).length;
    if (!changedCount) {
      view.appendChild(buildTextNote('两边响应内容完全一致，下面按层级展开核对。'));
    } else {
      view.appendChild(buildDiffLegend(changedCount));
    }
    view.appendChild(buildAlignedGrid(rows));
    if (budget.left <= 0) {
      view.appendChild(buildTextNote(`响应层级较多，仅对齐了前 ${DIFF_ROW_LIMIT} 行，剩余差异可结合两侧原始响应核对。`));
    }
    return view;
  }

  function buildDiffLegend(count) {
    const legend = document.createElement('div');
    legend.className = 'diff-legend';
    legend.innerHTML =
      '<span class="legend-item legend-add">新增</span>' +
      '<span class="legend-item legend-del">删除</span>' +
      '<span class="legend-item legend-change">取值改动（左旧 → 右新）</span>' +
      `<span class="legend-summary">共标记 ${count} 处差异</span>`;
    return legend;
  }

  function buildMismatchBanner(text) {
    const banner = document.createElement('p');
    banner.className = 'diff-banner';
    banner.textContent = `无法逐层对齐：${text}`;
    return banner;
  }

  function buildStandalonePanel(title, text) {
    const panel = document.createElement('div');
    panel.className = 'diff-standalone-panel';
    const head = document.createElement('p');
    head.className = 'diff-standalone-title';
    head.textContent = title;
    panel.append(head, buildPre(text || '（空）'));
    return panel;
  }

  // ---------------- 逐层对齐的数据建模 ----------------

  function isContainer(value) {
    return value !== null && typeof value === 'object';
  }

  function containerTag(value) {
    return Array.isArray(value) ? `数组 ${value.length} 项` : `对象 ${Object.keys(value).length} 项`;
  }

  function typeDesc(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '数组';
    if (typeof value === 'object') return '对象';
    return primitiveKind(value) === 'string' ? '文本' : primitiveKind(value);
  }

  // 同级键的并集，顺序按“先左后右、保持各自原有顺序”排，数组按下标对齐
  function unionKeys(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      const length = Math.max(
        Array.isArray(left) ? left.length : 0,
        Array.isArray(right) ? right.length : 0
      );
      return Array.from({ length }, (_, index) => ({
        key: index,
        label: `[${index}]`,
        byArray: true,
      }));
    }
    const ordered = [];
    const seen = new Set();
    Object.keys(left || {}).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push({ key, label: key, byArray: false });
      }
    });
    Object.keys(right || {}).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push({ key, label: key, byArray: false });
      }
    });
    return ordered;
  }

  function joinPath(parent, segment, byArray) {
    if (!parent) return byArray ? segment : segment;
    return byArray ? `${parent}${segment}` : `${parent}.${segment}`;
  }

  // 把两边内容压成同一组对齐行：每个层级产出左右两个格，差异类型记在行上
  function buildAlignedRows(left, right, label, path, depth, rows, budget) {
    if (budget.left <= 0) return;
    if (isContainer(left) && isContainer(right)) {
      if (Array.isArray(left) !== Array.isArray(right)) {
        rows.push({
          depth, label, path, status: 'mismatch',
          note: `这一层左侧是${Array.isArray(left) ? '数组' : '对象'}，右侧却是${
            Array.isArray(right) ? '数组' : '对象'
          }，结构类型不同，从这里往下不再强行逐层对齐，两边各自展开在下方。`,
          leftRaw: left,
          rightRaw: right,
        });
        budget.left -= 1;
        return;
      }

      rows.push({
        depth, label, path, status: 'container',
        left: { tag: containerTag(left) },
        right: { tag: containerTag(right) },
      });
      budget.left -= 1;

      unionKeys(left, right).forEach(({ key, label: childLabel, byArray }) => {
        if (budget.left <= 0) return;
        const childPath = joinPath(path, childLabel, byArray);
        const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
        const hasRight = Object.prototype.hasOwnProperty.call(right, key);
        if (hasLeft && hasRight) {
          buildAlignedRows(left[key], right[key], childLabel, childPath, depth + 1, rows, budget);
        } else if (hasLeft) {
          walkOneSide(left[key], childLabel, childPath, depth + 1, 'left', rows, budget);
        } else {
          walkOneSide(right[key], childLabel, childPath, depth + 1, 'right', rows, budget);
        }
      });
      return;
    }

    if (isContainer(left) !== isContainer(right)) {
      rows.push({
        depth, label, path, status: 'mismatch',
        note: `这一层左侧是${typeDesc(left)}、右侧是${typeDesc(right)}，一边是容器、一边是普通取值，无法逐层对齐，两边各自展开在下方。`,
        leftRaw: left,
        rightRaw: right,
      });
      budget.left -= 1;
      return;
    }

    // 两边都是普通取值
    const changed = !samePrimitive(left, right);
    rows.push({
      depth, label, path,
      status: changed ? 'change' : 'equal',
      left: { text: describePrimitive(left), kind: primitiveKind(left) },
      right: { text: describePrimitive(right), kind: primitiveKind(right) },
    });
    budget.left -= 1;
  }

  function samePrimitive(left, right) {
    if (typeof left === 'number' && typeof right === 'number') return Object.is(left, right);
    return left === right;
  }

  // 字段只在一侧存在时，把这一侧的整棵子树铺开，另一侧整列留空并标记新增/删除
  function walkOneSide(value, label, path, depth, side, rows, budget) {
    if (budget.left <= 0) return;
    const status = side === 'left' ? 'del' : 'add';
    if (isContainer(value)) {
      rows.push({ depth, label, path, status, [side]: { tag: containerTag(value) } });
      budget.left -= 1;
      const entries = Array.isArray(value)
        ? value.map((child, index) => ({ key: index, label: `[${index}]`, byArray: true }))
        : Object.keys(value).map((key) => ({ key, label: key, byArray: false }));
      entries.forEach(({ key, label: childLabel, byArray }) => {
        if (budget.left <= 0) return;
        walkOneSide(value[key], childLabel, joinPath(path, childLabel, byArray), depth + 1, side, rows, budget);
      });
      return;
    }
    rows.push({
      depth, label, path, status,
      [side]: { text: describePrimitive(value), kind: primitiveKind(value) },
    });
    budget.left -= 1;
  }

  // ---------------- 逐层对比的渲染 ----------------

  function buildAlignedGrid(rows) {
    const grid = document.createElement('div');
    grid.className = 'diff-grid';
    rows.forEach((row) => {
      if (row.status === 'mismatch') {
        grid.appendChild(buildMismatchRow(row));
        return;
      }
      grid.appendChild(buildAlignedRow(row));
    });
    return grid;
  }

  function buildAlignedRow(row) {
    const element = document.createElement('div');
    element.className = `diff-row diff-${row.status}`;

    const leftCell = document.createElement('div');
    leftCell.className = 'diff-cell diff-cell-left';
    leftCell.style.paddingLeft = `${8 + row.depth * 14}px`;
    if (row.left) leftCell.appendChild(buildAlignedCell(row.label, row.left, 'left', row.status));

    const mid = document.createElement('div');
    mid.className = 'diff-mid';
    if (['add', 'del', 'change'].includes(row.status)) {
      const marker = document.createElement('span');
      marker.className = `diff-marker marker-${row.status}`;
      marker.textContent = STATUS_MARK[row.status];
      mid.appendChild(marker);
      const pathNode = document.createElement('span');
      pathNode.className = 'diff-path';
      pathNode.textContent = row.path || '整体内容';
      mid.appendChild(pathNode);
    }

    const rightCell = document.createElement('div');
    rightCell.className = 'diff-cell diff-cell-right';
    rightCell.style.paddingLeft = `${8 + row.depth * 14}px`;
    if (row.right) rightCell.appendChild(buildAlignedCell(row.label, row.right, 'right', row.status));

    element.append(leftCell, mid, rightCell);
    return element;
  }

  function buildAlignedCell(label, data, side, status) {
    const cell = document.createElement('div');
    cell.className = `diff-cell-inner cell-${status}`;
    if (label) {
      const keyNode = document.createElement('span');
      keyNode.className = 'json-key diff-cell-key';
      keyNode.textContent = label;
      cell.appendChild(keyNode);
    }
    if (data.tag) {
      cell.appendChild(buildJsonTag(data.tag));
    } else {
      const valueNode = document.createElement('span');
      valueNode.className = `json-value json-${data.kind || 'string'} diff-cell-value`;
      valueNode.textContent = data.text;
      cell.appendChild(valueNode);
    }
    return cell;
  }

  function buildCellContent(label, text, side, status, envelope) {
    const cell = document.createElement('div');
    cell.className = `diff-cell-inner cell-${status}`;
    if (label) {
      const keyNode = document.createElement('span');
      keyNode.className = envelope ? 'envelope-key' : 'json-key diff-cell-key';
      keyNode.textContent = label;
      cell.appendChild(keyNode);
    }
    const valueNode = document.createElement('span');
    valueNode.className = envelope ? 'envelope-value' : 'json-value diff-cell-value';
    valueNode.textContent = text;
    cell.appendChild(valueNode);
    return cell;
  }

  // 类型对不上时整行跨两列：先讲清楚原因，再把两边各自的完整结构独立铺开
  function buildMismatchRow(row) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-row diff-mismatch-row';
    wrapper.style.paddingLeft = `${8 + row.depth * 14}px`;

    const headLine = document.createElement('div');
    headLine.className = 'mismatch-head';
    const pathNode = document.createElement('span');
    pathNode.className = 'diff-path mismatch-path';
    pathNode.textContent = `路径：${row.path || '整体内容'}`;
    const reasonNode = document.createElement('span');
    reasonNode.className = 'mismatch-reason';
    reasonNode.textContent = row.note;
    headLine.append(pathNode, reasonNode);
    wrapper.appendChild(headLine);

    const sides = document.createElement('div');
    sides.className = 'diff-standalone';
    sides.appendChild(buildRawValuePanel('左侧结构', row.leftRaw));
    sides.appendChild(buildRawValuePanel('右侧结构', row.rightRaw));
    wrapper.appendChild(sides);
    return wrapper;
  }

  function buildRawValuePanel(title, value) {
    const panel = document.createElement('div');
    panel.className = 'diff-standalone-panel';
    const head = document.createElement('p');
    head.className = 'diff-standalone-title';
    head.textContent = `${title}（${typeDesc(value)}）`;
    panel.appendChild(head);
    if (isContainer(value)) {
      panel.appendChild(buildJsonTree(value, '', { left: TREE_LIMIT }));
    } else {
      const pre = document.createElement('pre');
      pre.className = 'result-pre';
      pre.textContent = describePrimitive(value);
      panel.appendChild(pre);
    }
    return panel;
  }

  // ---------------- 结果区小零件 ----------------

  function buildSection(title) {
    const section = document.createElement('div');
    section.className = 'result-section';
    const head = document.createElement('p');
    head.className = 'result-section-title';
    head.textContent = title;
    section.appendChild(head);
    return section;
  }

  function buildStatusBadge(code, statusText) {
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    if (!code) {
      badge.classList.add('status-bad');
    } else if (code >= 500) {
      badge.classList.add('status-bad');
    } else if (code >= 400) {
      badge.classList.add('status-warn');
    } else if (code >= 300) {
      badge.classList.add('status-info');
    } else {
      badge.classList.add('status-ok');
    }
    badge.textContent = code ? `${code} ${statusText}`.trim() : statusText;
    return badge;
  }

  function buildChip(text, extraClass) {
    const chip = document.createElement('span');
    chip.className = extraClass ? `chip ${extraClass}` : 'chip';
    chip.textContent = text;
    return chip;
  }

  function buildTab(text, active, onClick) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = active ? 'view-tab active' : 'view-tab';
    tab.textContent = text;
    tab.addEventListener('click', onClick);
    return tab;
  }

  function buildHeaderTable(headers) {
    const list = document.createElement('div');
    list.className = 'header-table';
    headers.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'header-line';
      const keyNode = document.createElement('span');
      keyNode.className = 'header-line-key';
      keyNode.textContent = row.key;
      const valueNode = document.createElement('span');
      valueNode.className = 'header-line-value';
      valueNode.textContent = row.value;
      line.append(keyNode, valueNode);
      list.appendChild(line);
    });
    return list;
  }

  // ---------------- 工具函数 ----------------

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    const pad = (num) => String(num).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }

  function formatDuration(ms) {
    const value = Number(ms) || 0;
    if (value >= 1000) return `${(value / 1000).toFixed(2)} 秒`;
    return `${value} 毫秒`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} 字节`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  async function checkHealth() {
    try {
      await request('/api/health');
      dom.health.textContent = '服务已连接';
      dom.health.classList.add('ok');
    } catch (err) {
      dom.health.textContent = '服务未连接';
      dom.health.classList.add('bad');
    }
  }

  // ---------------- 事件绑定与入口 ----------------

  function bindEvents() {
    dom.headerRows.addEventListener('input', (event) => {
      const target = event.target;
      const index = Number(target.dataset ? target.dataset.index : NaN);
      const part = target.dataset ? target.dataset.part : '';
      if (!Number.isInteger(index) || !state.headers[index] || !part) return;
      state.headers[index][part] = target.value;
      const slot = document.querySelector('[data-error="headers"]');
      if (slot) slot.hidden = true;
      dom.headerRows.classList.remove('invalid');
    });

    dom.headerRows.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="remove-header"]');
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || !state.headers[index]) return;
      state.headers.splice(index, 1);
      renderHeaderRows();
    });

    dom.addHeader.addEventListener('click', () => {
      state.headers.push({ key: '', value: '' });
      renderHeaderRows();
      const inputs = dom.headerRows.querySelectorAll('input');
      const last = inputs[inputs.length - 2];
      if (last) last.focus();
    });

    dom.sendRequest.addEventListener('click', sendRequest);
    dom.saveCase.addEventListener('click', saveCase);

    dom.resetDraft.addEventListener('click', () => {
      if (state.busy) return;
      resetDraft(false);
    });

    dom.clearResult.addEventListener('click', () => {
      state.result = null;
      state.resultRequest = null;
      state.resultSourceCaseId = '';
      renderEmptyResult();
      showNotice('结果区已清空', 'info');
    });

    dom.saveSnapshot.addEventListener('click', saveSnapshot);
    dom.snapshotName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveSnapshot();
      }
    });
    dom.snapshotName.addEventListener('input', () => {
      const slot = document.querySelector('[data-error="snapshotName"]');
      if (slot) {
        slot.hidden = true;
        slot.textContent = '';
      }
      dom.snapshotName.classList.remove('invalid');
    });

    dom.refreshSnapshots.addEventListener('click', async () => {
      if (state.busy) return;
      try {
        await loadSnapshots();
        showNotice('快照列表已刷新', 'info');
      } catch (err) {
        showNotice(err.message, 'error');
      }
    });

    dom.selectLeft.addEventListener('change', () => {
      const value = dom.selectLeft.value;
      if (value && value === state.compareRight) {
        showNotice('左右两侧需要选择两份不同的快照', 'error');
        dom.selectLeft.value = state.compareLeft;
        return;
      }
      state.compareLeft = value;
      renderSnapshotList();
      renderDiff();
    });
    dom.selectRight.addEventListener('change', () => {
      const value = dom.selectRight.value;
      if (value && value === state.compareLeft) {
        showNotice('左右两侧需要选择两份不同的快照', 'error');
        dom.selectRight.value = state.compareRight;
        return;
      }
      state.compareRight = value;
      renderSnapshotList();
      renderDiff();
    });

    dom.refreshCases.addEventListener('click', async () => {
      if (state.busy) return;
      try {
        await loadCases();
        showNotice('用例列表已刷新', 'info');
      } catch (err) {
        showNotice(err.message, 'error');
      }
    });

    dom.closeDetail.addEventListener('click', () => {
      state.selectedId = '';
      renderCases();
      renderEmptyDetail();
    });
  }

  async function init() {
    bindEvents();
    renderHeaderRows();
    renderEmptyDetail();
    renderEmptyResult();
    renderCases();
    renderSnapshotList();
    syncSnapshotPickers();
    renderDiff();
    await checkHealth();
    await loadDemos();
    try {
      await loadCases();
    } catch (err) {
      showNotice(err.message, 'error');
    }
    try {
      await loadSnapshots();
    } catch (err) {
      showNotice(err.message, 'error');
    }
  }

  init();
})();
