'use strict';

const state = {
  me: null,
  positions: [],
  draft: null,
  live: null,
  versions: [],
  detail: null,
  editingCueId: null,
  handover: null,
  handoverLoading: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------- API ----------

async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  if (res.status === 401) {
    showLogin();
    throw new Error(data?.message || '未登录');
  }
  if (!res.ok) {
    const err = new Error(data?.message || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

let alertTimer = null;
function alertBar(kind, message, ms = 5000) {
  const bar = $('#alert-bar');
  bar.className = `alert ${kind}`;
  bar.innerHTML = message;
  bar.hidden = false;
  clearTimeout(alertTimer);
  if (ms) alertTimer = setTimeout(() => { bar.hidden = true; }, ms);
}

function errorToHtml(err) {
  const d = err.data || {};
  let html = `<strong>${esc(err.message)}</strong>`;
  if (d.errors?.length) {
    html += '<ul>' + d.errors.map((e) => `<li>[${esc(e.type)}] ${esc(e.message)}</li>`).join('') + '</ul>';
  }
  if (Array.isArray(d.items) && d.items.length) {
    html += '<ul>' + d.items.map((it) => `<li>${esc(it.code || ('引用#' + it.cueRef))}：${esc(it.reason)}</li>`).join('') + '</ul>';
  }
  if (d.currentVersion !== undefined) html += `<div class="muted">请刷新草稿获取最新数据后再提交。</div>`;
  return html;
}

// ---------- 登录 / 启动 ----------

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  const isSM = state.me.role === 'sm';
  const tabs = isSM
    ? [['draft', '草稿编辑'], ['live', '现场联排'], ['versions', '发布版本']]
    : [['live', '现场联排'], ['versions', '发布版本']];
  $('#tabs').innerHTML = tabs.map(([k, label], i) =>
    `<button data-tab="${k}" class="${i === 0 ? 'active' : ''}">${label}</button>`).join('');
  $('#user-tag').innerHTML =
    `<span class="role-tag ${isSM ? 'sm' : ''}">${isSM ? '舞监' : esc(state.me.position) + '执行'}</span>
     ${esc(state.me.displayName)}（${esc(state.me.username)}）`;
  switchTab(isSM ? 'draft' : 'live');
}

function switchTab(tab) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['draft', 'live', 'versions'].forEach((t) => { $('#tab-' + t).hidden = t !== tab; });
  if (tab === 'draft') loadDraft().catch((e) => alertBar('error', errorToHtml(e)));
  if (tab === 'live') loadLive().catch((e) => alertBar('error', errorToHtml(e)));
  if (tab === 'versions') loadVersions().catch((e) => alertBar('error', errorToHtml(e)));
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#login-error').hidden = true;
  const fd = new FormData(ev.target);
  try {
    const { user } = await api('POST', '/api/login', {
      username: fd.get('username'), password: fd.get('password'),
    });
    state.me = user;
    showApp();
  } catch (e) {
    const box = $('#login-error');
    box.textContent = e.message;
    box.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  state.me = null;
  showLogin();
});

$('#tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

// ---------- 舞监：草稿 ----------

async function loadDraft() {
  state.draft = await api('GET', '/api/draft');
  state.positions = state.draft.positions;
  renderDraft();
  loadHandover().catch((e) => {
    state.handover = null;
    renderHandover(`<span class="muted">交接预览加载失败：${esc(e.message)}</span>`);
  });
}

async function loadDraftFresh() {
  return api('GET', '/api/draft');
}

// ---------- 舞监：发布前交接预览 ----------

async function loadHandover() {
  state.handoverLoading = true;
  try {
    state.handover = await api('GET', '/api/publish/handover/preview');
    renderHandover();
  } finally {
    state.handoverLoading = false;
  }
}

function handoverRowHtml(it, eligible) {
  const check = eligible
    ? `<input type="checkbox" data-act="pick-handover" data-ref="${it.cueRef}" ${it.selected ? 'checked' : ''} />`
    : '<span class="muted">不可选</span>';
  const reason = eligible ? '' : `<ul class="ho-reasons">${
    (it.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
  return `<tr class="${eligible ? 'ho-eligible' : 'ho-ineligible'}">
    <td>${check}</td>
    <td><strong>${esc(it.code)}</strong></td>
    <td>${esc(it.title || '')}</td>
    <td>${esc(it.position)}</td>
    <td class="mono">${esc(it.actualStartText)} - ${esc(it.actualEndText)}</td>
    <td class="mono">v${it.rowVer}</td>
    <td>${reason || '<span class="muted">编号/说明/岗位/计划开始/时长/前置集合一致，且旧登记已完成</span>'}</td>
  </tr>`;
}

function renderHandover(errorHtml) {
  const box = $('#handover-body');
  if (!box) return;
  if (errorHtml) { box.innerHTML = errorHtml; return; }
  const h = state.handover;
  if (!h) { box.innerHTML = '<span class="muted">加载中…</span>'; return; }
  if (!h.oldVersion) {
    box.innerHTML = '<div class="muted">尚无旧执行版（首次发布），没有可交接的已完成登记。</div>';
    return;
  }
  const stale = h.draftVersion !== state.draft?.version;
  const total = h.eligible.length + h.ineligible.length;
  const head = `
    <div class="ho-meta">
      旧执行版：<strong>第 ${h.oldVersion.versionNo} 版</strong> ${esc(h.oldVersion.note || '')}
      <span class="muted">发布于 ${esc(h.oldVersion.createdAt)}</span>
      ｜预览基于草稿 v${h.draftVersion}${stale ? '<strong class="ho-stale"> · 草稿已变化，请重新预览</strong>' : ''}
      ｜已完成项 ${total} 项，可延续 ${h.eligible.length} 项
    </div>`;
  if (total === 0) {
    box.innerHTML = head + '<div class="muted">旧执行版中没有同时具备实际开始与实际完成的提示项，无可交接登记。</div>';
    return;
  }
  const eligibleRows = h.eligible.map((it) => handoverRowHtml(it, true)).join('');
  const ineligibleRows = h.ineligible.map((it) => handoverRowHtml(it, false)).join('');
  const allSelected = h.eligible.length > 0 && h.eligible.every((it) => it.selected);
  box.innerHTML = `${head}
    <div class="table-wrap ho-table-wrap">
      <table>
        <thead><tr>
          <th><input type="checkbox" id="ho-select-all" title="全选/全不选可延续项" ${allSelected ? 'checked' : ''} /></th>
          <th>编号</th><th>说明</th><th>岗位</th><th>旧版实际开始-完成</th><th>行版本</th><th>交接资格 / 不合格原因</th>
        </tr></thead>
        <tbody>${eligibleRows}${ineligibleRows}</tbody>
      </table>
    </div>
    <div class="muted">勾选的项在发布时仅带入<strong>实际开始、实际完成</strong>（不带预计结束）；未选项保持空登记。延续而来的登记会在新版标明来源版本与提示项，旧版登记与更正历史仍可回看，已发布计划保持冻结。</div>`;
}

function cueLabel(c) {
  return `${c.code}${c.title ? ' ' + c.title : ''}（${c.position} ${c.plannedStartText}）`;
}

function renderValidation(v) {
  const panel = $('#validation-panel');
  if (v.ok) {
    panel.innerHTML = `<div class="val-ok">✅ 计划校验通过：前置顺序、同岗位时段、依赖环检查均无问题，可以发布。</div>`;
  } else {
    panel.innerHTML = `<div class="val-err"><strong>⚠ ${v.errors.length} 项冲突，无法发布：</strong><ul>${
      v.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')
    }</ul></div>`;
  }
}

function renderDraft() {
  const d = state.draft;
  if (!d) return;
  $('#draft-ver').textContent = `（草稿版本号 v${d.version}）`;
  renderValidation(d.validation);

  const posSelect = $('#cue-position-select');
  posSelect.innerHTML = '<option value="">选择岗位</option>' +
    d.positions.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

  const cueOptions = d.cues.map((c) => `<option value="${c.id}">${esc(cueLabel(c))}</option>`).join('');
  $('#dep-from').innerHTML = cueOptions;
  $('#dep-to').innerHTML = cueOptions;

  const cueMap = new Map(d.cues.map((c) => [c.id, c]));
  const predsOf = new Map(d.cues.map((c) => [c.id, []]));
  for (const dep of d.deps) {
    if (predsOf.has(dep.to)) predsOf.get(dep.to).push(dep.from);
  }

  $('#draft-cue-tbody').innerHTML = d.cues.map((c) => {
    const preds = predsOf.get(c.id).map((pid) => esc(cueMap.get(pid)?.code || `#${pid}`)).join('、') || '—';
    const end = c.plannedStart + c.duration;
    return `<tr>
      <td><strong>${esc(c.code)}</strong></td>
      <td>${esc(c.title)}</td>
      <td>${esc(c.position)}</td>
      <td class="mono">${c.plannedStartText}</td>
      <td class="mono">${c.duration} 分</td>
      <td class="mono">${minText(end)}</td>
      <td>${preds}</td>
      <td>
        <button class="ghost tiny" data-act="edit-cue" data-id="${c.id}">编辑</button>
        <button class="ghost tiny" data-act="del-cue" data-id="${c.id}" data-code="${esc(c.code)}">删除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">暂无提示项，请在左侧新增。</td></tr>`;

  $('#dep-list').innerHTML = d.deps.map((dep) => {
    const a = cueMap.get(dep.from), b = cueMap.get(dep.to);
    return `<div class="dep-item">
      <span>${a ? esc(a.code) : '#' + dep.from} → ${b ? esc(b.code) : '#' + dep.to}</span>
      <button class="ghost tiny" data-act="del-dep" data-id="${dep.id}">移除</button>
    </div>`;
  }).join('') || '<div class="muted">暂无前置关系。</div>';

  $('#publish-result').innerHTML = '';
}

function minText(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function resetCueForm() {
  const form = $('#cue-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.rowVersion.value = '';
  $('#cue-form-title').textContent = '新增提示项';
  $('#cue-submit').textContent = '新增';
  $('#cue-cancel').hidden = true;
  state.editingCueId = null;
}

$('#cue-cancel').addEventListener('click', resetCueForm);

$('#cue-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const fd = new FormData(f);
  const payload = {
    version: state.draft.version,
    code: fd.get('code'),
    title: fd.get('title'),
    position: fd.get('position'),
    plannedStartText: fd.get('plannedStartText'),
    duration: Number(fd.get('duration')),
  };
  const id = fd.get('id');
  try {
    if (id) {
      payload.rowVersion = Number(fd.get('rowVersion'));
      state.draft = (await api('PUT', `/api/draft/cues/${id}`, payload));
      alertBar('ok', '提示项已更新，草稿版本号 v' + state.draft.version);
    } else {
      state.draft = await api('POST', '/api/draft/cues', payload);
      alertBar('ok', '提示项已新增，草稿版本号 v' + state.draft.version);
    }
    resetCueForm();
    renderDraft();
  } catch (e) {
    alertBar('error', errorToHtml(e));
    if (e.status === 409) loadDraft().then(renderDraft).catch(() => {});
  }
});

$('#draft-cue-tbody').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'edit-cue') {
    const c = state.draft.cues.find((x) => x.id === Number(btn.dataset.id));
    if (!c) return;
    const f = $('#cue-form');
    f.elements.id.value = c.id;
    f.elements.rowVersion.value = c.rowVersion;
    f.elements.code.value = c.code;
    f.elements.title.value = c.title;
    f.elements.position.value = c.position;
    f.elements.plannedStartText.value = c.plannedStartText;
    f.elements.duration.value = c.duration;
    $('#cue-form-title').textContent = `编辑提示项 ${c.code}`;
    $('#cue-submit').textContent = '保存修改';
    $('#cue-cancel').hidden = false;
    state.editingCueId = c.id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (act === 'del-cue') {
    if (!confirm(`确认删除提示项「${btn.dataset.code}」及其相关前置关系？`)) return;
    try {
      state.draft = await api('DELETE', `/api/draft/cues/${btn.dataset.id}?version=${state.draft.version}`);
      alertBar('ok', '已删除，草稿版本号 v' + state.draft.version);
      if (state.editingCueId === Number(btn.dataset.id)) resetCueForm();
      renderDraft();
    } catch (e) {
      alertBar('error', errorToHtml(e));
      if (e.status === 409) loadDraft().then(renderDraft).catch(() => {});
    }
  }
});

$('#dep-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const from = Number(fd.get('from'));
  const to = Number(fd.get('to'));
  if (from === to) return alertBar('error', '请选择不同的前置与后项提示项');
  try {
    state.draft = await api('POST', '/api/draft/deps', { version: state.draft.version, from, to });
    alertBar('ok', '前置关系已添加，草稿版本号 v' + state.draft.version);
    renderDraft();
  } catch (e) {
    alertBar('error', errorToHtml(e));
    if (e.status === 409) loadDraft().then(renderDraft).catch(() => {});
  }
});

$('#dep-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="del-dep"]');
  if (!btn) return;
  try {
    state.draft = await api('DELETE', `/api/draft/deps/${btn.dataset.id}?version=${state.draft.version}`);
    alertBar('ok', '前置关系已移除，草稿版本号 v' + state.draft.version);
    renderDraft();
  } catch (e) {
    alertBar('error', errorToHtml(e));
    if (e.status === 409) loadDraft().then(renderDraft).catch(() => {});
  }
});

function selectedHandoverItems() {
  return (state.handover?.eligible || []).filter((it) => it.selected)
    .map((it) => ({ cueRef: it.cueRef, rowVersion: it.rowVersion }));
}

$('#handover-reload').addEventListener('click', () =>
  loadHandover().then(() => alertBar('ok', '交接预览已刷新')).catch((e) => alertBar('error', errorToHtml(e))));

$('#handover-box').addEventListener('change', (ev) => {
  const cb = ev.target;
  if (cb.id === 'ho-select-all') {
    const checked = cb.checked;
    for (const it of state.handover?.eligible || []) it.selected = checked;
    $$('#handover-box input[data-act="pick-handover"]').forEach((box) => { box.checked = checked; });
    return;
  }
  if (cb.dataset.act === 'pick-handover') {
    const ref = Number(cb.dataset.ref);
    const it = (state.handover?.eligible || []).find((x) => x.cueRef === ref);
    if (it) it.selected = cb.checked;
  }
});

$('#publish-btn').addEventListener('click', async () => {
  if (!state.draft) return;
  if (!state.draft.validation.ok) {
    alertBar('error', '当前草稿存在冲突项，请先根据上方红色提示修正后再发布。');
    return;
  }
  const payload = {
    version: state.draft.version,
    note: $('#publish-note').value.trim(),
  };
  // 已加载过交接预览：携带 handover（即使无可选项也传，保持校验闭环；加载失败时不传，维持原发布行为）
  if (state.handover && state.handover.oldVersion) {
    if (state.handover.draftVersion !== state.draft.version) {
      alertBar('error', '交接预览基于的草稿版本已过期，请点击「重新预览」后再发布。');
      return;
    }
    payload.handover = {
      oldVersionId: state.handover.oldVersion.id,
      draftVersion: state.handover.draftVersion,
      items: selectedHandoverItems(),
    };
  }
  const carried = payload.handover?.items.length || 0;
  if (!confirm(`确认发布只读联排版本？${carried ? `将延续 ${carried} 项旧版已完成登记的实际开始 / 实际完成。` : '未选择交接项，新版登记均为空。'}发布后岗位将依据新版本登记。`)) return;
  try {
    const result = await api('POST', '/api/publish', payload);
    $('#publish-note').value = '';
    const carriedMsg = result.handover?.carriedCount
      ? `，已从第 ${result.handover.sourceVersionNo} 版延续 ${result.handover.carriedCount} 项实际开始/完成` : '';
    alertBar('ok', `🎉 已发布联排第 ${result.versionNo} 版（版本号校验通过）${carriedMsg}，草稿版本已推进，请刷新视图`);
    state.draft = await loadDraftFresh();
    renderDraft();
  } catch (e) {
    if (e.status === 422) alertBar('error', errorToHtml(e), 12000);
    else alertBar('error', errorToHtml(e));
    // 发布失败（草稿/交接变化）后重新拉取草稿与交接预览
    loadDraft().then(renderDraft).catch(() => {});
  }
});

// 发布成功后草稿版本号已推进，由调用处重新拉取。

$('#draft-reload').addEventListener('click', () =>
  loadDraft().then(() => alertBar('ok', '草稿已刷新')).catch((e) => alertBar('error', errorToHtml(e))));

// ---------- 现场联排 ----------

async function loadLive() {
  const data = await api('GET', '/api/live');
  state.live = data.version;
  renderLive();
}

function statusBadge(s) {
  if (s === 'DONE') return '<span class="badge done">已完成</span>';
  if (s === 'RUNNING') return '<span class="badge running">已开始</span>';
  return '<span class="badge pending">未开始</span>';
}

function renderConflicts(conflicts) {
  const box = $('#live-conflicts');
  if (!conflicts?.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="conflict-banner"><strong>⚠ 顺延后岗位冲突 ${conflicts.length} 项：</strong><ul>${
    conflicts.map((c) => `<li>${esc(c.message)}</li>`).join('')
  }</ul></div>`;
}

function renderLive() {
  const v = state.live;
  if (!v) {
    $('#live-meta').innerHTML = '<div class="muted">尚未发布任何联排版本，请等待舞监发布。</div>';
    $('#live-conflicts').innerHTML = '';
    $('#live-tbody').innerHTML = '';
    return;
  }
  $('#live-meta').innerHTML =
    `<strong>第 ${v.versionNo} 版</strong>　${esc(v.note)}　<span class="muted">发布于 ${esc(v.createdAt)}</span>
     ${v.isLatest ? '<span class="latest-tag">当前执行版本</span>' : '<span class="latest-tag" style="background:#999">非最新版本</span>'}`;
  renderConflicts(v.conflicts);

  const isOp = state.me.role === 'operator';
  const isSM = state.me.role === 'sm';
  const myPos = state.me.position;
  const canReg = isOp && v.isLatest;
  $('#live-col-reg').textContent = isSM ? '登记更正' : '岗位登记';
  $('#sm-correct-hint').hidden = !isSM;

  $('#live-tbody').innerHTML = v.cues.map((c) => {
    const mine = isOp && c.position === myPos;
    const delayed = c.delayed ? `<div class="delayed">已顺延</div>` : '';
    let reg = '<span class="muted">—</span>';
    if (canReg && mine) {
      reg = renderRegControls(c);
    } else if (mine && isOp) {
      reg = '<span class="muted">本岗位（版本已归档）</span>';
    } else if (isSM) {
      reg = renderCorrectionCell(c, v, 'live');
    }
    return `<tr class="${mine ? 'own-row' : ''}" data-cue="${c.id}">
      <td><strong>${esc(c.code)}</strong></td>
      <td>${esc(c.title)}</td>
      <td>${esc(c.position)}</td>
      <td class="mono">${c.plannedStartText} - ${minText(c.plannedStart + c.duration)}</td>
      <td class="mono">${c.schedStartText}${delayed}</td>
      <td class="mono">${c.schedEndText}</td>
      <td>${statusBadge(c.status)}<div class="muted">v${c.rowVer}</div></td>
      <td class="mono">${c.actualStartText ?? '—'}${handoverTag(c)}</td>
      <td class="mono">${c.actualEndText ?? '—'}</td>
      <td class="mono">${c.estimatedEndText ?? '—'}</td>
      <td>${reg}</td>
    </tr>`;
  }).join('');
}

function handoverTag(c) {
  if (!c.handover) return '';
  return `<div class="handover-tag" title="实际开始/完成延续自第 ${c.handover.sourceVersionNo} 版提示项 ${c.handover.sourceCode}">↩ 交接自第 ${c.handover.sourceVersionNo} 版·${esc(c.handover.sourceCode)}</div>`;
}

function renderRegControls(c) {
  const common = `data-cue="${c.id}" data-ver="${c.rowVer}" data-version-id="${state.live.id}"`;
  let buttons = '';
  if (c.status === 'PENDING') {
    buttons = `
      <div class="reg-actions">
        <input type="time" data-role="start-time" title="留空取当前时间" />
        <button class="primary tiny" data-reg="start" ${common}>开始</button>
      </div>
      <div class="reg-actions">
        <input type="time" data-role="est-time" />
        <button class="ghost tiny" data-reg="estimate" ${common}>预计结束</button>
      </div>`;
  } else if (c.status === 'RUNNING') {
    buttons = `
      <div class="reg-actions">
        <input type="time" data-role="end-time" title="留空取当前时间" />
        <button class="primary tiny" data-reg="complete" ${common}>完成</button>
      </div>
      <div class="reg-actions">
        <input type="time" data-role="est-time" value="${c.estimatedEndText ?? ''}" />
        <button class="ghost tiny" data-reg="estimate" ${common}>改预计</button>
      </div>`;
  } else {
    buttons = '<span class="muted">已完成</span>';
  }
  return buttons;
}

$('#live-tbody').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-reg]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const action = btn.dataset.reg;
  const payload = {
    versionId: Number(btn.dataset.versionId),
    cueRef: Number(btn.dataset.cue),
    rowVersion: Number(btn.dataset.ver),
    action,
  };
  if (action === 'start') payload.time = $('[data-role="start-time"]', tr)?.value || null;
  if (action === 'complete') payload.time = $('[data-role="end-time"]', tr)?.value || null;
  if (action === 'estimate') {
    payload.estimatedEndText = $('[data-role="est-time"]', tr)?.value || '';
    if (!payload.estimatedEndText) return alertBar('error', '请先填写预计结束时间');
  }
  try {
    const data = await api('POST', '/api/registrations', payload);
    state.live = data.version;
    const hasConflict = data.version.conflicts.length > 0;
    alertBar(hasConflict ? 'error' : 'ok',
      hasConflict
        ? `登记成功，但出现 ${data.version.conflicts.length} 项顺延岗位冲突，请查看红色提示。`
        : '登记成功，重算结果已更新。');
    renderLive();
  } catch (e) {
    alertBar('error', errorToHtml(e));
    if (e.status === 409) loadLive().catch(() => {});
  }
});

$('#live-reload').addEventListener('click', () =>
  loadLive().then(() => alertBar('ok', '已刷新')).catch((e) => alertBar('error', errorToHtml(e))));

// ---------- 舞监：现场登记更正 ----------

const CORR_FIELDS = [
  { key: 'actual_start', label: '实际开始', timeKey: 'actualStartText' },
  { key: 'actual_end', label: '实际完成', timeKey: 'actualEndText' },
  { key: 'estimated_end', label: '预计结束', timeKey: 'estimatedEndText' },
];
const CORR_FIELD_LABEL = Object.fromEntries(CORR_FIELDS.map((f) => [f.key, f.label]));

function timeOrDash(t) { return t ?? '<span class="muted">空</span>'; }

function renderCorrectionCell(c, v, scope) {
  const corrBtn = v.isLatest && scope === 'live'
    ? `<button class="danger tiny" data-act="open-correct" data-scope="${scope}" data-cue="${c.id}">更正</button>`
    : scope === 'live' ? '<span class="muted">归档不可更正</span>' : '';
  const histBtn = c.corrections?.length
    ? `<button class="ghost tiny" data-act="open-history" data-scope="${scope}" data-cue="${c.id}">更正记录(${c.corrections.length})</button>`
    : '';
  return `<div class="corr-actions">${corrBtn}${histBtn}</div>`;
}

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-overlay').hidden = false;
}

function closeModal() {
  $('#modal-overlay').hidden = true;
  $('#modal-body').innerHTML = '';
}

$('#modal-close').addEventListener('click', closeModal);
$('#modal-overlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'modal-overlay') closeModal();
});

function findCueInContext(scope, cueId) {
  const v = scope === 'live' ? state.live : state.detail;
  const cue = v?.cues.find((x) => x.id === cueId);
  return { v, cue };
}

function renderHistoryHtml(cue, v) {
  const rows = cue.corrections || [];
  return `
    <div class="muted">
      第 ${v.versionNo} 版 · <strong>${esc(cue.code)}</strong> ${esc(cue.title)}（${esc(cue.position)}）
      ${v.isLatest ? '' : '· 归档版本（只读）'}
    </div>
    <div class="table-wrap corr-history">
      <table>
        <thead><tr><th>更正项</th><th>更正前</th><th>更正后</th><th>操作者</th><th>时间</th><th>原因</th></tr></thead>
        <tbody>${rows.map((r) => `<tr${r.cascaded ? ' class="cascaded-row"' : ''}>
          <td>${esc(CORR_FIELD_LABEL[r.field] || r.field)}${r.cascaded ? '<div class="muted">级联清除</div>' : ''}</td>
          <td class="mono">${timeOrDash(r.oldValueText)}</td>
          <td class="mono">${timeOrDash(r.newValueText)}</td>
          <td>${esc(r.correctedBy)}</td>
          <td class="mono">${esc(r.correctedAt)}</td>
          <td class="corr-reason">${esc(r.reason)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="muted">更正只改变现场登记，不改变已发布计划；清除实际开始时系统会同时清除实际完成。</div>`;
}

$('#live-tbody').addEventListener('click', (ev) => {
  const corrBtn = ev.target.closest('button[data-act="open-correct"], button[data-act="open-history"]');
  if (!corrBtn) return;
  const cueId = Number(corrBtn.dataset.cue);
  const { v, cue } = findCueInContext('live', cueId);
  if (!cue) return;
  if (corrBtn.dataset.act === 'open-history') {
    openModal(`更正记录：${cue.code}`, renderHistoryHtml(cue, v));
  } else {
    openCorrectForm(cue, v);
  }
});

function openCorrectForm(cue, v) {
  const options = CORR_FIELDS.map((f) =>
    `<option value="${f.key}">${f.label}（当前 ${cue[f.timeKey] ?? '空'}）</option>`).join('');
  openModal(`现场登记更正：${cue.code}`, `
    <form id="corr-form" class="cue-form" data-cue-id="${cue.id}">
      <div class="muted">
        第 ${v.versionNo} 版 · <strong>${esc(cue.code)}</strong> ${esc(cue.title)}（${esc(cue.position)}），
        行版本 v${cue.rowVer}。仅可更正/清除其中一项；已发布计划不受影响。
      </div>
      <label>更正项
        <select name="field" id="corr-field">${options}</select>
      </label>
      <label>更正后时间
        <input type="time" name="time" id="corr-time" />
      </label>
      <label class="corr-clear-line"><input type="checkbox" name="clear" id="corr-clear" /> 清除该项（留空）</label>
      <label>更正原因（必填）
        <textarea name="reason" id="corr-reason" rows="2" maxlength="200" required placeholder="如：岗位口误报错、舞监现场核定"></textarea>
      </label>
      <div id="corr-err" class="error-text" hidden></div>
      <div class="form-actions">
        <button type="submit" class="danger">保存更正</button>
        <button type="button" class="ghost" id="corr-cancel">取消</button>
      </div>
      <div class="muted" id="corr-rule-hint"></div>
    </form>`);

  const fieldSel = $('#corr-field');
  const timeInput = $('#corr-time');
  const clearBox = $('#corr-clear');
  const hint = $('#corr-rule-hint');
  const FILL_DEFAULTS = { actual_start: cue.actualStartText, actual_end: cue.actualEndText, estimated_end: cue.estimatedEndText };
  const RULE_HINTS = {
    actual_start: '更正完成须不早于开始；清除实际开始将同时清除实际完成；保留的预计结束不得早于实际开始（无实际开始则为原计划开始）。',
    actual_end: '实际完成必须有实际开始且不得早于实际开始。',
    estimated_end: '预计结束不得早于实际开始（若无实际开始则为原计划开始）。',
  };
  function syncField() {
    const f = fieldSel.value;
    hint.textContent = RULE_HINTS[f];
    clearBox.checked = false;
    timeInput.disabled = false;
    timeInput.value = FILL_DEFAULTS[f] || '';
  }
  fieldSel.addEventListener('change', syncField);
  clearBox.addEventListener('change', () => { timeInput.disabled = clearBox.checked; });
  $('#corr-cancel').addEventListener('click', closeModal);
  syncField();
}

$('#modal-overlay').addEventListener('submit', async (ev) => {
  const form = ev.target.closest('#corr-form');
  if (!form) return;
  ev.preventDefault();
  const errBox = $('#corr-err');
  errBox.hidden = true;
  const v = state.live;
  const cueId = Number(form.dataset.cueId);
  const cue = v?.cues.find((x) => x.id === cueId);
  if (!cue) { closeModal(); return; }
  const field = $('#corr-field').value;
  const clear = $('#corr-clear').checked;
  const reason = $('#corr-reason').value.trim();
  if (!reason) {
    errBox.textContent = '请填写更正原因';
    errBox.hidden = false;
    return;
  }
  if (!clear && !$('#corr-time').value) {
    errBox.textContent = '请填写更正后的时间，或勾选“清除该项”';
    errBox.hidden = false;
    return;
  }
  const meta = CORR_FIELDS.find((f) => f.key === field);
  const payload = {
    versionId: v.id,
    cueRef: cueId,
    rowVersion: cue.rowVer,
    field,
    clear,
    reason,
  };
  payload[meta.timeKey] = clear ? null : $('#corr-time').value;
  try {
    const data = await api('POST', '/api/registrations/corrections', payload);
    state.live = data.version;
    closeModal();
    const conflictN = data.version.conflicts.length;
    alertBar(conflictN ? 'error' : 'ok',
      (data.cascaded ? '更正成功（清除开始已同时清除完成）。' : '更正成功，后续未开始项已按现有规则重算。')
      + (conflictN ? ` 当前存在 ${conflictN} 项顺延岗位冲突，请查看红色提示。` : ''),
      conflictN ? 10000 : 5000);
    renderLive();
  } catch (e) {
    if (e.status === 409) {
      // 与岗位登记共用行版本：过期时拒绝并提示刷新，不能覆盖新登记
      alertBar('error', errorToHtml(e));
      loadLive().then(renderLive).catch(() => {});
      closeModal();
    } else {
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  }
});

// ---------- 已发布版本回看 ----------

async function loadVersions() {
  const data = await api('GET', '/api/versions');
  state.versions = data.versions;
  renderVersions();
}

function renderVersions() {
  $('#versions-tbody').innerHTML = state.versions.map((v) =>
    `<tr>
      <td><strong>第 ${v.versionNo} 版</strong></td>
      <td>${esc(v.note)}</td>
      <td class="mono">${esc(v.createdAt)}</td>
      <td>${v.cueCount}</td>
      <td>${v.regCount}</td>
      <td><button class="ghost tiny" data-act="view-version" data-id="${v.id}">回看</button></td>
    </tr>`).join('')
    || '<tr><td colspan="6" class="muted">暂无已发布版本。</td></tr>';
}

$('#versions-tbody').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="view-version"]');
  if (!btn) return;
  try {
    state.detail = await api('GET', `/api/versions/${btn.dataset.id}`);
    renderDetail();
  } catch (e) { alertBar('error', errorToHtml(e)); }
});

// 回看页（含归档版本）只展示更正历史，不提供更正入口
$('#version-detail').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-act="open-history"]');
  if (!btn) return;
  const cueId = Number(btn.dataset.cue);
  const v = state.detail;
  const cue = v?.cues.find((x) => x.id === cueId);
  if (cue) openModal(`更正记录：${cue.code}`, renderHistoryHtml(cue, v));
});

function renderDetail() {
  const v = state.detail;
  if (!v) return;
  const conflictHtml = v.conflicts.length
    ? `<div class="conflict-banner"><strong>冲突 ${v.conflicts.length} 项：</strong><ul>${
        v.conflicts.map((c) => `<li>${esc(c.message)}</li>`).join('')}</ul></div>` : '';
  $('#version-detail').innerHTML = `
    <div class="panel">
      <h3>回看：第 ${v.versionNo} 版（只读）${v.isLatest ? '<span class="latest-tag">当前执行版本</span>' : ''}</h3>
      <div class="muted">${esc(v.note)} · 发布于 ${esc(v.createdAt)}</div>
    </div>
    ${conflictHtml}
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>编号</th><th>说明</th><th>岗位</th><th>计划</th><th>重算开始</th><th>重算结束</th><th>状态</th><th>实际开始</th><th>实际完成</th><th>预计结束</th><th>登记人/时间</th>${state.me?.role === 'sm' ? '<th>更正</th>' : ''}</tr></thead>
      <tbody>${v.cues.map((c) => `<tr>
        <td><strong>${esc(c.code)}</strong></td>
        <td>${esc(c.title)}</td>
        <td>${esc(c.position)}</td>
        <td class="mono">${c.plannedStartText} - ${minText(c.plannedStart + c.duration)}</td>
        <td class="mono">${c.schedStartText}${c.delayed ? '<div class="delayed">顺延</div>' : ''}</td>
        <td class="mono">${c.schedEndText}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="mono">${c.actualStartText ?? '—'}${handoverTag(c)}</td>
        <td class="mono">${c.actualEndText ?? '—'}</td>
        <td class="mono">${c.estimatedEndText ?? '—'}</td>
        <td class="muted">${c.updatedBy ? esc(c.updatedBy) + '<br>' + esc(c.updatedAt || '') : '—'}</td>
        <td>${state.me?.role === 'sm' ? renderCorrectionCell(c, v, 'detail') : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

$('#versions-reload').addEventListener('click', () =>
  loadVersions().then(() => alertBar('ok', '版本列表已刷新')).catch((e) => alertBar('error', errorToHtml(e))));

// ---------- 启动 ----------

(async function boot() {
  try {
    const data = await fetch('/api/me').then((r) => r.json());
    if (data.user) {
      state.me = data.user;
      state.positions = data.positions || [];
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
