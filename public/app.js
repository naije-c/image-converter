import { createStoredZip } from './zip.js';

const MAX_BATCH_FILES = 20;
const MAX_INPUT_BYTES = 50_000_000;
const MAX_BATCH_INPUT_BYTES = 200_000_000;
const MAX_BATCH_OUTPUT_BYTES = 500_000_000;
const MIN_TARGET_MB = 0.05;
const MAX_TARGET_MB = 100;

const dropZone = document.querySelector('#dropZone');
const dropEmpty = document.querySelector('#dropEmpty');
const fileInput = document.querySelector('#fileInput');
const filePreview = document.querySelector('#filePreview');
const batchSummary = document.querySelector('#batchSummary');
const batchHint = document.querySelector('#batchHint');
const fileList = document.querySelector('#fileList');
const addFilesBtn = document.querySelector('#addFilesBtn');
const clearFilesBtn = document.querySelector('#clearFilesBtn');
const targetSize = document.querySelector('#targetSize');
const presetButtons = [...document.querySelectorAll('.preset-button')];
const convertBtn = document.querySelector('#convertBtn');
const convertLabel = convertBtn.querySelector('.button-label');
const statusMessage = document.querySelector('#statusMessage');
const resultSection = document.querySelector('#resultSection');
const resultTitle = document.querySelector('#result-title');
const resultSummary = document.querySelector('#resultSummary');
const resultCount = document.querySelector('#resultCount');
const resultSize = document.querySelector('#resultSize');
const resultLimit = document.querySelector('#resultLimit');
const resultFileList = document.querySelector('#resultFileList');
const downloadBtn = document.querySelector('#downloadBtn');
const downloadLabel = document.querySelector('#downloadLabel');

const state = {
  items: [],
  converting: false,
  zipBusy: false,
  progressText: '',
};

function formatBytes(bytes) {
  if (bytes < 1_000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function formatLimit() {
  return `< ${Number(targetSize.value).toFixed(2)} MB`;
}

function setStatus(message, type = 'idle') {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('is-error', type === 'error');
  statusMessage.classList.toggle('is-working', type === 'working');
}

function isJpeg(file) {
  return file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
}

function targetBytes() {
  return Math.floor(Number(targetSize.value) * 1_000_000);
}

function targetIsValid() {
  const value = Number(targetSize.value);
  if (!Number.isFinite(value) || value < MIN_TARGET_MB || value > MAX_TARGET_MB) {
    return false;
  }
  return state.items.length === 0 || targetBytes() * state.items.length <= MAX_BATCH_OUTPUT_BYTES;
}

function targetValidationMessage() {
  const value = Number(targetSize.value);
  if (!Number.isFinite(value) || value < MIN_TARGET_MB || value > MAX_TARGET_MB) {
    return '请输入 0.05 到 100 MB 之间的数值。';
  }
  return '当前数量与大小上限组合的预计总输出超过 500 MB，请降低上限或减少图片。';
}

function inputTotalBytes() {
  return state.items.reduce((total, item) => total + item.file.size, 0);
}

function successfulItems() {
  return state.items.filter((item) => item.status === 'done' && item.outputBlob && item.outputUrl);
}

function hasResults() {
  return state.items.some((item) => item.outputBlob);
}

function makeItem(file) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    file,
    status: 'ready',
    outputBlob: null,
    outputUrl: null,
    outputName: '',
    result: null,
    error: '',
  };
}

function updateTargetState() {
  const value = Number(targetSize.value);
  for (const button of presetButtons) {
    button.classList.toggle('is-active', Number(button.dataset.size) === value);
  }
  if (targetIsValid()) {
    targetSize.removeAttribute('aria-invalid');
  } else {
    targetSize.setAttribute('aria-invalid', 'true');
  }
}

function updateControls() {
  const hasFiles = state.items.length > 0;
  const totalBytes = inputTotalBytes();
  const remaining = Math.max(0, MAX_BATCH_FILES - state.items.length);

  dropEmpty.hidden = hasFiles;
  filePreview.hidden = !hasFiles;
  if (hasFiles) {
    batchSummary.textContent = `${state.items.length} 张图片 · ${formatBytes(totalBytes)}`;
    batchHint.textContent = remaining > 0
      ? `转换会按顺序逐张处理，还可以添加 ${remaining} 张。`
      : '已达到每批 20 张的上限。';
  }

  addFilesBtn.disabled = state.converting || remaining === 0;
  clearFilesBtn.disabled = state.converting;
  targetSize.disabled = state.converting;
  for (const button of presetButtons) {
    button.disabled = state.converting;
  }

  convertBtn.disabled = state.converting || state.zipBusy || !hasFiles || !targetIsValid();
  convertBtn.classList.toggle('is-loading', state.converting);
  convertBtn.toggleAttribute('aria-busy', state.converting);
  if (state.converting) {
    convertLabel.textContent = state.progressText || '正在转换…';
  } else if (hasResults()) {
    convertLabel.textContent = '重新转换整批';
  } else if (state.items.length > 1) {
    convertLabel.textContent = `转换 ${state.items.length} 张图片为 PNG`;
  } else {
    convertLabel.textContent = '转换为 PNG';
  }
}

function fileMetaText(item) {
  const inputSize = formatBytes(item.file.size);
  if (item.status === 'converting') {
    return `${inputSize} · 正在转换…`;
  }
  if (item.status === 'done' && item.result && item.outputBlob) {
    return `${inputSize} → ${formatBytes(item.outputBlob.size)} · ${item.result.width} × ${item.result.height} px`;
  }
  if (item.status === 'error') {
    return `${inputSize} · ${item.error}`;
  }
  return `${inputSize} · 等待转换`;
}

function statusLabel(status) {
  if (status === 'converting') return '转换中';
  if (status === 'done') return '已完成';
  if (status === 'error') return '失败';
  return '待转换';
}

function renderFileList() {
  const fragment = document.createDocumentFragment();

  state.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `file-item is-${item.status}`;
    row.dataset.id = item.id;

    const badge = document.createElement('div');
    badge.className = 'file-index';
    const type = document.createElement('span');
    type.textContent = 'JPG';
    const number = document.createElement('strong');
    number.textContent = String(index + 1).padStart(2, '0');
    badge.append(type, number);

    const copy = document.createElement('div');
    copy.className = 'file-item-copy';
    const name = document.createElement('p');
    name.className = 'file-item-name';
    name.title = item.file.name;
    name.textContent = item.file.name;
    const meta = document.createElement('p');
    meta.className = 'file-item-meta';
    meta.textContent = fileMetaText(item);
    copy.append(name, meta);

    const status = document.createElement('span');
    status.className = `item-status is-${item.status}`;
    status.textContent = statusLabel(item.status);

    const actions = document.createElement('div');
    actions.className = 'file-item-actions';
    if (item.status === 'done') {
      const download = document.createElement('button');
      download.className = 'row-download';
      download.type = 'button';
      download.dataset.action = 'download';
      download.dataset.id = item.id;
      download.textContent = '下载';
      actions.append(download);
    }
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.id = item.id;
    remove.disabled = state.converting;
    remove.setAttribute('aria-label', `移除 ${item.file.name}`);
    remove.textContent = '×';
    actions.append(remove);

    row.append(badge, copy, status, actions);
    fragment.append(row);
  });

  fileList.replaceChildren(fragment);
}

function renderResultFileList(items) {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'result-file-row';

    const check = document.createElement('span');
    check.className = 'result-file-check';
    check.textContent = '✓';

    const copy = document.createElement('div');
    copy.className = 'result-file-copy';
    const name = document.createElement('p');
    name.className = 'result-file-name';
    name.title = item.outputName;
    name.textContent = item.outputName;
    const meta = document.createElement('p');
    meta.className = 'result-file-meta';
    meta.textContent = `${formatBytes(item.outputBlob.size)} · ${item.result.width} × ${item.result.height} px · ${item.result.colours} 色`;
    copy.append(name, meta);

    const download = document.createElement('button');
    download.className = 'row-download';
    download.type = 'button';
    download.dataset.downloadId = item.id;
    download.textContent = '下载';
    row.append(check, copy, download);
    fragment.append(row);
  }
  resultFileList.replaceChildren(fragment);
}

function releaseOutput(item) {
  if (item.outputUrl) {
    URL.revokeObjectURL(item.outputUrl);
  }
  item.outputBlob = null;
  item.outputUrl = null;
  item.outputName = '';
  item.result = null;
  item.error = '';
  item.status = 'ready';
}

function clearResults() {
  for (const item of state.items) {
    releaseOutput(item);
  }
  resultSection.hidden = true;
  renderFileList();
}

function clearAllFiles() {
  if (state.converting) {
    return;
  }
  for (const item of state.items) {
    releaseOutput(item);
  }
  state.items = [];
  clearResults();
  renderFileList();
  updateControls();
  setStatus('请选择一张或多张 JPG 图片开始转换。');
}

function describeSkipped(reasons) {
  return reasons.length > 0 ? `（${reasons.join('、')}）` : '';
}

function addFiles(fileCollection) {
  if (state.converting) {
    return;
  }

  const incoming = [...(fileCollection || [])];
  if (incoming.length === 0) {
    return;
  }

  const fingerprints = new Set(state.items.map((item) => `${item.file.name}|${item.file.size}|${item.file.lastModified}`));
  let totalBytes = inputTotalBytes();
  let accepted = 0;
  let skippedType = 0;
  let skippedSize = 0;
  let skippedDuplicate = 0;
  let skippedLimit = 0;
  let skippedTotal = 0;

  for (const file of incoming) {
    if (state.items.length >= MAX_BATCH_FILES) {
      skippedLimit += 1;
      continue;
    }
    if (!isJpeg(file)) {
      skippedType += 1;
      continue;
    }
    if (file.size > MAX_INPUT_BYTES) {
      skippedSize += 1;
      continue;
    }
    const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
    if (fingerprints.has(fingerprint)) {
      skippedDuplicate += 1;
      continue;
    }
    if (totalBytes + file.size > MAX_BATCH_INPUT_BYTES) {
      skippedTotal += 1;
      continue;
    }

    state.items.push(makeItem(file));
    fingerprints.add(fingerprint);
    totalBytes += file.size;
    accepted += 1;
  }

  if (accepted > 0) {
    clearResults();
    renderFileList();
    updateControls();
  }

  const reasons = [];
  if (skippedType) reasons.push(`${skippedType} 个不是 JPG`);
  if (skippedSize) reasons.push(`${skippedSize} 张超过 50 MB`);
  if (skippedDuplicate) reasons.push(`${skippedDuplicate} 张已在列表`);
  if (skippedLimit) reasons.push(`${skippedLimit} 张超出数量上限`);
  if (skippedTotal) reasons.push(`${skippedTotal} 张超出总量上限`);

  if (accepted > 0) {
    setStatus(`已添加 ${accepted} 张图片${describeSkipped(reasons)}。`, reasons.length ? 'error' : 'idle');
  } else {
    setStatus(`没有添加图片${describeSkipped(reasons)}。`, 'error');
  }
}

function chooseFile() {
  if (!state.converting && state.items.length < MAX_BATCH_FILES) {
    fileInput.value = '';
    fileInput.click();
  }
}

async function parseErrorResponse(response) {
  try {
    const payload = await response.json();
    return payload.error || `转换失败（HTTP ${response.status}）`;
  } catch {
    return `转换失败（HTTP ${response.status}）`;
  }
}

async function convertItem(item, limitBytes) {
  const response = await fetch('/api/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(item.file.name),
      'X-Target-Bytes': String(limitBytes),
    },
    body: item.file,
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const blob = await response.blob();
  if (blob.size >= limitBytes) {
    throw new Error('输出文件未能控制到目标大小');
  }

  const encodedName = response.headers.get('X-Output-Filename');
  let outputName = 'converted.png';
  if (encodedName) {
    try {
      outputName = decodeURIComponent(encodedName);
    } catch {
      outputName = encodedName;
    }
  }

  item.outputBlob = blob;
  item.outputUrl = URL.createObjectURL(blob);
  item.outputName = outputName;
  item.result = {
    width: response.headers.get('X-Result-Width') || '—',
    height: response.headers.get('X-Result-Height') || '—',
    colours: response.headers.get('X-Result-Colours') || '—',
  };
  item.error = '';
  item.status = 'done';
}

function showResults(totalCount, errors) {
  const completed = successfulItems();
  const totalBytes = completed.reduce((total, item) => total + item.outputBlob.size, 0);

  if (completed.length === totalCount) {
    resultTitle.textContent = '整批 PNG 已处理完成';
    resultSummary.textContent = `${completed.length} 张图片均已转换完成，并且每张都严格小于 ${formatLimit().slice(2)}。`;
    setStatus(`转换完成：${completed.length} 张图片全部达标。`);
  } else {
    resultTitle.textContent = '部分图片已处理完成';
    resultSummary.textContent = `成功 ${completed.length} 张，失败 ${errors} 张。失败项仍保留在上方列表中，可重新转换。`;
    setStatus(`批量处理结束：${completed.length} 张成功，${errors} 张失败。`, 'error');
  }

  resultCount.textContent = `${completed.length} / ${totalCount} 张`;
  resultSize.textContent = formatBytes(totalBytes);
  resultLimit.textContent = formatLimit();
  renderResultFileList(completed);
  downloadLabel.textContent = completed.length === 1 ? '下载 PNG' : `下载全部 ZIP（${completed.length} 张）`;
  downloadBtn.disabled = completed.length === 0;
  resultSection.hidden = false;
  requestAnimationFrame(() => resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

async function convertAll() {
  if (state.converting || state.items.length === 0 || !targetIsValid()) {
    return;
  }

  clearResults();
  state.converting = true;
  state.progressText = '正在准备转换…';
  const limitBytes = targetBytes();
  const total = state.items.length;
  let completed = 0;
  let errors = 0;
  updateControls();
  renderFileList();

  for (let index = 0; index < state.items.length; index += 1) {
    const item = state.items[index];
    item.status = 'converting';
    item.error = '';
    state.progressText = `正在处理 ${index + 1} / ${total}`;
    setStatus(`正在处理 ${index + 1} / ${total}：${item.file.name}`, 'working');
    updateControls();
    renderFileList();

    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      await convertItem(item, limitBytes);
      completed += 1;
    } catch (error) {
      item.status = 'error';
      item.error = error.message || '转换失败';
      errors += 1;
    }
    renderFileList();
  }

  state.converting = false;
  state.progressText = '';
  updateControls();

  if (completed > 0) {
    showResults(total, errors);
  } else {
    resultSection.hidden = true;
    setStatus('整批转换失败，请检查上方错误信息后重试。', 'error');
  }
}

function triggerDownload(href, filename, revokeAfter = false) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  if (revokeAfter) {
    setTimeout(() => URL.revokeObjectURL(href), 1_000);
  }
}

function downloadItem(item) {
  if (item.outputUrl && item.outputName) {
    triggerDownload(item.outputUrl, item.outputName);
  }
}

function zipFilename() {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('');
  const time = [now.getHours(), now.getMinutes()].map((part) => String(part).padStart(2, '0')).join('');
  return `png-images-${date}-${time}.zip`;
}

async function downloadAll() {
  const completed = successfulItems();
  if (completed.length === 0 || state.zipBusy) {
    return;
  }
  if (completed.length === 1) {
    downloadItem(completed[0]);
    return;
  }

  state.zipBusy = true;
  downloadBtn.disabled = true;
  downloadLabel.textContent = '正在打包 ZIP…';
  updateControls();

  try {
    const zip = await createStoredZip(completed.map((item) => ({ name: item.outputName, blob: item.outputBlob })));
    const zipUrl = URL.createObjectURL(zip);
    triggerDownload(zipUrl, zipFilename(), true);
    setStatus(`已打包 ${completed.length} 张 PNG，开始下载。`);
  } catch (error) {
    setStatus(`ZIP 打包失败：${error.message}`, 'error');
  } finally {
    state.zipBusy = false;
    downloadBtn.disabled = false;
    downloadLabel.textContent = completed.length === 1 ? '下载 PNG' : `下载全部 ZIP（${completed.length} 张）`;
    updateControls();
  }
}

dropZone.addEventListener('click', (event) => {
  if (event.target.closest('button') || !filePreview.hidden) {
    return;
  }
  chooseFile();
});

dropZone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target === dropZone) {
    event.preventDefault();
    chooseFile();
  }
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.converting) {
      dropZone.classList.add('is-dragging');
    }
  });
}

for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
}

dropZone.addEventListener('drop', (event) => {
  addFiles(event.dataTransfer?.files);
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

addFilesBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  chooseFile();
});

clearFilesBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  clearAllFiles();
});

fileList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const item = state.items.find((entry) => entry.id === button.dataset.id);
  if (!item) {
    return;
  }
  if (button.dataset.action === 'download') {
    downloadItem(item);
    return;
  }
  if (button.dataset.action === 'remove' && !state.converting) {
    releaseOutput(item);
    state.items = state.items.filter((entry) => entry.id !== item.id);
    clearResults();
    updateControls();
    setStatus(state.items.length ? '已移除这张图片，其他图片保持不变。' : '请选择一张或多张 JPG 图片开始转换。');
  }
});

resultFileList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-download-id]');
  if (!button) {
    return;
  }
  const item = state.items.find((entry) => entry.id === button.dataset.downloadId);
  if (item) {
    downloadItem(item);
  }
});

targetSize.addEventListener('input', () => {
  updateTargetState();
  if (hasResults() && !state.converting) {
    clearResults();
    setStatus('大小上限已更改，请重新转换整批图片。');
  }
  updateControls();
});

targetSize.addEventListener('blur', () => {
  if (!targetIsValid()) {
    setStatus(targetValidationMessage(), 'error');
  }
});

for (const button of presetButtons) {
  button.addEventListener('click', () => {
    if (state.converting) {
      return;
    }
    targetSize.value = button.dataset.size;
    updateTargetState();
    if (hasResults()) {
      clearResults();
      setStatus('大小上限已更改，请重新转换整批图片。');
    }
    updateControls();
  });
}

convertBtn.addEventListener('click', convertAll);
downloadBtn.addEventListener('click', downloadAll);

window.addEventListener('beforeunload', () => {
  for (const item of state.items) {
    if (item.outputUrl) {
      URL.revokeObjectURL(item.outputUrl);
    }
  }
});

updateTargetState();
updateControls();
