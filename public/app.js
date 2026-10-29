const MAX_INPUT_BYTES = 50_000_000;
const MIN_TARGET_MB = 0.05;
const MAX_TARGET_MB = 100;

const dropZone = document.querySelector('#dropZone');
const dropEmpty = document.querySelector('#dropEmpty');
const fileInput = document.querySelector('#fileInput');
const filePreview = document.querySelector('#filePreview');
const previewImage = document.querySelector('#previewImage');
const fileName = document.querySelector('#fileName');
const fileMeta = document.querySelector('#fileMeta');
const changeFileBtn = document.querySelector('#changeFileBtn');
const targetSize = document.querySelector('#targetSize');
const presetButtons = [...document.querySelectorAll('.preset-button')];
const convertBtn = document.querySelector('#convertBtn');
const convertLabel = convertBtn.querySelector('.button-label');
const statusMessage = document.querySelector('#statusMessage');
const resultSection = document.querySelector('#resultSection');
const resultSummary = document.querySelector('#resultSummary');
const resultSize = document.querySelector('#resultSize');
const resultDimensions = document.querySelector('#resultDimensions');
const resultColours = document.querySelector('#resultColours');
const downloadBtn = document.querySelector('#downloadBtn');

let selectedFile = null;
let previewUrl = null;
let resultUrl = null;
let resultFilename = 'converted.png';
let sourceWidth = 0;
let sourceHeight = 0;
let converting = false;

function formatBytes(bytes) {
  if (bytes < 1_000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
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
  return Number.isFinite(value) && value >= MIN_TARGET_MB && value <= MAX_TARGET_MB;
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

  convertBtn.disabled = converting || !selectedFile || !targetIsValid();
}

function clearResult() {
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  resultSection.hidden = true;
}

function clearSelectedFile() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  selectedFile = null;
  sourceWidth = 0;
  sourceHeight = 0;
  filePreview.hidden = true;
  dropEmpty.hidden = false;
  clearResult();
  updateTargetState();
}

async function readImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

async function selectFile(file) {
  if (!file || converting) {
    return;
  }

  if (!isJpeg(file)) {
    setStatus('只支持 JPG/JPEG 格式，请重新选择。', 'error');
    return;
  }

  if (file.size > MAX_INPUT_BYTES) {
    setStatus('这张图片超过 50 MB，请先选择更小的 JPG。', 'error');
    return;
  }

  clearSelectedFile();
  selectedFile = file;

  try {
    previewUrl = URL.createObjectURL(file);
    const dimensions = await readImageDimensions(previewUrl);
    sourceWidth = dimensions.width;
    sourceHeight = dimensions.height;
    previewImage.src = previewUrl;
    fileName.textContent = file.name;
    fileMeta.textContent = `${formatBytes(file.size)} · ${sourceWidth} × ${sourceHeight} px`;
    dropEmpty.hidden = true;
    filePreview.hidden = false;
    setStatus('图片已就绪，可以开始转换。');
  } catch {
    clearSelectedFile();
    setStatus('无法预览这张图片，请确认文件没有损坏。', 'error');
    return;
  }

  updateTargetState();
}

function chooseFile() {
  if (!converting) {
    fileInput.value = '';
    fileInput.click();
  }
}

function parseErrorResponse(response) {
  return response
    .json()
    .then((payload) => payload.error || `转换失败（HTTP ${response.status}）`)
    .catch(() => `转换失败（HTTP ${response.status}）`);
}

async function convert() {
  if (!selectedFile || !targetIsValid() || converting) {
    return;
  }

  converting = true;
  clearResult();
  convertBtn.classList.add('is-loading');
  convertBtn.setAttribute('aria-busy', 'true');
  convertLabel.textContent = '正在计算最佳 PNG…';
  updateTargetState();
  setStatus(`正在生成 PNG，并尝试把文件控制在 ${Number(targetSize.value).toFixed(2)} MB 以下…`, 'working');

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(selectedFile.name),
        'X-Target-Bytes': String(targetBytes()),
      },
      body: selectedFile,
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    const blob = await response.blob();
    if (blob.size >= targetBytes()) {
      throw new Error('输出文件未能控制到目标大小，请提高目标值后重试。');
    }

    resultUrl = URL.createObjectURL(blob);
    const encodedName = response.headers.get('X-Output-Filename');
    resultFilename = encodedName ? decodeURIComponent(encodedName) : 'converted.png';
    const width = response.headers.get('X-Result-Width') || '—';
    const height = response.headers.get('X-Result-Height') || '—';
    const colours = response.headers.get('X-Result-Colours') || '—';
    const savedPercent = selectedFile.size > 0 ? (1 - blob.size / selectedFile.size) * 100 : 0;

    resultSize.textContent = `${formatBytes(blob.size)} / < ${Number(targetSize.value).toFixed(2)} MB`;
    resultDimensions.textContent = `${sourceWidth} × ${sourceHeight} → ${width} × ${height}`;
    resultColours.textContent = `${colours} 色`;
    resultSummary.textContent = savedPercent > 0
      ? `原文件 ${formatBytes(selectedFile.size)}，输出 ${formatBytes(blob.size)}，体积减少 ${savedPercent.toFixed(0)}%。`
      : `原文件 ${formatBytes(selectedFile.size)}，输出 ${formatBytes(blob.size)}，已严格控制在目标大小以内。`;

    resultSection.hidden = false;
    setStatus('转换完成，文件已准备好下载。');
    requestAnimationFrame(() => resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  } catch (error) {
    setStatus(error.message || '转换失败，请稍后重试。', 'error');
  } finally {
    converting = false;
    convertBtn.classList.remove('is-loading');
    convertBtn.removeAttribute('aria-busy');
    convertLabel.textContent = '转换为 PNG';
    updateTargetState();
  }
}

dropZone.addEventListener('click', (event) => {
  if (event.target.closest('#changeFileBtn')) {
    return;
  }
  chooseFile();
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseFile();
  }
});

changeFileBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  chooseFile();
});

fileInput.addEventListener('change', () => {
  selectFile(fileInput.files?.[0]);
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!converting) {
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
  const file = event.dataTransfer?.files?.[0];
  selectFile(file);
});

targetSize.addEventListener('input', updateTargetState);
targetSize.addEventListener('blur', () => {
  if (!targetIsValid()) {
    setStatus('请输入 0.05 到 100 MB 之间的数值。', 'error');
  }
});

for (const button of presetButtons) {
  button.addEventListener('click', () => {
    targetSize.value = button.dataset.size;
    updateTargetState();
  });
}

convertBtn.addEventListener('click', convert);

downloadBtn.addEventListener('click', () => {
  if (!resultUrl) {
    return;
  }
  const link = document.createElement('a');
  link.href = resultUrl;
  link.download = resultFilename;
  document.body.append(link);
  link.click();
  link.remove();
});

window.addEventListener('beforeunload', () => {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
  }
});

updateTargetState();
