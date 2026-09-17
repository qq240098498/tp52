(function () {
  'use strict';

  // 页面状态：用例列表、内置示例接口、请求头草稿行、最近一次响应结果与结果视图、快照列表与对比选择
  const state = {
    cases: [],
    selectedId: '',
    headers: [{ key: '', value: '' }],
    demos: [],
    busy: false,
    result: null,
    resultView: 'structured',
    // 最近一次发送对应的来源用例与请求目标，随快照一起留档
    resultSource: null,
    snapshots: [],
    leftSnapshotId: '',
    rightSnapshotId: '',
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
    snapshotSave: document.getElementById('snapshot-save'),
    snapshotName: document.getElementById('field-snapshot-name'),
    saveSnapshot: document.getElementById('save-snapshot'),
    snapshotSourceHint: document.getElementById('snapshot-source-hint'),
    caseList: document.getElementById('case-list'),
    caseSummary: document.getElementById('case-summary'),
    refreshCases: document.getElementById('refresh-cases'),
    caseDetail: document.getElementById('case-detail'),
    closeDetail: document.getElementById('close-detail'),
    snapshotList: document.getElementById('snapshot-list'),
    snapshotSummary: document.getElementById('snapshot-summary'),
    refreshSnapshots: document.getElementById('refresh-snapshots'),
    comparePanel: document.getElementById('compare-panel'),
    compareMeta: document.getElementById('compare-meta'),
    compareWarning: document.getElementById('compare-warning'),
    compareViews: document.getElementById('compare-views'),
    closeCompare: document.getElementById('close-compare'),
  };

  const emptyDetailHint = '在用例列表点「详情」，这里显示该用例保存下来的目标地址、请求头与请求内容。';
  // 结构化视图最多铺开的层级条目数量，避免内容过大时页面卡顿
  const TREE_LIMIT = 800;
  // 对比视图最多渲染的对齐行数，超过的部分提示去看原始内容
  const COMPARE_ROW_LIMIT = 2000;
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
    dom.saveSnapshot.textContent = busy && activeAction === 'snapshot' ? '正在留存…' : '存为快照';
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
    [dom.name, dom.url, dom.body, dom.headerRows, dom.snapshotName].forEach((node) => node.classList.remove('invalid'));
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
    try {
      const result = await request('/api/send', { method: 'POST', body: draft });
      state.result = result;
      // 记录这次响应的来源：回填了哪个用例、用什么请求方式与地址发出去的
      const sourceCase = state.cases.find((item) => item.id === state.selectedId);
      state.resultSource = {
        caseId: sourceCase ? sourceCase.id : '',
        caseName: sourceCase ? sourceCase.name : '',
        method: draft.method,
        url: draft.url,
      };
      renderResult(result);
      prepareSnapshotBox(sourceCase);
      if (result.ok) {
        showNotice(`请求已完成：状态码 ${result.status}，耗时 ${formatDuration(result.timeMs)}`, 'success');
      } else {
        showNotice(`请求失败：${result.failure.reason}`, 'error');
      }
    } catch (err) {
      state.result = null;
      state.resultSource = null;
      if (err.field) showFieldError(err.field, err.message);
      dom.resultSummary.textContent = '';
      dom.resultBody.textContent = '';
      dom.clearResult.hidden = false;
      dom.snapshotSave.hidden = true;
      dom.resultBody.appendChild(buildFailurePanel('这次请求没有发出去', err.message, ''));
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderResultPending(draft) {
    dom.resultSummary.textContent = '正在等待响应';
    dom.clearResult.hidden = true;
    dom.snapshotSave.hidden = true;
    dom.resultBody.textContent = '';

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
    dom.snapshotSave.hidden = true;
    dom.resultBody.textContent = '';
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
      // 收到完整响应才允许留存，网络层失败的结果不留快照
      dom.snapshotSave.hidden = false;
    } else {
      head.appendChild(buildStatusBadge(0, '未完成'));
      head.appendChild(buildChip(`已等待 ${formatDuration(result.timeMs)}`));
      dom.resultSummary.textContent = '最近一次：请求未完成';
      dom.snapshotSave.hidden = true;
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

  // 每次收到新响应后布置留存入口：默认带上来源用例名，手工发送则留空由用户填写
  function prepareSnapshotBox(sourceCase) {
    const slot = document.querySelector('[data-error="snapshotName"]');
    if (slot) {
      slot.hidden = true;
      slot.textContent = '';
    }
    dom.snapshotName.classList.remove('invalid');
    dom.snapshotName.value = sourceCase ? sourceCase.name : '';
    dom.snapshotSourceHint.textContent = sourceCase
      ? `来源用例：${sourceCase.name}`
      : '本次为手工发送，未关联用例';
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

  // ---------------- 响应留存 ----------------

  async function saveSnapshot() {
    if (state.busy) return;
    if (!state.result || !state.result.ok) {
      showNotice('请先成功发送一次请求，再把响应留存为快照', 'error');
      return;
    }

    const snapshotName = dom.snapshotName.value.trim();
    if (!snapshotName) {
      showFieldError('snapshotName', '请填写快照名称，名称为空时不能留存');
      showNotice('快照名称为空，已拒绝留存', 'error');
      dom.snapshotName.focus();
      return;
    }

    const source = state.resultSource || { caseId: '', caseName: '', method: '', url: '' };
    setBusy(true, 'snapshot');
    try {
      const created = await request('/api/snapshots', {
        method: 'POST',
        body: {
          name: snapshotName,
          sourceCaseId: source.caseId,
          sourceCaseName: source.caseName,
          sourceMethod: source.method,
          sourceUrl: source.url,
          response: state.result,
        },
      });
      dom.snapshotName.value = '';
      await loadSnapshots();
      // 新留存的快照默认放在左侧，方便立刻选另一份做对比
      state.leftSnapshotId = created.id;
      state.rightSnapshotId = '';
      renderSnapshots();
      showNotice(`响应已留存为快照「${created.name}」，可在快照对比区再选一份进行对比`, 'success');
    } catch (err) {
      if (err.field) showFieldError(err.field, err.message);
      showNotice(err.message, 'error');
      if (err.field === 'snapshotName') dom.snapshotName.focus();
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 快照列表与删除 ----------------

  async function loadSnapshots() {
    const list = await request('/api/snapshots');
    state.snapshots = Array.isArray(list) ? list : [];
    pruneSnapshotSelection();
    renderSnapshots();
  }

  // 被删除的快照不能再参与对比，左右选择槽位遇到缺失立即清空
  function pruneSnapshotSelection() {
    if (state.leftSnapshotId && !state.snapshots.some((item) => item.id === state.leftSnapshotId)) {
      state.leftSnapshotId = '';
    }
    if (state.rightSnapshotId && !state.snapshots.some((item) => item.id === state.rightSnapshotId)) {
      state.rightSnapshotId = '';
    }
  }

  function renderSnapshots() {
    dom.snapshotSummary.textContent = `共 ${state.snapshots.length} 份`;
    dom.snapshotList.textContent = '';

    if (!state.snapshots.length) {
      dom.snapshotList.appendChild(
        buildEmptyBlock('还没有留存过快照', '先发送一次请求，在响应结果下方填好名称点「存为快照」，快照会出现在这里。')
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
    if (item.id === state.leftSnapshotId || item.id === state.rightSnapshotId) row.classList.add('active');

    const main = document.createElement('div');
    main.className = 'snapshot-main';

    const title = document.createElement('div');
    title.className = 'snapshot-title';
    const nameNode = document.createElement('span');
    nameNode.className = 'snapshot-name';
    nameNode.textContent = item.name;
    title.append(nameNode, buildStatusBadge(item.response.status, item.response.statusText));
    if (item.sourceCaseName) title.appendChild(buildTag('来源用例', 'inner'));

    const urlNode = document.createElement('p');
    urlNode.className = 'snapshot-url';
    urlNode.textContent = item.sourceUrl || item.response.targetUrl;

    const metaNode = document.createElement('p');
    metaNode.className = 'snapshot-meta';
    const sourceText = item.sourceCaseName
      ? `来源用例：${item.sourceCaseName}`
      : '来源：手工发送（未关联用例）';
    metaNode.textContent = `留存于 ${formatTime(item.savedAt)} · ${sourceText}`;

    main.append(title, urlNode, metaNode);

    const actions = document.createElement('div');
    actions.className = 'snapshot-actions';

    const leftButton = document.createElement('button');
    leftButton.type = 'button';
    leftButton.className = item.id === state.leftSnapshotId
      ? 'btn btn-small btn-pick active'
      : 'btn btn-small btn-pick';
    leftButton.textContent = item.id === state.leftSnapshotId ? '✓ 左侧' : '作为左侧';
    leftButton.dataset.action = 'pick-left';
    leftButton.dataset.id = item.id;

    const rightButton = document.createElement('button');
    rightButton.type = 'button';
    rightButton.className = item.id === state.rightSnapshotId
      ? 'btn btn-small btn-pick active'
      : 'btn btn-small btn-pick';
    rightButton.textContent = item.id === state.rightSnapshotId ? '✓ 右侧' : '作为右侧';
    rightButton.dataset.action = 'pick-right';
    rightButton.dataset.id = item.id;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-small btn-danger';
    deleteButton.textContent = '删除';
    deleteButton.dataset.action = 'delete-snapshot';
    deleteButton.dataset.id = item.id;

    actions.append(leftButton, rightButton, deleteButton);
    row.append(main, actions);
    return row;
  }

  function pickSnapshot(id, side) {
    const current = side === 'left' ? state.leftSnapshotId : state.rightSnapshotId;
    const oppositeSide = side === 'left' ? 'right' : 'left';
    const opposite = oppositeSide === 'left' ? state.leftSnapshotId : state.rightSnapshotId;

    // 再点一次同一个槽位表示取消选择
    if (current === id) {
      if (side === 'left') state.leftSnapshotId = '';
      else state.rightSnapshotId = '';
      hideComparePanel();
      renderSnapshots();
      return;
    }
    // 同一份快照不能同时占左右两边，对比必须是两份不同的快照
    if (opposite === id) {
      showNotice('请选择两份不同的快照进行对比', 'error');
      return;
    }
    if (side === 'left') state.leftSnapshotId = id;
    else state.rightSnapshotId = id;

    renderSnapshots();
    if (state.leftSnapshotId && state.rightSnapshotId) {
      openCompare();
    } else {
      hideComparePanel();
      showNotice(side === 'left' ? '已选为左侧快照，再选一份作为右侧' : '已选为右侧快照，再选一份作为左侧', 'info');
    }
  }

  async function removeSnapshot(item) {
    if (state.busy) return;
    const confirmed = window.confirm(`确认删除快照「${item.name}」？删除后无法恢复，也不能再参与对比。`);
    if (!confirmed) return;

    setBusy(true, 'snapshot');
    try {
      await request(`/api/snapshots/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const involved = item.id === state.leftSnapshotId || item.id === state.rightSnapshotId;
      if (item.id === state.leftSnapshotId) state.leftSnapshotId = '';
      if (item.id === state.rightSnapshotId) state.rightSnapshotId = '';
      await loadSnapshots();
      if (involved || !state.leftSnapshotId || !state.rightSnapshotId) hideComparePanel();
      showNotice(`快照「${item.name}」已删除，不再参与对比`, 'success');
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 快照逐层对比 ----------------

  function openCompare() {
    const left = state.snapshots.find((item) => item.id === state.leftSnapshotId);
    const right = state.snapshots.find((item) => item.id === state.rightSnapshotId);
    if (!left || !right) {
      hideComparePanel();
      return;
    }
    renderCompareMeta(left, right);
    renderCompareBody(left, right);
    dom.comparePanel.hidden = false;
    dom.comparePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideComparePanel() {
    dom.comparePanel.hidden = true;
    dom.compareMeta.textContent = '';
    dom.compareWarning.textContent = '';
    dom.compareWarning.hidden = true;
    dom.compareViews.textContent = '';
  }

  function renderCompareMeta(left, right) {
    dom.compareMeta.textContent = '';
    const grid = document.createElement('div');
    grid.className = 'compare-meta-grid';
    grid.appendChild(buildCompareMetaCard(left, 'compare-side-left'));
    const spacer = document.createElement('div');
    spacer.className = 'compare-meta-spacer';
    grid.appendChild(spacer);
    grid.appendChild(buildCompareMetaCard(right, 'compare-side-right'));
    dom.compareMeta.appendChild(grid);
  }

  function buildCompareMetaCard(snapshot, extraClass) {
    const card = document.createElement('div');
    card.className = `compare-meta-card ${extraClass || ''}`;

    const title = document.createElement('div');
    title.className = 'snapshot-title';
    const nameNode = document.createElement('span');
    nameNode.className = 'snapshot-name';
    nameNode.textContent = snapshot.name;
    title.append(nameNode, buildStatusBadge(snapshot.response.status, snapshot.response.statusText));
    card.appendChild(title);

    const lines = [
      `留存于 ${formatTime(snapshot.savedAt)}`,
      snapshot.sourceCaseName ? `来源用例：${snapshot.sourceCaseName}` : '来源：手工发送（未关联用例）',
      `请求方式：${snapshot.sourceMethod || '未知'}`,
      `目标地址：${snapshot.sourceUrl || snapshot.response.targetUrl}`,
    ];
    lines.forEach((text) => {
      const line = document.createElement('p');
      line.className = 'compare-meta-line';
      line.textContent = text;
      card.appendChild(line);
    });
    return card;
  }

  function bodyKindInfo(snapshot) {
    const text = typeof snapshot.response.body === 'string' ? snapshot.response.body : '';
    if (!text.trim()) return { text, parsed: null, empty: true, rootName: '空内容' };
    const parsed = tryParseJson(text);
    if (parsed.ok) return { text, parsed, empty: false, rootName: rootTypeName(parsed.value) };
    return { text, parsed: null, empty: false, rootName: '非 JSON 文本' };
  }

  function rootTypeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '数组';
    if (typeof value === 'object') return '对象';
    if (typeof value === 'string') return '字符串';
    if (typeof value === 'number') return '数字';
    if (typeof value === 'boolean') return '布尔值';
    return '未知类型';
  }

  function renderCompareBody(left, right) {
    dom.compareWarning.textContent = '';
    dom.compareWarning.hidden = true;
    dom.compareViews.textContent = '';

    const leftInfo = bodyKindInfo(left);
    const rightInfo = bodyKindInfo(right);
    const leftStructured = leftInfo.parsed && leftInfo.parsed.ok;
    const rightStructured = rightInfo.parsed && rightInfo.parsed.ok;
    const rootsCompatible = leftStructured
      && rightStructured
      && Array.isArray(leftInfo.parsed.value) === Array.isArray(rightInfo.parsed.value)
      && isSamePrimitiveKind(leftInfo.parsed.value, rightInfo.parsed.value);

    if (!leftStructured || !rightStructured || !rootsCompatible) {
      // 根层级就无法对齐：明确说明原因，两边各自独立展示，绝不硬拼
      showCompareWarning(buildIncompatibleReason(leftInfo, rightInfo, !rootsCompatible));
      dom.compareViews.appendChild(buildIndependentViews(left, leftInfo, right, rightInfo));
      return;
    }

    const aligned = alignTrees(leftInfo.parsed.value, rightInfo.parsed.value);
    if (aligned.stats.incompatible > 0) {
      showCompareWarning(
        `两边有 ${aligned.stats.incompatible} 个层级的取值类型不同（例如一边是对象、另一边是普通值），这些层级无法继续逐层对齐，已在对应位置单独标出并各自完整展示。`
      );
    }
    dom.compareViews.appendChild(buildLegend(aligned.stats));
    dom.compareViews.appendChild(buildAlignedGrid(aligned.rows));
  }

  // 两边根层级无法对齐时，把不成立的点逐条讲清楚
  function buildIncompatibleReason(leftInfo, rightInfo, rootMismatch) {
    if (leftInfo.empty || rightInfo.empty) {
      const leftPart = leftInfo.empty ? '响应内容为空' : `是结构化数据（根节点为${leftInfo.rootName}）`;
      const rightPart = rightInfo.empty ? '响应内容为空' : `是结构化数据（根节点为${rightInfo.rootName}）`;
      return `两边结构差异过大，无法逐层对齐：左侧快照${leftPart}，右侧快照${rightPart}。以下左右各自独立展示，不做拼接。`;
    }
    if (!leftInfo.parsed || !rightInfo.parsed) {
      const leftPart = leftInfo.parsed ? `是结构化数据（根节点为${leftInfo.rootName}）` : '不是 JSON，无法按层级解析';
      const rightPart = rightInfo.parsed ? `是结构化数据（根节点为${rightInfo.rootName}）` : '不是 JSON，无法按层级解析';
      return `两边响应内容无法逐层对齐：左侧快照${leftPart}，右侧快照${rightPart}。以下左右各自按原文独立展示，不做拼接。`;
    }
    if (rootMismatch) {
      return `两边结构差异过大，无法逐层对齐：左侧根节点是${leftInfo.rootName}，右侧根节点是${rightInfo.rootName}，根节点类型不同，层级没有办法一一对应。以下左右各自完整展示，不做拼接。`;
    }
    return '两边响应内容无法逐层对齐，以下左右各自独立展示。';
  }

  function isSamePrimitiveKind(a, b) {
    const ka = a === null ? 'null' : typeof a;
    const kb = b === null ? 'null' : typeof b;
    return ka === kb;
  }

  function showCompareWarning(text) {
    dom.compareWarning.textContent = text;
    dom.compareWarning.hidden = false;
  }

  function buildIndependentViews(left, leftInfo, right, rightInfo) {
    const grid = document.createElement('div');
    grid.className = 'compare-grid compare-grid-plain';
    grid.appendChild(buildIndependentColumn(left, leftInfo));
    const arrow = document.createElement('div');
    arrow.className = 'compare-arrow-cell';
    grid.appendChild(arrow);
    grid.appendChild(buildIndependentColumn(right, rightInfo));
    return grid;
  }

  function buildIndependentColumn(snapshot, info) {
    const col = document.createElement('div');
    col.className = 'compare-column';
    if (info.empty) {
      col.appendChild(buildTextNote('本次响应没有返回内容'));
      return col;
    }
    if (info.parsed && info.parsed.ok) {
      col.appendChild(buildJsonTree(info.parsed.value, '响应内容', { left: TREE_LIMIT }));
    } else {
      col.appendChild(buildTextNote(`响应内容不是结构化数据（${info.rootName}），按原始文本展示`));
      col.appendChild(buildPre(info.text));
    }
    return col;
  }

  function buildLegend(stats) {
    const legend = document.createElement('div');
    legend.className = 'compare-legend';

    const items = [
      ['legend-added', '新增'],
      ['legend-removed', '删除'],
      ['legend-changed', '取值改动'],
      ['legend-incompat', '该层级类型不同'],
    ];
    items.forEach(([className, text]) => {
      const chip = document.createElement('span');
      chip.className = `legend-chip ${className}`;
      chip.textContent = text;
      legend.appendChild(chip);
    });

    const summary = document.createElement('span');
    summary.className = 'compare-stat';
    const parts = [];
    if (stats.added) parts.push(`新增 ${stats.added} 处`);
    if (stats.removed) parts.push(`删除 ${stats.removed} 处`);
    if (stats.changed) parts.push(`改动 ${stats.changed} 处`);
    if (stats.incompatible) parts.push(`${stats.incompatible} 处无法继续对齐`);
    summary.textContent = parts.length ? `本次对比：${parts.join(' · ')}` : '两边响应内容完全一致';
    legend.appendChild(summary);
    return legend;
  }

  // 把两棵 JSON 树按相同的键与下标对齐，产出逐行的差异清单
  function alignTrees(leftRoot, rightRoot) {
    const rows = [];
    const stats = { added: 0, removed: 0, changed: 0, incompatible: 0 };
    const ROOT_LABEL = '响应内容';

    function isContainer(value) {
      return value !== null && typeof value === 'object';
    }

    function childPath(path, key, isArrayKey) {
      if (path === ROOT_LABEL) return isArrayKey ? `${ROOT_LABEL}[${key}]` : String(key);
      return isArrayKey ? `${path}[${key}]` : `${path}.${key}`;
    }

    // 只有一边存在的子树：整棵标成新增或删除，逐行铺开方便定位层级；统计只算一处
    function emitOneSide(value, path, depth, side) {
      const change = side === 'left' ? 'removed' : 'added';
      if (isContainer(value)) {
        const isArray = Array.isArray(value);
        const keys = isArray ? value.map((_, index) => index) : Object.keys(value);
        rows.push({
          depth,
          path,
          change,
          left: side === 'left' ? { kind: 'tag', text: `${isArray ? '数组' : '对象'} ${keys.length} 项` } : null,
          right: side === 'right' ? { kind: 'tag', text: `${isArray ? '数组' : '对象'} ${keys.length} 项` } : null,
        });
        keys.forEach((key) => {
          emitOneSide(value[key], childPath(path, key, isArray), depth + 1, side);
        });
        return;
      }
      rows.push({
        depth,
        path,
        change,
        left: side === 'left' ? { kind: 'primitive', value } : null,
        right: side === 'right' ? { kind: 'primitive', value } : null,
      });
    }

    function walk(path, depth, left, right) {
      const leftContainer = isContainer(left);
      const rightContainer = isContainer(right);

      if (leftContainer && rightContainer && Array.isArray(left) === Array.isArray(right)) {
        const isArray = Array.isArray(left);
        const keys = isArray
          ? Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index)
          : unionKeys(Object.keys(left), Object.keys(right));

        const headerIndex = rows.length;
        rows.push({
          depth,
          path,
          change: 'equal',
          left: { kind: 'tag', text: `${isArray ? '数组' : '对象'} ${left.length !== undefined ? left.length : Object.keys(left).length} 项` },
          right: { kind: 'tag', text: `${isArray ? '数组' : '对象'} ${right.length !== undefined ? right.length : Object.keys(right).length} 项` },
        });

        let hasDiff = false;
        keys.forEach((key) => {
          const inLeft = isArray ? key < left.length : Object.prototype.hasOwnProperty.call(left, key);
          const inRight = isArray ? key < right.length : Object.prototype.hasOwnProperty.call(right, key);
          if (inLeft && !inRight) {
            stats.removed += 1;
            emitOneSide(left[key], childPath(path, key, isArray), depth + 1, 'left');
            hasDiff = true;
          } else if (!inLeft && inRight) {
            stats.added += 1;
            emitOneSide(right[key], childPath(path, key, isArray), depth + 1, 'right');
            hasDiff = true;
          } else {
            const before = rows.length;
            walk(childPath(path, key, isArray), depth + 1, left[key], right[key]);
            if (hasDifferenceSince(before)) hasDiff = true;
          }
        });
        if (hasDiff) rows[headerIndex].change = 'nested';
        return;
      }

      if (leftContainer || rightContainer) {
        // 同一层级两边类型不同（对象/数组 对 普通值，或对象对数组），这一层不再硬拼
        stats.incompatible += 1;
        rows.push({
          depth,
          path,
          change: 'incompatible',
          left: { kind: 'tree', value: left, typeName: rootTypeName(left) },
          right: { kind: 'tree', value: right, typeName: rootTypeName(right) },
        });
        return;
      }

      const equal = primitiveEquals(left, right);
      if (!equal) stats.changed += 1;
      rows.push({
        depth,
        path,
        change: equal ? 'equal' : 'changed',
        left: { kind: 'primitive', value: left },
        right: { kind: 'primitive', value: right },
      });
    }

    function hasDifferenceSince(index) {
      for (let i = index; i < rows.length; i += 1) {
        if (rows[i].change !== 'equal') return true;
      }
      return false;
    }

    walk(ROOT_LABEL, 0, leftRoot, rightRoot);
    return { rows, stats };
  }

  function unionKeys(leftKeys, rightKeys) {
    const keys = leftKeys.slice();
    rightKeys.forEach((key) => {
      if (!keys.includes(key)) keys.push(key);
    });
    return keys;
  }

  function primitiveEquals(a, b) {
    if (a === null || b === null) return a === b;
    // NaN 视为相等，避免同一个缺值在两边被误报成改动
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
  }

  function buildAlignedGrid(alignedRows) {
    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    let rendered = 0;
    for (const row of alignedRows) {
      if (rendered >= COMPARE_ROW_LIMIT) {
        const note = document.createElement('div');
        note.className = 'compare-limit-note';
        note.textContent = `差异层级超过 ${COMPARE_ROW_LIMIT} 行，只展示前 ${COMPARE_ROW_LIMIT} 行，其余内容请对照快照的原始文本查看。`;
        grid.appendChild(note);
        break;
      }
      grid.appendChild(buildAlignedRow(row));
      rendered += 1;
    }
    return grid;
  }

  function buildAlignedRow(row) {
    const line = document.createElement('div');
    line.className = `compare-row compare-row-${row.change}`;
    line.appendChild(buildCompareCell(row, 'left'));
    line.appendChild(buildArrowCell(row.change));
    line.appendChild(buildCompareCell(row, 'right'));
    return line;
  }

  function buildCompareCell(row, side) {
    const cell = document.createElement('div');
    cell.className = `compare-cell compare-${side} cell-${row.change}`;
    cell.style.paddingLeft = `${8 + row.depth * 14}px`;

    const descriptor = row[side];
    if (!descriptor) {
      const blank = document.createElement('span');
      blank.className = 'compare-blank';
      blank.textContent = '—';
      cell.appendChild(blank);
      return cell;
    }

    const pathNode = document.createElement('span');
    pathNode.className = 'compare-path';
    pathNode.textContent = row.path;

    if (descriptor.kind === 'primitive') {
      cell.append(pathNode, buildPrimitiveValue(descriptor.value));
    } else if (descriptor.kind === 'tag') {
      cell.append(pathNode, buildJsonTag(descriptor.text));
    } else {
      const note = document.createElement('p');
      note.className = 'compare-cell-note';
      note.textContent = `该层级为${descriptor.typeName}，与另一边类型不同，下面完整列出本侧内容：`;
      cell.append(pathNode, note);
      cell.appendChild(buildJsonTree(descriptor.value, '', { left: TREE_LIMIT }));
    }
    return cell;
  }

  function buildPrimitiveValue(value) {
    const node = document.createElement('span');
    node.className = `json-value json-${primitiveKind(value)}`;
    node.textContent = describePrimitive(value);
    return node;
  }

  function buildArrowCell(change) {
    const cell = document.createElement('div');
    cell.className = 'compare-arrow-cell';
    const mark = { added: '+', removed: '−', changed: '→', incompatible: '≠' }[change];
    if (mark) {
      const arrow = document.createElement('span');
      arrow.className = `compare-arrow compare-arrow-${change}`;
      arrow.textContent = mark;
      cell.appendChild(arrow);
    }
    return cell;
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

  // ---------------- 保存与删除用例 ----------------

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
    dom.saveSnapshot.addEventListener('click', saveSnapshot);

    // 重新输入快照名称时立即清掉名称项上的报错标记
    dom.snapshotName.addEventListener('input', () => {
      const slot = document.querySelector('[data-error="snapshotName"]');
      if (slot) slot.hidden = true;
      dom.snapshotName.classList.remove('invalid');
    });

    dom.resetDraft.addEventListener('click', () => {
      if (state.busy) return;
      resetDraft(false);
    });

    dom.clearResult.addEventListener('click', () => {
      state.result = null;
      state.resultSource = null;
      renderEmptyResult();
      showNotice('结果区已清空', 'info');
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

    dom.refreshSnapshots.addEventListener('click', async () => {
      if (state.busy) return;
      try {
        await loadSnapshots();
        if (state.leftSnapshotId && state.rightSnapshotId) openCompare();
        else hideComparePanel();
        showNotice('快照列表已刷新', 'info');
      } catch (err) {
        showNotice(err.message, 'error');
      }
    });

    // 列表按钮统一用 data-action 分发：选择左右侧、删除
    dom.snapshotList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'pick-left') pickSnapshot(id, 'left');
      else if (button.dataset.action === 'pick-right') pickSnapshot(id, 'right');
      else if (button.dataset.action === 'delete-snapshot') {
        const item = state.snapshots.find((snapshot) => snapshot.id === id);
        if (item) removeSnapshot(item);
      }
    });

    dom.closeCompare.addEventListener('click', () => {
      hideComparePanel();
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
    renderSnapshots();
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
