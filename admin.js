// Martin Black Admin
const ADMIN_PASSWORD = 'martin123';
const API_BASE = 'https://martin-black-api.stawisystems.workers.dev';
const ADMIN_TOKEN = atob('dEZmLUVuYVMza2s2V1VWSzZZOENIZ1lkbjBWRmdtX3ZXNURJU3VkMGJuaw==');

let bags = [];
let settings = {};
let editingId = null;
let stagedImage = null; // { base64, ext, dataUrl }
let pendingSaleId = null;
let pendingRestockId = null;

// ====== AUTH ======
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginBtn = document.getElementById('loginBtn');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

function checkAuth() {
  if (sessionStorage.getItem('martinblack_auth') === '1') {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    init();
  }
}
loginBtn.addEventListener('click', login);
loginPassword.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
function login() {
  if (loginPassword.value === ADMIN_PASSWORD) {
    sessionStorage.setItem('martinblack_auth', '1');
    loginError.style.display = 'none';
    checkAuth();
  } else {
    loginError.style.display = 'block';
  }
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('martinblack_auth');
  location.reload();
});

// ====== API ======
async function apiUploadImage(base64, ext) {
  const res = await fetch(`${API_BASE}/api/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ base64, ext }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Upload failed: ${res.status}`); }
  const data = await res.json();
  return `${API_BASE}${data.path}`;
}

// Low-level publish of the current in-memory `bags`. Do NOT call directly for
// user-triggered writes — go through apiMutateAndPublish so a stale list can't
// clobber the live catalogue.
async function apiPublish() {
  const res = await fetch(`${API_BASE}/api/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ bags, settings }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Save failed: ${res.status}`); }
}

// Every admin write MUST go through this. It refetches live KV, applies the
// caller's mutation against the FRESH list, then publishes — so a stale admin
// tab (or a second device/webview) can't silently resurrect deleted items or
// revert edits by republishing an old list. Mutators MUST look up bags by id
// INSIDE the callback — anything captured before the refetch is stale. A mutator
// may throw to abort the save.
async function apiMutateAndPublish(mutate) {
  const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load fresh data: ${res.status}`);
  const json = await res.json();
  bags = Array.isArray(json.bags) ? json.bags : [];
  settings = json.settings || {};
  await mutate();
  await apiPublish();
}

let accountSuspended = false;
async function loadData() {
  const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`);
  const json = await res.json();
  bags = json.bags || [];
  settings = json.settings || {};
  accountSuspended = !!json.suspended;
}

// Owner-facing notice when billing has suspended the store. The public site is
// dark; this tells the owner why and how to restore (they can't unflip it).
function renderSuspendedBanner() {
  let b = document.getElementById('suspendedBanner');
  if (!accountSuspended) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'suspendedBanner';
    b.style.cssText = 'position:sticky;top:0;z-index:9000;background:#b00020;color:#fff;padding:12px 16px;text-align:center;font-size:14px;font-weight:600;line-height:1.4;';
    document.body.prepend(b);
  }
  b.innerHTML = 'Your store is currently offline because payment is overdue. Please contact Essence Automations to restore it. <a href="https://wa.me/254720615606" style="color:#fff;text-decoration:underline;">Message us</a>';
}

// ====== HELPERS ======
const toast = document.getElementById('toast');
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }

// In-page confirm. Native confirm() returns false without showing in in-app
// webviews (WhatsApp/Instagram browser) and after Chrome's "block additional
// dialogs", which silently aborted deletes for the owner.
function confirmAction(message, okLabel = 'Confirm') {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmModalMsg');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    msgEl.textContent = message;
    okBtn.textContent = okLabel;
    modal.style.display = 'flex';
    const cleanup = result => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// In-page category picker. Same reason as confirmAction — native prompt() is
// suppressed in in-app webviews. Lists existing categories (avoids typos) with
// a "+ New category…" escape hatch. Resolves to the chosen name, or null.
function chooseCategory() {
  return new Promise(resolve => {
    const modal = document.getElementById('categoryModal');
    const sel = document.getElementById('categoryModalSelect');
    const newWrap = document.getElementById('categoryModalNewWrap');
    const newInput = document.getElementById('categoryModalNew');
    const okBtn = document.getElementById('categoryModalOk');
    const cancelBtn = document.getElementById('categoryModalCancel');
    const cats = [...new Set(bags.map(b => b.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
      + '<option value="__new__">+ New category…</option>';
    newWrap.style.display = 'none';
    newInput.value = '';
    modal.style.display = 'flex';
    const onSelChange = () => {
      const isNew = sel.value === '__new__';
      newWrap.style.display = isNew ? '' : 'none';
      if (isNew) newInput.focus();
    };
    const cleanup = result => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      sel.removeEventListener('change', onSelChange);
      resolve(result);
    };
    const onOk = () => cleanup((sel.value === '__new__' ? newInput.value.trim() : sel.value) || null);
    const onCancel = () => cleanup(null);
    sel.addEventListener('change', onSelChange);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function setSaving(on) {
  const btn = document.getElementById('saveBtn');
  btn.disabled = on;
  btn.textContent = on ? 'Publishing…' : 'Save item';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtKsh(n) { return 'Ksh ' + Number(n || 0).toLocaleString('en-KE'); }

function totalStock(item) {
  if (!item.stock) return 0;
  return Object.values(item.stock).reduce((s, q) => s + (Number(q) || 0), 0);
}

function isSoldOut(item) { return totalStock(item) === 0; }

function allSales(item) { return item.sales || []; }

function totalUnitsSold(item) {
  return allSales(item).reduce((s, r) => s + (Number(r.qty) || 1), 0);
}

function totalRevenue(item) {
  return allSales(item).reduce((s, r) => s + (Number(r.salePrice || item.price) * (Number(r.qty) || 1)), 0);
}

// ====== IMAGES ======
// Downscale + re-encode every picked/downloaded image to a compact JPEG before
// upload. WhatsApp link previews silently skip heavy images (a 2.3MB PNG won't
// render in the Enquire share card), so normalising covers to JPEG ~q82 at
// <=1280px keeps the preview working and the catalogue fast. Transparency is
// flattened onto white. All staged images become ext 'jpg'.
function blobToStagedJpeg(blob, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ base64: dataUrl.split(',')[1], ext: 'jpg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
imageInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    stagedImage = await blobToStagedJpeg(file);
    imagePreview.innerHTML = `<img src="${stagedImage.dataUrl}" style="max-width:180px;border-radius:8px;margin-top:4px;">`;
  } catch (_) { showToast('Could not read that image. Try another file.'); }
});

// Additional images: array of { base64, ext, dataUrl } OR { url } (already-uploaded)
let stagedExtras = [];
const extraImagesInput = document.getElementById('extraImagesInput');
const extraImagesPreview = document.getElementById('extraImagesPreview');

function readFileAsStaged(file) { return blobToStagedJpeg(file); }

extraImagesInput?.addEventListener('change', async e => {
  const files = [...e.target.files];
  for (const f of files) {
    if (stagedExtras.length >= 8) break;
    try {
      const staged = await readFileAsStaged(f);
      stagedExtras.push(staged);
    } catch (_) {}
  }
  renderExtraImagesPreview();
  e.target.value = ''; // allow re-selecting the same file
});

function renderExtraImagesPreview() {
  if (!extraImagesPreview) return;
  if (!stagedExtras.length) { extraImagesPreview.innerHTML = ''; return; }
  extraImagesPreview.innerHTML = stagedExtras.map((s, i) => `
    <div class="extra-img-thumb">
      <img src="${s.dataUrl || s.url}" alt="Additional image ${i + 1}">
      <button class="extra-img-remove" data-extra-remove="${i}" aria-label="Remove" title="Remove">×</button>
    </div>
  `).join('');
  extraImagesPreview.querySelectorAll('[data-extra-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.extraRemove, 10);
      stagedExtras.splice(idx, 1);
      renderExtraImagesPreview();
    });
  });
}

// ====== IG QUICK-ADD ======
// State: when a user fetches via IG, we hold the post URL so it's saved on the item.
let stagedInstagramUrl = '';

document.getElementById('igQuickBtn')?.addEventListener('click', async () => {
  const url = document.getElementById('igQuickInput').value.trim();
  const status = document.getElementById('igQuickStatus');
  if (!url) { status.textContent = 'Paste an Instagram URL first.'; status.className = 'ig-quick-status err'; return; }
  if (!/instagram\.com\/(?:p|reel|tv)\//i.test(url)) { status.textContent = 'That doesn\'t look like an IG post URL.'; status.className = 'ig-quick-status err'; return; }

  status.textContent = 'Fetching from Instagram…';
  status.className = 'ig-quick-status';

  try {
    const r = await fetch(`${API_BASE}/api/ig-fetch?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Fetch failed');

    // Download the cover (first image) through the worker proxy — IG CDN blocks
    // direct browser fetches with CORS, so we hop via /api/ig-proxy which adds ACAO.
    async function downloadAndStage(imgUrl) {
      const proxied = `${API_BASE}/api/ig-proxy?url=${encodeURIComponent(imgUrl)}`;
      const r = await fetch(proxied);
      if (!r.ok) throw new Error('Image download failed');
      return blobToStagedJpeg(await r.blob());
    }

    stagedImage = await downloadAndStage(data.imageUrl);
    imagePreview.innerHTML = `<img src="${stagedImage.dataUrl}" style="max-width:180px;border-radius:8px;margin-top:4px;">`;

    // If carousel, download additional images too
    stagedExtras = [];
    const extras = (data.imageUrls || []).slice(1);
    if (extras.length) {
      status.textContent = `Downloading ${extras.length} more image${extras.length === 1 ? '' : 's'}…`;
      for (const u of extras) {
        try { stagedExtras.push(await downloadAndStage(u)); } catch (_) {}
      }
      renderExtraImagesPreview();
    }

    // Auto-fill description from caption (strip the "username" prefix some IG embeds add)
    const cap = (data.caption || '').replace(/^[a-z0-9._]+\s+/i, '').trim();
    document.getElementById('descInput').value = cap;

    // Suggest a name from the first sentence
    if (!document.getElementById('nameInput').value && cap) {
      const firstLine = cap.split(/[.!?\n]/)[0].trim().slice(0, 60);
      document.getElementById('nameInput').value = firstLine.charAt(0).toUpperCase() + firstLine.slice(1);
    }

    stagedInstagramUrl = data.postUrl;
    status.textContent = '✓ Image and caption loaded. Review the name, category, price and stock, then Save.';
    status.className = 'ig-quick-status ok';
  } catch (err) {
    status.textContent = '✗ ' + err.message + ' — paste image and write description manually instead.';
    status.className = 'ig-quick-status err';
  }
});

// ====== STOCK READ/WRITE ======
function getStockFromForm() {
  const stock = {};
  document.querySelectorAll('.stock-qty').forEach(inp => {
    const size = (inp.dataset.size || inp.value && inp.previousElementSibling?.value || '').trim();
    // For custom-size rows the size NAME is in a sibling text input; the qty input has data-size empty
    if (inp.classList.contains('stock-qty-custom')) return;  // handled below
    const val = parseInt(inp.value, 10);
    if (size && !isNaN(val) && val > 0) stock[size] = val;
  });
  // Custom rows: pair the size-name input with the qty input
  document.querySelectorAll('.custom-size-row').forEach(row => {
    const name = row.querySelector('.custom-size-name')?.value.trim();
    const qty = parseInt(row.querySelector('.custom-size-qty')?.value, 10);
    if (name && !isNaN(qty) && qty > 0) stock[name] = qty;
  });
  return stock;
}

// Sizes the standard fixed grids already cover (so we know what's "custom")
const FIXED_GRID_SIZES = new Set([
  'One Size',
  'XS','S','M','L','XL','XXL','3XL','4XL','5XL',
  '28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44',
  'UK6','UK7','UK8','UK9','UK10','UK11','UK12'
]);

function setStockToForm(stock) {
  document.querySelectorAll('.stock-qty').forEach(inp => {
    const size = inp.dataset.size;
    inp.value = stock && size && stock[size] > 0 ? stock[size] : '';
  });
  // Repopulate custom rows from any sizes that aren't in the fixed grid
  const customWrap = document.getElementById('customSizeRows');
  if (customWrap) {
    customWrap.innerHTML = '';
    if (stock) {
      Object.entries(stock).forEach(([size, qty]) => {
        if (qty > 0 && !FIXED_GRID_SIZES.has(size)) addCustomSizeRow(size, qty);
      });
    }
  }
}

function clearStockForm() {
  document.querySelectorAll('.stock-qty').forEach(inp => { inp.value = ''; });
  const customWrap = document.getElementById('customSizeRows');
  if (customWrap) customWrap.innerHTML = '';
}

// ====== CUSTOM SIZE ROWS ======
function addCustomSizeRow(name = '', qty = '') {
  const wrap = document.getElementById('customSizeRows');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'custom-size-row';
  row.innerHTML = `
    <input type="text" class="custom-size-name" placeholder="Size name (e.g. EU 42, Free Size)" value="${escapeHtml(name)}">
    <input type="number" min="0" step="1" class="custom-size-qty" placeholder="Qty" value="${qty || ''}">
    <button type="button" class="btn-admin danger custom-size-remove" aria-label="Remove">×</button>
  `;
  row.querySelector('.custom-size-remove').addEventListener('click', () => row.remove());
  wrap.appendChild(row);
}
document.getElementById('addCustomSizeBtn')?.addEventListener('click', () => addCustomSizeRow());

// ====== AI DESCRIPTION ======
document.getElementById('aiBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  const cat = document.getElementById('categoryInput').value;
  if (!name) { showToast('Enter the item name first.'); return; }
  document.getElementById('descInput').value = generateDescription(name, cat);
});

function generateDescription(name, cat) {
  const lower = name.toLowerCase();
  const colors = { black: 'sleek black', white: 'crisp white', navy: 'deep navy', grey: 'cool grey', gray: 'cool grey', blue: 'rich blue', brown: 'warm brown', khaki: 'classic khaki', beige: 'warm beige', cream: 'soft cream', olive: 'olive green', red: 'bold red' };
  let color = '';
  for (const c in colors) if (lower.includes(c)) { color = colors[c]; break; }

  const catMap = {
    Sneakers: 'pair of sneakers', 'Sports/Athletic': 'pair', Boots: 'pair of boots',
    Loafers: 'pair of loafers', Formal: 'pair of formal shoes', Slides: 'pair of slides', Other: 'pair',
  };
  const type = catMap[cat] || 'pair';

  const openers = [
    `Clean ${color || 'fresh'} ${type}, hand-picked for everyday wear.`,
    `A sharp ${color || 'quality'} ${type} that steps up any fit.`,
    `${color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Fresh'} ${type}, in stock and ready to move.`,
  ];
  const mids = [
    `Inspected before listing. What you see is what you get.`,
    `Fresh in. Quality-checked, photographed as it is.`,
    `Sizes listed below, while stock lasts.`,
  ];
  const closes = [
    `Tap Enquire to chat with us on WhatsApp.`,
    `Confirm your size on WhatsApp, then pay via M-Pesa Till 5347003.`,
    `Collect in Nairobi CBD or we deliver countrywide.`,
  ];
  return [openers[Math.floor(Math.random() * openers.length)], mids[Math.floor(Math.random() * mids.length)], closes[Math.floor(Math.random() * closes.length)]].join(' ');
}

// ====== SAVE ITEM ======
document.getElementById('saveBtn').addEventListener('click', saveItem);
document.getElementById('cancelBtn').addEventListener('click', resetForm);

async function saveItem() {
  const name = document.getElementById('nameInput').value.trim();
  const priceRaw = document.getElementById('priceInput').value.trim();
  const price = priceRaw === '' ? 0 : parseInt(priceRaw, 10);
  const desc = document.getElementById('descInput').value.trim();
  const category = document.getElementById('categoryInput').value || '';
  const stock = getStockFromForm();

  if (!name) { showToast('Item name is required.'); return; }
  if (isNaN(price) || price < 0) { showToast('Price must be a number (or leave blank for "Price on request").'); return; }

  setSaving(true);
  try {
    let imagePath = null;
    if (stagedImage) {
      showToast('Uploading image…');
      imagePath = await apiUploadImage(stagedImage.base64, stagedImage.ext);
    }

    // Upload any newly-added extras (ones with base64), keep already-uploaded ones (.url)
    let extraUrls = [];
    if (stagedExtras.length) {
      showToast(`Uploading ${stagedExtras.length} additional image${stagedExtras.length === 1 ? '' : 's'}…`);
      for (const s of stagedExtras) {
        if (s.url) { extraUrls.push(s.url); continue; }
        const p = await apiUploadImage(s.base64, s.ext);
        extraUrls.push(p);
      }
    }

    if (editingId) {
      // Read the form's cleared/zeroed sizes now (DOM), apply to the FRESH bag in the mutator.
      const clearedSizes = [];
      document.querySelectorAll('.stock-qty').forEach(inp => {
        const val = parseInt(inp.value, 10);
        if ((!isNaN(val) && val === 0) || inp.value === '') clearedSizes.push(inp.dataset.size);
      });
      await apiMutateAndPublish(() => {
        const bag = bags.find(b => b.id === editingId);
        if (!bag) throw new Error('Item no longer exists — refresh admin');
        bag.name = name;
        bag.category = category;
        bag.description = desc;
        bag.price = price;
        bag.stock = { ...bag.stock, ...stock };
        // On edit, additional images = whatever is currently in stagedExtras (which we pre-populated from the bag)
        bag.images = extraUrls.length ? [imagePath || bag.image, ...extraUrls] : (imagePath ? [imagePath] : (bag.images || []));
        // Strip the lead since image field stays as the primary
        if (bag.images.length) bag.images = bag.images.filter((u, i, a) => u && a.indexOf(u) === i);
        // Remove sizes explicitly cleared/zeroed in the form
        clearedSizes.forEach(sz => { delete bag.stock[sz]; });
        if (imagePath) bag.image = imagePath;
      });
      showToast('Item updated and live!');
    } else {
      if (!stagedImage) { showToast('Add an item image.'); setSaving(false); return; }
      const id = 'item_' + Date.now();
      const newBag = { id, name, category, description: desc, price, stock, sales: [], image: imagePath, createdAt: new Date().toISOString() };
      if (extraUrls.length) newBag.images = [imagePath, ...extraUrls];
      if (stagedInstagramUrl) newBag.instagramUrl = stagedInstagramUrl;
      await apiMutateAndPublish(() => { bags.unshift(newBag); });
      showToast('Item added and live!');
    }
    resetForm();
    renderList();
    renderDashboard();
    renderInventory();
  } catch (err) {
    showToast('Error: ' + err.message);
    console.error(err);
  } finally {
    setSaving(false);
  }
}

function resetForm() {
  editingId = null;
  document.getElementById('editingId').value = '';
  document.getElementById('nameInput').value = '';
  document.getElementById('categoryInput').value = '';
  document.getElementById('descInput').value = '';
  document.getElementById('priceInput').value = '';
  clearStockForm();
  imageInput.value = '';
  imagePreview.innerHTML = '';
  stagedImage = null;
  stagedExtras = [];
  renderExtraImagesPreview();
  stagedInstagramUrl = '';
  const igInput = document.getElementById('igQuickInput');
  if (igInput) igInput.value = '';
  const igStatus = document.getElementById('igQuickStatus');
  if (igStatus) { igStatus.textContent = ''; igStatus.className = 'ig-quick-status'; }
  document.getElementById('formTitle').textContent = 'Add a new item';
  document.getElementById('cancelBtn').style.display = 'none';
  // Restore the IG quick-add panel + divider (hidden during edit mode)
  const igPanel = document.getElementById('igQuickPanel');
  const manualDivider = document.getElementById('manualEntryDivider');
  if (igPanel) igPanel.style.display = '';
  if (manualDivider) manualDivider.style.display = '';
}

function editItem(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  editingId = id;
  document.getElementById('editingId').value = id;
  document.getElementById('nameInput').value = bag.name;
  document.getElementById('categoryInput').value = bag.category || '';
  document.getElementById('descInput').value = bag.description || '';
  document.getElementById('priceInput').value = bag.price;
  setStockToForm(bag.stock || {});
  stagedImage = null;
  imagePreview.innerHTML = `<img src="${bag.image}" style="max-width:180px;border-radius:8px;">`;
  // Pre-populate stagedExtras from the bag's images[] (skip the lead image which is the main)
  stagedExtras = ((bag.images && bag.images.length > 1) ? bag.images.slice(1) : []).map(url => ({ url }));
  renderExtraImagesPreview();
  document.getElementById('formTitle').textContent = 'Edit item';
  document.getElementById('cancelBtn').style.display = 'inline-block';
  // Hide the IG quick-add panel + "OR enter manually" divider in edit mode —
  // they're irrelevant when editing and they push the populated inputs off-screen
  // on mobile, making it look like the Edit didn't work.
  const igPanel = document.getElementById('igQuickPanel');
  const manualDivider = document.getElementById('manualEntryDivider');
  if (igPanel) igPanel.style.display = 'none';
  if (manualDivider) manualDivider.style.display = 'none';
  // Scroll the form into view (instant — smooth-scroll over a long page adds a
  // confusing pause). Use the form title element so the "Edit item" h2 is at the top.
  document.getElementById('formTitle').scrollIntoView({ behavior: 'auto', block: 'start' });
}

async function deleteItem(id) {
  if (!await confirmAction('Delete this item? You can restore it from Trash below.', 'Delete')) return;
  let removed = null, removedIdx = -1;
  try {
    await apiMutateAndPublish(() => {
      removedIdx = bags.findIndex(b => b.id === id);
      removed = removedIdx === -1 ? null : bags[removedIdx];
      bags = bags.filter(b => b.id !== id);
    });
    if (removed) trashPush([{ item: removed, index: removedIdx }]);
    renderList();
    renderTrash();
    renderDashboard();
    renderInventory();
    showToast('Item deleted — restore it from Trash.');
  } catch (err) { showToast('Error: ' + err.message); }
}

// ====== RECORD SALE MODAL ======
const saleModal = document.getElementById('saleModal');
const saleSizeInput = document.getElementById('saleSizeInput');
const saleQtyInput = document.getElementById('saleQtyInput');
const salePriceInput = document.getElementById('salePriceInput');
const buyerName = document.getElementById('buyerName');
const buyerPhone = document.getElementById('buyerPhone');
const buyerNotes = document.getElementById('buyerNotes');

function openSaleModal(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  pendingSaleId = id;
  document.getElementById('saleModalTitle').textContent = `Record sale: ${bag.name}`;
  saleSizeInput.innerHTML = '';
  const stock = bag.stock || {};
  const hasSizes = Object.keys(stock).length > 0;
  if (hasSizes) {
    Object.entries(stock).filter(([, q]) => q > 0).forEach(([sz, q]) => {
      const opt = document.createElement('option');
      opt.value = sz;
      opt.textContent = `${sz} (${q} in stock)`;
      saleSizeInput.appendChild(opt);
    });
    if (!saleSizeInput.options.length) {
      showToast('All sizes are out of stock.'); return;
    }
  } else {
    const opt = document.createElement('option'); opt.value = 'One size'; opt.textContent = 'One size'; saleSizeInput.appendChild(opt);
  }
  saleQtyInput.value = 1;
  salePriceInput.value = bag.price;
  buyerName.value = '';
  buyerPhone.value = '';
  buyerNotes.value = '';
  saleModal.style.display = 'flex';
  buyerName.focus();
}

function closeSaleModal() { saleModal.style.display = 'none'; pendingSaleId = null; }

// withBuyer=false → record the sale and mark sold without capturing any buyer details (no GHL).
async function recordSale(withBuyer) {
  const targetId = pendingSaleId;
  const curBag = bags.find(b => b.id === targetId);
  if (!curBag) return;
  const size = saleSizeInput.value;
  const qty = parseInt(saleQtyInput.value, 10) || 1;
  const salePrice = parseInt(salePriceInput.value, 10) || curBag.price;
  const sale = {
    size,
    qty,
    salePrice,
    buyerName: withBuyer ? buyerName.value.trim() : '',
    buyerPhone: withBuyer ? buyerPhone.value.trim() : '',
    notes: withBuyer ? buyerNotes.value.trim() : '',
    soldAt: new Date().toISOString(),
  };
  closeSaleModal();
  try {
    let soldBag = null;
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === targetId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      // Reduce stock
      if (bag.stock && bag.stock[size] !== undefined) {
        bag.stock[size] = Math.max(0, bag.stock[size] - qty);
      }
      if (!bag.sales) bag.sales = [];
      bag.sales.push(sale);
      soldBag = bag;
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast(`Sale recorded — ${qty}× ${size} sold.`);
    if (withBuyer && (sale.buyerName || sale.buyerPhone)) sendBuyerToGHL(soldBag, sale);
  } catch (err) { showToast('Error: ' + err.message); }
}

document.getElementById('saleSaveBtn').addEventListener('click', () => recordSale(true));
document.getElementById('saleSkipBtn').addEventListener('click', () => recordSale(false));
document.getElementById('saleCancelBtn').addEventListener('click', closeSaleModal);
saleModal.addEventListener('click', e => { if (e.target === saleModal) closeSaleModal(); });

// ====== RESTOCK MODAL ======
const restockModal = document.getElementById('restockModal');
const restockSizeInput = document.getElementById('restockSizeInput');
const restockQtyInput = document.getElementById('restockQtyInput');

function openRestockModal(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  pendingRestockId = id;
  document.getElementById('restockModalTitle').textContent = `Restock: ${bag.name}`;
  restockSizeInput.innerHTML = '';
  const ALL_SIZES = ['XS','S','M','L','XL','XXL','3XL','28','30','32','34','36','38','40','UK6','UK7','UK8','UK9','UK10','UK11','UK12'];
  ALL_SIZES.forEach(sz => {
    const opt = document.createElement('option'); opt.value = sz;
    const cur = bag.stock?.[sz] || 0;
    opt.textContent = `${sz} (currently ${cur})`;
    restockSizeInput.appendChild(opt);
  });
  restockQtyInput.value = 5;
  restockModal.style.display = 'flex';
}

function closeRestockModal() { restockModal.style.display = 'none'; pendingRestockId = null; }

document.getElementById('restockSaveBtn').addEventListener('click', async () => {
  const targetId = pendingRestockId;
  const size = restockSizeInput.value;
  const qty = parseInt(restockQtyInput.value, 10) || 0;
  if (qty <= 0) { showToast('Enter a quantity to add.'); return; }
  closeRestockModal();
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === targetId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      if (!bag.stock) bag.stock = {};
      bag.stock[size] = (bag.stock[size] || 0) + qty;
    });
    renderList();
    renderInventory();
    showToast(`+${qty} ${size} added to stock.`);
  } catch (err) { showToast('Error: ' + err.message); }
});

document.getElementById('restockCancelBtn').addEventListener('click', closeRestockModal);
restockModal.addEventListener('click', e => { if (e.target === restockModal) closeRestockModal(); });

// ====== GHL INTEGRATION ======
const GHL_RECAPTCHA_KEY = '6LeDBFwpAAAAAJe8ux9-imrqZ2ueRsEtdiWoDDpX';
async function getCaptchaToken() {
  if (!window.grecaptcha?.enterprise) return '';
  return new Promise(resolve => {
    grecaptcha.enterprise.ready(async () => {
      try { resolve(await grecaptcha.enterprise.execute(GHL_RECAPTCHA_KEY, { action: 'submit' })); }
      catch (e) { resolve(''); }
    });
  });
}
async function sendBuyerToGHL(bag, sale) {
  try {
    const captchaV3 = await getCaptchaToken();
    await fetch(`${API_BASE}/api/buyer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sale.buyerName, phone: sale.buyerPhone,
        notes: sale.notes,
        bag_name: `${bag.name} (${sale.size})`,
        bag_price: sale.salePrice || bag.price,
        captchaV3,
      }),
    });
  } catch (err) { console.warn('GHL submit failed:', err); }
}

// ====== DASHBOARD ======
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
function startOfMonth(d) { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x; }
function relTime(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec/60) + 'm ago';
  if (sec < 86400) return Math.floor(sec/3600) + 'h ago';
  const days = Math.floor(sec/86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + 'd ago';
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function renderDashboard() {
  const now = new Date();
  const buckets = [
    { label: 'Today',      since: startOfDay(now) },
    { label: 'This week',  since: startOfWeek(now) },
    { label: 'This month', since: startOfMonth(now) },
    { label: 'All time',   since: null },
  ].map(b => {
    let count = 0, revenue = 0;
    bags.forEach(bag => {
      (bag.sales || []).forEach(s => {
        if (!b.since || new Date(s.soldAt) >= b.since) {
          count += Number(s.qty) || 1;
          revenue += (Number(s.salePrice || bag.price)) * (Number(s.qty) || 1);
        }
      });
    });
    return { ...b, count, revenue };
  });

  document.getElementById('kpiGrid').innerHTML = buckets.map(b => `
    <div class="kpi-card">
      <div class="kpi-label">${b.label}</div>
      <div class="kpi-count">${b.count} <span class="kpi-unit">units</span></div>
      <div class="kpi-revenue">${fmtKsh(b.revenue)}</div>
    </div>`).join('');

  // Top categories by units sold
  const catUnits = {}, catRev = {};
  bags.forEach(bag => {
    const cat = bag.category || 'Other';
    (bag.sales || []).forEach(s => {
      catUnits[cat] = (catUnits[cat] || 0) + (Number(s.qty) || 1);
      catRev[cat] = (catRev[cat] || 0) + (Number(s.salePrice || bag.price)) * (Number(s.qty) || 1);
    });
  });
  const cats = Object.entries(catUnits).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxU = cats[0]?.[1] || 1;
  document.getElementById('topCats').innerHTML = cats.length
    ? cats.map(([cat, n]) => `
        <div class="cat-bar">
          <div class="cat-bar-row"><span class="cat-bar-name">${escapeHtml(cat)}</span><span class="cat-bar-meta">${n} sold · ${fmtKsh(catRev[cat])}</span></div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(n/maxU)*100}%"></div></div>
        </div>`).join('')
    : '<p style="color:#999;font-size:13px;">No sales yet — record your first sale to populate.</p>';

  // Recent sales (all bags, last 6 individual sale records)
  const allSaleRecords = [];
  bags.forEach(bag => (bag.sales || []).forEach(s => allSaleRecords.push({ bag, s })));
  const recent = allSaleRecords.sort((a, b) => new Date(b.s.soldAt) - new Date(a.s.soldAt)).slice(0, 6);
  document.getElementById('recentSales').innerHTML = recent.length
    ? recent.map(({ bag, s }) => `
        <div class="recent-row">
          <img src="${bag.image}" alt="${escapeHtml(bag.name)}">
          <div style="flex:1;min-width:0;">
            <div class="recent-name">${escapeHtml(bag.name)} · ${escapeHtml(s.size || '')} × ${s.qty || 1}</div>
            <div class="recent-meta">${fmtKsh(s.salePrice || bag.price)} · ${s.buyerName ? escapeHtml(s.buyerName) : 'No buyer saved'} · ${relTime(s.soldAt)}</div>
          </div>
          <div class="recent-actions" style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-admin" style="padding:5px 11px;font-size:12px;" onclick="openEditSale('${bag.id}','${s.soldAt}')">Edit</button>
            <button class="btn-admin danger" style="padding:5px 11px;font-size:12px;" onclick="undoSale('${bag.id}','${s.soldAt}')">Undo</button>
          </div>
        </div>`).join('')
    : '<p style="color:#999;font-size:13px;">No sales recorded yet.</p>';
}

// ====== EDIT / UNDO RECORDED SALES ======
// Recent sales are editable: undo (restock + delete the record) or correct the
// size/qty/price/buyer. Mirrors the fleet standard "Recent sales must be editable".
let editingSale = null; // { bagId, soldAt }

async function undoSale(bagId, soldAt) {
  if (!await confirmAction('Undo this sale? The quantity goes back into stock.', 'Undo sale')) return;
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === bagId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      const idx = (bag.sales || []).findIndex(x => x.soldAt === soldAt);
      if (idx === -1) throw new Error('Sale not found — refresh admin');
      const s = bag.sales[idx];
      if (bag.stock && bag.stock[s.size] !== undefined) {
        bag.stock[s.size] = (Number(bag.stock[s.size]) || 0) + (Number(s.qty) || 1);
      }
      bag.sales.splice(idx, 1);
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast('Sale undone, stock restored.');
  } catch (err) { showToast('Error: ' + err.message); }
}

function openEditSale(bagId, soldAt) {
  const bag = bags.find(b => b.id === bagId);
  if (!bag) return;
  const s = (bag.sales || []).find(x => x.soldAt === soldAt);
  if (!s) return;
  editingSale = { bagId, soldAt };
  document.getElementById('editSaleTitle').textContent = `Edit sale: ${bag.name}`;
  document.getElementById('editSaleSize').value = s.size || '';
  document.getElementById('editSaleQty').value = s.qty || 1;
  document.getElementById('editSalePrice').value = (s.salePrice != null ? s.salePrice : bag.price) || 0;
  document.getElementById('editBuyerName').value = s.buyerName || '';
  document.getElementById('editBuyerPhone').value = s.buyerPhone || '';
  document.getElementById('editBuyerNotes').value = s.notes || '';
  document.getElementById('editSaleModal').style.display = 'flex';
}

function closeEditSale() { document.getElementById('editSaleModal').style.display = 'none'; editingSale = null; }

document.getElementById('editSaleSaveBtn').addEventListener('click', async () => {
  if (!editingSale) return;
  const { bagId, soldAt } = editingSale;
  // Read form values now (DOM); apply against the FRESH sale record in the mutator.
  const formSize = document.getElementById('editSaleSize').value.trim();
  const newQty = parseInt(document.getElementById('editSaleQty').value, 10) || 1;
  const formPrice = parseInt(document.getElementById('editSalePrice').value, 10);
  const newBuyerName = document.getElementById('editBuyerName').value.trim();
  const newBuyerPhone = document.getElementById('editBuyerPhone').value.trim();
  const newNotes = document.getElementById('editBuyerNotes').value.trim();
  closeEditSale();
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === bagId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      const s = (bag.sales || []).find(x => x.soldAt === soldAt);
      if (!s) throw new Error('Sale not found — refresh admin');
      const newSize = formSize || s.size;
      const newPrice = isNaN(formPrice) ? (s.salePrice != null ? s.salePrice : bag.price) : formPrice;
      // Correct stock: put the old quantity back, then take the new quantity out.
      if (bag.stock) {
        if (bag.stock[s.size] !== undefined) bag.stock[s.size] = (Number(bag.stock[s.size]) || 0) + (Number(s.qty) || 1);
        if (bag.stock[newSize] !== undefined) bag.stock[newSize] = Math.max(0, (Number(bag.stock[newSize]) || 0) - newQty);
      }
      s.size = newSize;
      s.qty = newQty;
      s.salePrice = newPrice;
      s.buyerName = newBuyerName;
      s.buyerPhone = newBuyerPhone;
      s.notes = newNotes;
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast('Sale updated.');
  } catch (err) { showToast('Error: ' + err.message); }
});
document.getElementById('editSaleCancelBtn').addEventListener('click', closeEditSale);
document.getElementById('editSaleModal').addEventListener('click', e => { if (e.target.id === 'editSaleModal') closeEditSale(); });

// ====== INVENTORY ======
// State for the inventory table view
let invFilter = 'attention'; // 'attention' | 'all'
let invShowAll = false;       // false = cap at INV_PAGE_SIZE
const INV_PAGE_SIZE = 15;

function renderInventory() {
  let totalItems = bags.length;
  let totalUnits = 0, totalValue = 0, lowStock = 0, outOfStock = 0;

  bags.forEach(bag => {
    const units = totalStock(bag);
    totalUnits += units;
    totalValue += units * (bag.price || 0);
    if (units === 0) outOfStock++;
    else if (units <= 5) lowStock++;
  });

  document.getElementById('invKpiGrid').innerHTML = [
    { label: 'Total items', val: totalItems, sub: 'SKUs listed', cls: '' },
    { label: 'Units in stock', val: totalUnits.toLocaleString(), sub: 'across all sizes', cls: 'success' },
    { label: 'Inventory value', val: fmtKsh(totalValue), sub: 'at listed prices', cls: '' },
    { label: 'Low stock', val: lowStock, sub: '≤ 5 units remaining', cls: lowStock > 0 ? 'warn' : '' },
    { label: 'Out of stock', val: outOfStock, sub: 'need restocking', cls: outOfStock > 0 ? 'danger' : '' },
  ].map(k => `
    <div class="inv-kpi ${k.cls}">
      <div class="inv-kpi-label">${k.label}</div>
      <div class="inv-kpi-val">${k.val}</div>
      <div class="inv-kpi-sub">${k.sub}</div>
    </div>`).join('');

  // Build the filter bar
  const attentionBags = bags.filter(b => totalStock(b) <= 5);
  const filterBar = document.getElementById('invFilterBar');
  if (filterBar) {
    filterBar.innerHTML = `
      <button class="pill ${invFilter==='attention'?'active':''}" data-inv-filter="attention">
        Needs attention <span class="admin-nav-count">${attentionBags.length}</span>
      </button>
      <button class="pill ${invFilter==='all'?'active':''}" data-inv-filter="all">
        All items <span class="admin-nav-count">${bags.length}</span>
      </button>
    `;
    filterBar.querySelectorAll('[data-inv-filter]').forEach(b => {
      b.addEventListener('click', () => {
        invFilter = b.dataset.invFilter;
        invShowAll = false;
        renderInventory();
      });
    });
  }

  // Apply filter, sort by lowest stock first
  const filtered = (invFilter === 'attention' ? attentionBags : bags)
    .slice()
    .sort((a, b) => totalStock(a) - totalStock(b));

  // Cap rendering unless showAll is set
  const cap = invShowAll ? filtered.length : Math.min(INV_PAGE_SIZE, filtered.length);
  const sorted = filtered.slice(0, cap);

  // Update sort/count label
  const lbl = document.getElementById('invSortLabel');
  if (lbl) lbl.textContent = `showing ${sorted.length} of ${filtered.length} · sorted low → high`;

  document.getElementById('invTableBody').innerHTML = sorted.map(bag => {
    const units = totalStock(bag);
    const soldUnits = totalUnitsSold(bag);
    const stockEntries = Object.entries(bag.stock || {});
    const stockCells = stockEntries.length
      ? stockEntries.map(([sz, q]) => {
          const cls = q === 0 ? 'zero' : q <= 3 ? 'low' : 'ok';
          return `<span class="stock-cell ${cls}">${escapeHtml(sz)}: ${q}</span>`;
        }).join('')
      : '<span style="color:#999;font-size:12px;">No sizes set</span>';

    const statusCls = units === 0 ? 'zero' : units <= 5 ? 'low' : 'ok';
    const statusLabel = units === 0 ? 'Out of stock' : units <= 5 ? 'Low stock' : 'In stock';

    return `
    <tr>
      <td><img class="item-img" src="${bag.image}" alt="${escapeHtml(bag.name)}"></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${escapeHtml(bag.name)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">${soldUnits} sold · ${fmtKsh(totalRevenue(bag))} revenue</div>
      </td>
      <td style="font-size:13px;">${escapeHtml(bag.category || '—')}</td>
      <td style="font-size:13px;font-weight:600;">${fmtKsh(bag.price)}</td>
      <td><div class="stock-cells">${stockCells}</div></td>
      <td style="font-weight:700;font-size:14px;">${units}</td>
      <td><span class="stock-pill ${statusCls}">${statusLabel}</span></td>
      <td>
        <button class="restock-btn" onclick="openRestockModal('${bag.id}')">+ Restock</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-faint);">${invFilter === 'attention' ? '🎉 Nothing needs attention — all items have healthy stock.' : 'No items yet.'}</td></tr>`;

  // Show-more toggle
  const toggle = document.getElementById('invShowMore');
  if (toggle) {
    if (filtered.length <= INV_PAGE_SIZE) {
      toggle.style.display = 'none';
    } else {
      toggle.style.display = 'block';
      toggle.textContent = invShowAll
        ? `Show fewer (top ${INV_PAGE_SIZE})`
        : `Show all ${filtered.length} items ↓`;
      toggle.onclick = () => { invShowAll = !invShowAll; renderInventory(); };
    }
  }
}

// ====== ITEM LIST ======
let bulkSelected = new Set();

let adminItemSearch = '';
function renderList() {
  const list = document.getElementById('adminList');
  document.getElementById('bagCount').textContent = bags.length;
  const navCount = document.getElementById('navItemCount');
  if (navCount) navCount.textContent = bags.length;
  renderBulkBar();
  // Filter by search query — name + category match (case-insensitive)
  const q = adminItemSearch.trim().toLowerCase();
  const filtered = q
    ? bags.filter(b => `${b.name} ${b.category || ''}`.toLowerCase().includes(q))
    : bags;
  // Update search count line
  const countEl = document.getElementById('adminItemSearchCount');
  if (countEl) countEl.textContent = q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : '';
  list.innerHTML = filtered.map(bag => {
    const units = totalStock(bag);
    const sold = totalUnitsSold(bag);
    const stockSummary = Object.entries(bag.stock || {}).map(([sz, q]) => `${sz}:${q}`).join(' · ') || 'No stock set';
    const checked = bulkSelected.has(bag.id);
    return `
    <div class="admin-card ${checked ? 'bulk-selected' : ''}">
      <label class="bulk-check" title="Select for bulk actions">
        <input type="checkbox" data-bulk="${escapeHtml(bag.id)}" ${checked ? 'checked' : ''}>
      </label>
      <img src="${bag.image}" alt="${escapeHtml(bag.name)}">
      <div class="admin-card-body">
        <div class="admin-card-name">${escapeHtml(bag.name)}</div>
        ${bag.category ? `<div class="admin-card-cat-row" style="margin:3px 0;"><span style="background:#f0ede8;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">${escapeHtml(bag.category)}</span></div>` : ''}
        <div class="admin-card-price">${fmtKsh(bag.price)}<span class="admin-card-mobile-stock"> · ${units} in stock</span></div>
        <div class="admin-card-stock">${units} in stock · ${sold} sold | ${stockSummary}</div>
        <div class="admin-card-actions">
          <button onclick="editItem('${bag.id}')">Edit</button>
          <button onclick="openSaleModal('${bag.id}')" style="background:#f0faf4;border-color:#b0d8c0;color:#1a7a40;">Sell</button>
          <button onclick="openRestockModal('${bag.id}')">Restock</button>
          <button class="danger" onclick="deleteItem('${bag.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Wire up the new checkboxes
  list.querySelectorAll('input[data-bulk]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) bulkSelected.add(cb.dataset.bulk);
      else bulkSelected.delete(cb.dataset.bulk);
      cb.closest('.admin-card').classList.toggle('bulk-selected', cb.checked);
      renderBulkBar();
    });
  });
}

function renderBulkBar() {
  const bar = document.getElementById('bulkActions');
  if (!bar) return;
  if (bulkSelected.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('bulkCount').textContent = bulkSelected.size;
}

function bulkClear() { bulkSelected.clear(); renderList(); }

function bulkSelectAll() {
  bags.forEach(b => bulkSelected.add(b.id));
  renderList();
}

async function bulkDelete() {
  if (!await confirmAction(`Delete ${bulkSelected.size} item(s)? You can restore them from Trash below.`, 'Delete')) return;
  const ids = new Set(bulkSelected);
  bulkSelected.clear();
  let removed = [];
  try {
    await apiMutateAndPublish(() => {
      removed = [];
      bags.forEach((b, i) => { if (ids.has(b.id)) removed.push({ item: b, index: i }); });
      bags = bags.filter(b => !ids.has(b.id));
    });
    trashPush(removed);
    renderList();
    renderTrash();
    renderInventory();
    renderDashboard();
    showToast('Deleted — restore from Trash.');
  } catch (err) {
    showToast('Sync failed: ' + err.message);
  }
}

async function bulkSetCategory() {
  const cat = await chooseCategory();
  if (!cat) return;
  const ids = new Set(bulkSelected);
  const n = ids.size;
  try {
    await apiMutateAndPublish(() => {
      bags.forEach(b => { if (ids.has(b.id)) b.category = cat; });
    });
    bulkSelected.clear();
    renderList();
    renderInventory();
    showToast(`Set ${n} item(s) to "${cat}".`);
  } catch (err) {
    showToast('Sync failed: ' + err.message);
  }
}


// ====== TRASH (device-local restore bin) ======
// Deleted items are stashed in localStorage so they can be restored. Kept off the
// server so the public /api/bags never sees them; image blobs stay in KV, so a
// restored item's image URL still resolves. Stored per device only.
const TRASH_KEY = 'martinblack_trash';
const TRASH_CAP = 50;

function getTrash() {
  try { return JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); } catch { return []; }
}
function setTrash(arr) { localStorage.setItem(TRASH_KEY, JSON.stringify(arr.slice(0, TRASH_CAP))); }
function trashPush(items) {
  // items: [{ item, index }] — index = position in bags at delete time, for in-place restore
  const now = new Date().toISOString();
  const entries = items.filter(x => x && x.item).map(({ item, index }) => ({ item, index, deletedAt: now }));
  setTrash([...entries, ...getTrash()]);
}

function trashTimeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

function renderTrash() {
  const list = document.getElementById('trashList');
  if (!list) return;
  const trash = getTrash();
  const countEl = document.getElementById('trashCount');
  const navCount = document.getElementById('navTrashCount');
  if (countEl) countEl.textContent = trash.length;
  if (navCount) navCount.textContent = trash.length;
  const emptyBtn = document.getElementById('emptyTrashBtn');
  if (emptyBtn) emptyBtn.style.display = trash.length ? '' : 'none';
  if (!trash.length) {
    list.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:10px 2px;">Trash is empty. Deleted items land here so you can restore them. Stored on this device only.</p>';
    return;
  }
  list.innerHTML = trash.map(({ item, deletedAt }) => `
    <div class="admin-card">
      <img src="${item.image}" alt="${escapeHtml(item.name)}">
      <div class="admin-card-body">
        <div class="admin-card-name">${escapeHtml(item.name)}</div>
        <div class="admin-card-stock">${escapeHtml(item.category || 'Uncategorised')} · deleted ${trashTimeAgo(deletedAt)}</div>
        <div class="admin-card-actions">
          <button class="primary" onclick="restoreItem('${item.id}')">Restore</button>
          <button class="danger" onclick="deleteForever('${item.id}')">Delete forever</button>
        </div>
      </div>
    </div>`).join('');
}

async function restoreItem(id) {
  const trash = getTrash();
  const idx = trash.findIndex(t => t.item && t.item.id === id);
  if (idx === -1) return;
  const entry = trash[idx];
  let alreadyThere = false;
  try {
    await apiMutateAndPublish(() => {
      if (bags.some(b => b.id === id)) { alreadyThere = true; return; }
      const at = Math.min(typeof entry.index === 'number' ? entry.index : bags.length, bags.length);
      bags.splice(at, 0, entry.item);
    });
    trash.splice(idx, 1); setTrash(trash);
    renderList();
    renderTrash();
    renderInventory();
    renderDashboard();
    showToast(alreadyThere ? 'Already in the catalog — cleared from Trash.' : 'Item restored to the catalog.');
  } catch (err) {
    showToast('Restore failed: ' + err.message);
  }
}

async function deleteForever(id) {
  if (!await confirmAction('Permanently remove this from Trash? It cannot be restored after this.', 'Delete forever')) return;
  setTrash(getTrash().filter(t => !(t.item && t.item.id === id)));
  renderTrash();
  showToast('Removed from Trash.');
}

async function emptyTrash() {
  const n = getTrash().length;
  if (!n) return;
  if (!await confirmAction(`Empty Trash? ${n} item${n === 1 ? '' : 's'} will be gone for good.`, 'Empty trash')) return;
  setTrash([]);
  renderTrash();
  showToast('Trash emptied.');
}

// ====== INIT ======
window.editItem = editItem;
window.deleteItem = deleteItem;
window.openSaleModal = openSaleModal;
window.openRestockModal = openRestockModal;
window.bulkClear = bulkClear;
window.bulkSelectAll = bulkSelectAll;
window.bulkDelete = bulkDelete;
window.bulkSetCategory = bulkSetCategory;
window.restoreItem = restoreItem;
window.deleteForever = deleteForever;
window.emptyTrash = emptyTrash;

// ====== WHATSAPP BROADCAST ======
let broadcastSelectedIds = [];
let broadcastRecipientsState = {};  // phone -> { name, included }

function pastBuyers() {
  // Unique past buyers from sales history, carrying the (category, size) pairs each
  // one bought so the broadcast can be segmented (e.g. everyone who bought Jeans, or
  // size 34). Keeps the most-recent buyer name + last item for display.
  const map = new Map();
  for (const bag of bags) {
    for (const s of (bag.sales || [])) {
      if (!s.buyerPhone) continue;
      const phone = String(s.buyerPhone).replace(/[^0-9]/g, '');
      if (phone.length < 9) continue;
      const soldAt = new Date(s.soldAt || 0).getTime();
      let e = map.get(phone);
      if (!e) { e = { phone, name: '', soldAt: -1, lastBought: '', buys: [] }; map.set(phone, e); }
      e.buys.push({ cat: bag.category || '', size: s.size || '' });
      if (soldAt >= e.soldAt) { e.soldAt = soldAt; e.lastBought = bag.name; if (s.buyerName) e.name = s.buyerName; }
      else if (!e.name && s.buyerName) e.name = s.buyerName;
    }
  }
  return [...map.values()].sort((a, b) => b.soldAt - a.soldAt);
}

// ===== Broadcast segmentation: filter recipients by category + size =====
let broadcastFilterCat = 'all';
let broadcastFilterSize = 'all';

function broadcastSortSizes(arr) {
  return arr.sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b));
  });
}
function buyerMatchesFilter(b) {
  return (b.buys || []).some(x =>
    (broadcastFilterCat === 'all' || x.cat === broadcastFilterCat) &&
    (broadcastFilterSize === 'all' || x.size === broadcastFilterSize));
}
function soldCategories() {
  const set = new Set();
  bags.forEach(b => { if (b.category && (b.sales || []).length) set.add(b.category); });
  return [...set].sort();
}
function soldSizes(cat) {
  const set = new Set();
  bags.forEach(b => { if (cat !== 'all' && b.category !== cat) return; (b.sales || []).forEach(s => { if (s.size) set.add(s.size); }); });
  return broadcastSortSizes([...set]);
}
function populateBroadcastFilters() {
  const catSel = document.getElementById('broadcastFilterCat');
  const sizeSel = document.getElementById('broadcastFilterSize');
  if (!catSel || !sizeSel) return;
  const cats = soldCategories();
  if (broadcastFilterCat !== 'all' && !cats.includes(broadcastFilterCat)) broadcastFilterCat = 'all';
  catSel.innerHTML = `<option value="all">Any category</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = broadcastFilterCat;
  const sizes = soldSizes(broadcastFilterCat);
  if (broadcastFilterSize !== 'all' && !sizes.includes(broadcastFilterSize)) broadcastFilterSize = 'all';
  sizeSel.innerHTML = `<option value="all">Any size</option>` + sizes.map(s => `<option value="${escapeHtml(s)}">size ${escapeHtml(s)}</option>`).join('');
  sizeSel.value = broadcastFilterSize;
}
document.getElementById('broadcastFilterCat')?.addEventListener('change', e => {
  broadcastFilterCat = e.target.value;
  broadcastFilterSize = 'all'; // sizes are category-specific — reset when category changes
  populateBroadcastFilters();
  renderBroadcastRecipients();
});
document.getElementById('broadcastFilterSize')?.addEventListener('change', e => {
  broadcastFilterSize = e.target.value;
  renderBroadcastRecipients();
});

function renderBroadcastSelected() {
  const wrap = document.getElementById('broadcastSelectedItems');
  if (!wrap) return;
  if (!broadcastSelectedIds.length) { wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;margin:6px 0;">No items selected — message will be text-only.</p>'; return; }
  wrap.innerHTML = broadcastSelectedIds.map(id => {
    const b = bags.find(x => x.id === id);
    if (!b) return '';
    return `<div class="set-chip"><img src="${b.image}" alt=""><span>${escapeHtml(b.name)}</span><button data-bc-remove="${escapeHtml(id)}" aria-label="Remove">×</button></div>`;
  }).join('');
  wrap.querySelectorAll('[data-bc-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      broadcastSelectedIds = broadcastSelectedIds.filter(id => id !== btn.dataset.bcRemove);
      renderBroadcastSelected();
      renderBroadcastPicker();
      renderBroadcastPreview();
    });
  });
}

function renderBroadcastPicker() {
  const picker = document.getElementById('broadcastItemPicker');
  if (!picker) return;
  const q = (document.getElementById('broadcastItemSearch')?.value || '').toLowerCase().trim();
  const matches = bags
    .filter(b => !broadcastSelectedIds.includes(b.id))
    .filter(b => !q || `${b.name} ${b.category || ''}`.toLowerCase().includes(q))
    .slice(0, 40);
  picker.innerHTML = matches.length
    ? matches.map(b => `
        <button class="set-pick" data-bc-add="${escapeHtml(b.id)}" type="button">
          <img src="${b.image}" alt="">
          <div class="set-pick-body">
            <div class="set-pick-name">${escapeHtml(b.name)}</div>
            <div class="set-pick-meta">${escapeHtml(b.category || '')}${b.price > 0 ? ' · ' + fmtKsh(b.price) : ''}</div>
          </div>
        </button>`).join('')
    : '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No matches.</p>';
  picker.querySelectorAll('[data-bc-add]').forEach(b => {
    b.addEventListener('click', () => {
      broadcastSelectedIds.push(b.dataset.bcAdd);
      renderBroadcastSelected();
      renderBroadcastPicker();
      renderBroadcastPreview();
    });
  });
}

function renderBroadcastRecipients() {
  const wrap = document.getElementById('broadcastRecipients');
  if (!wrap) return;
  populateBroadcastFilters();
  const all = pastBuyers();
  // Initialize state for new buyers (manual deselects persist across filter changes)
  for (const b of all) {
    if (!(b.phone in broadcastRecipientsState)) {
      broadcastRecipientsState[b.phone] = { name: b.name, included: true };
    }
  }
  const buyers = all.filter(buyerMatchesFilter);
  const matchEl = document.getElementById('broadcastFilterMatch');
  if (matchEl) {
    const seg = (broadcastFilterCat === 'all' && broadcastFilterSize === 'all')
      ? 'all buyers'
      : [broadcastFilterCat === 'all' ? null : broadcastFilterCat, broadcastFilterSize === 'all' ? null : 'size ' + broadcastFilterSize].filter(Boolean).join(' · ');
    matchEl.textContent = `${buyers.length} ${buyers.length === 1 ? 'buyer' : 'buyers'}${seg === 'all buyers' ? '' : ' · ' + seg}`;
  }
  if (!all.length) {
    wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No past buyers yet — once you record sales with buyer phones, they\'ll show up here.</p>';
    return;
  }
  if (!buyers.length) {
    wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No past buyers match this segment. Widen the category or size above.</p>';
    return;
  }
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button class="btn-admin" type="button" data-bc-recip="all" style="padding:4px 10px;font-size:11px;">Select all</button>
      <button class="btn-admin" type="button" data-bc-recip="none" style="padding:4px 10px;font-size:11px;">Deselect all</button>
      <span style="font-size:12px;color:var(--ink-faint);margin-left:auto;align-self:center;" id="broadcastSelectedCount"></span>
    </div>
    ${buyers.map(b => {
      const st = broadcastRecipientsState[b.phone];
      return `
        <label class="broadcast-recipient${st.included ? ' on' : ''}">
          <input type="checkbox" data-bc-toggle="${b.phone}" ${st.included ? 'checked' : ''}>
          <span class="broadcast-recipient-name">${escapeHtml(b.name || 'Unknown buyer')}</span>
          <span class="broadcast-recipient-phone">+${b.phone}</span>
          <span class="broadcast-recipient-meta">last: ${escapeHtml(b.lastBought)}</span>
        </label>`;
    }).join('')}
  `;
  wrap.querySelectorAll('[data-bc-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      broadcastRecipientsState[cb.dataset.bcToggle].included = cb.checked;
      cb.closest('.broadcast-recipient').classList.toggle('on', cb.checked);
      updateBroadcastCount();
    });
  });
  wrap.querySelectorAll('[data-bc-recip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.bcRecip === 'all';
      buyers.forEach(b => { broadcastRecipientsState[b.phone].included = on; });
      renderBroadcastRecipients();
    });
  });
  updateBroadcastCount();
}

function updateBroadcastCount() {
  const el = document.getElementById('broadcastSelectedCount');
  if (!el) return;
  const n = Object.values(broadcastRecipientsState).filter(s => s.included).length;
  el.textContent = `${n} selected`;
}

function buildBroadcastMessage(recipientName) {
  const subject = (document.getElementById('broadcastSubject')?.value || '').trim();
  const items = broadcastSelectedIds.map(id => bags.find(b => b.id === id)).filter(Boolean);
  const itemsBlock = items.length
    ? '\n\n' + items.map((b, i) => `${i + 1}. *${b.name}*${b.price > 0 ? ' — ' + fmtKsh(b.price) : ''}`).join('\n')
    : '';
  const lookUrl = 'https://martin-black.essenceautomations.com';
  const greet = recipientName ? `Hi ${recipientName.split(' ')[0]}! ` : 'Hi! ';
  return `${greet}It's Martin Black — ${subject || 'fresh stock just landed'}.${itemsBlock}\n\nTap to browse: ${lookUrl}\n\nReply here to enquire. 🤍`;
}

function renderBroadcastPreview() {
  const preview = document.getElementById('broadcastPreview');
  if (!preview) return;
  preview.value = buildBroadcastMessage('{First name}');
}

document.getElementById('broadcastSubject')?.addEventListener('input', renderBroadcastPreview);
document.getElementById('broadcastItemSearch')?.addEventListener('input', renderBroadcastPicker);

document.getElementById('broadcastCopyBtn')?.addEventListener('click', () => {
  navigator.clipboard.writeText(buildBroadcastMessage(''));
  showToast('Message copied — paste it into your WhatsApp broadcast.');
});

// On phones the multi-window approach fails: only the first wa.me link fires before
// the browser is backgrounded by the WhatsApp app, and you can only be in one chat
// at a time. So mobile gets a one-at-a-time stepper; desktop keeps the multi-tab open.
const BC_PROG_KEY = 'martinblack_bcprog';
let bcQueue = [];   // [{ phone, name }]
let bcIdx = 0;
function saveBcProgress() { try { localStorage.setItem(BC_PROG_KEY, JSON.stringify({ q: bcQueue, i: bcIdx })); } catch (_) {} }
function clearBcProgress() { try { localStorage.removeItem(BC_PROG_KEY); } catch (_) {} bcQueue = []; bcIdx = 0; }

function renderBroadcastStepper() {
  const el = document.getElementById('broadcastStepper');
  if (!el) return;
  if (!bcQueue.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  if (bcIdx >= bcQueue.length) {
    el.style.display = 'block';
    el.innerHTML = `<div class="bc-step-done">✓ Done — stepped through all ${bcQueue.length} buyer${bcQueue.length === 1 ? '' : 's'}. <button class="btn-admin" id="bcStepClose" type="button">Close</button></div>`;
    document.getElementById('bcStepClose').addEventListener('click', () => { clearBcProgress(); renderBroadcastStepper(); });
    return;
  }
  const r = bcQueue[bcIdx];
  const href = `https://wa.me/${r.phone}?text=${encodeURIComponent(buildBroadcastMessage(r.name))}`;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="bc-step-head">Sending ${bcIdx + 1} of ${bcQueue.length}</div>
    <div class="bc-step-name">${escapeHtml(r.name || 'Unknown buyer')} · +${escapeHtml(r.phone)}</div>
    <div class="bc-step-actions">
      <a class="btn-admin gold" id="bcStepOpen" href="${href}" target="_blank" rel="noopener">Open WhatsApp &amp; send →</a>
      <button class="btn-admin" id="bcStepNext" type="button">Sent ✓ · Next ▸</button>
      <button class="btn-admin" id="bcStepSkip" type="button">Skip</button>
      <button class="btn-admin danger" id="bcStepStop" type="button">Stop</button>
    </div>
    <div class="bc-step-hint">Tap <strong>Open WhatsApp</strong>, press send inside WhatsApp, come back here and tap <strong>Sent ✓ · Next</strong>. Your place is saved if you get interrupted.</div>`;
  document.getElementById('bcStepNext').addEventListener('click', () => { bcIdx++; saveBcProgress(); renderBroadcastStepper(); });
  document.getElementById('bcStepSkip').addEventListener('click', () => { bcIdx++; saveBcProgress(); renderBroadcastStepper(); });
  document.getElementById('bcStepStop').addEventListener('click', () => { clearBcProgress(); renderBroadcastStepper(); showToast('Sending stopped.'); });
}

function restoreBcProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(BC_PROG_KEY) || 'null');
    if (p && Array.isArray(p.q) && p.q.length && p.i < p.q.length) { bcQueue = p.q; bcIdx = p.i; renderBroadcastStepper(); }
    else clearBcProgress();
  } catch (_) {}
}

const BC_IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

document.getElementById('broadcastStartBtn')?.addEventListener('click', async () => {
  const recipients = pastBuyers().filter(b => buyerMatchesFilter(b) && broadcastRecipientsState[b.phone]?.included);
  if (!recipients.length) { showToast('Pick at least one recipient.'); return; }
  if (BC_IS_MOBILE) {
    if (!await confirmAction(`Send to ${recipients.length} buyer${recipients.length === 1 ? '' : 's'}, one at a time. For each: tap Open WhatsApp, send, come back, tap Next. OK?`, 'Start')) return;
    bcQueue = recipients.map(r => ({ phone: r.phone, name: r.name }));
    bcIdx = 0;
    saveBcProgress();
    renderBroadcastStepper();
    document.getElementById('broadcastStepper').scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }
  if (!await confirmAction(`Open ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}, one per buyer. Send each one manually. OK?`)) return;
  let i = 0;
  function next() {
    if (i >= recipients.length) {
      document.getElementById('broadcastStatus').textContent = `✓ Opened ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}.`;
      return;
    }
    const r = recipients[i++];
    const msg = buildBroadcastMessage(r.name);
    window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(msg)}`, '_blank');
    document.getElementById('broadcastStatus').textContent = `Opening ${i} of ${recipients.length}…`;
    setTimeout(next, 700);
  }
  next();
});
restoreBcProgress();

// ====== INSIGHTS (per-browser localStorage from the public site) ======
const INSIGHTS_KEY = 'martinblack_analytics';
function loadInsights() {
  try { return JSON.parse(localStorage.getItem(INSIGHTS_KEY) || '{}'); } catch { return {}; }
}
function renderInsights() {
  const stats = loadInsights();
  const grid = document.getElementById('insightsKpiGrid');
  if (!grid) return;

  const total = (map = {}) => Object.values(map).reduce((a, b) => a + b, 0);
  grid.innerHTML = [
    { label: 'Item views', val: total(stats.itemViews), sub: 'lightbox opens' },
    { label: 'Enquiries', val: total(stats.itemEnquiries), sub: 'WhatsApp clicks', cls: 'success' },
    { label: 'Saved (heart)', val: total(stats.itemWishlist), sub: 'wishlist adds' },
    { label: 'IG clicks', val: total(stats.itemIgClicks), sub: 'View on IG taps' },
  ].map(k => `
    <div class="inv-kpi ${k.cls || ''}">
      <div class="inv-kpi-label">${k.label}</div>
      <div class="inv-kpi-val">${(k.val || 0).toLocaleString()}</div>
      <div class="inv-kpi-sub">${k.sub}</div>
    </div>`).join('');

  function topItems(map = {}, n = 6) {
    return Object.entries(map)
      .map(([id, count]) => ({ id, count, bag: bags.find(b => b.id === id) }))
      .filter(x => x.bag)
      .sort((a, b) => b.count - a.count).slice(0, n);
  }
  function renderTopList(list, emptyMsg) {
    if (!list.length) return `<p style="color:#999;font-size:13px;">${emptyMsg}</p>`;
    return list.map(x => `
      <div class="recent-row">
        <img src="${x.bag.image}" alt="${escapeHtml(x.bag.name)}">
        <div class="recent-body">
          <div class="recent-name">${escapeHtml(x.bag.name)}</div>
          <div class="recent-meta">${x.count} ${x.count === 1 ? 'time' : 'times'} · ${escapeHtml(x.bag.category || '')}</div>
        </div>
      </div>`).join('');
  }
  document.getElementById('insightsTopViews').innerHTML = renderTopList(topItems(stats.itemViews), 'No views yet.');
  document.getElementById('insightsTopEnquiries').innerHTML = renderTopList(topItems(stats.itemEnquiries), 'No enquiries yet.');

  // Search gaps — top no-result queries
  const gapsEl = document.getElementById('insightsSearchGaps');
  const gaps = Object.entries(stats.searchNoResults || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  gapsEl.innerHTML = gaps.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${gaps.map(([q, n]) => `<span class="search-gap-pill"><strong>"${escapeHtml(q)}"</strong> · ${n}×</span>`).join('')}</div>`
    : '<p style="color:#999;font-size:13px;">No empty searches yet — shoppers find what they look for.</p>';
}

document.getElementById('insightsResetBtn')?.addEventListener('click', async () => {
  if (!await confirmAction('Reset all insights on this device? This only affects this browser.')) return;
  localStorage.removeItem(INSIGHTS_KEY);
  renderInsights();
  showToast('Insights reset on this device.');
});

// Admin item search — debounced
const adminItemSearchInput = document.getElementById('adminItemSearch');
let adminSearchTimer;
adminItemSearchInput?.addEventListener('input', () => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => {
    adminItemSearch = adminItemSearchInput.value;
    renderList();
  }, 160);
});

// ====== INSTAGRAM BULK SYNC ======
// Mandatory companion to the per-post IG quick-add — owner clicks "Check for
// new posts", reviews AI-classified previews, then commits the approved
// subset. Dedupe is server-side by `ig_<shortcode>` so the button is
// idempotent and never re-adds an item already in the catalog.
const IG_USER_ID = '6327094556';
const MENSWEAR_CATEGORIES = ['Sneakers', 'Sports/Athletic', 'Boots', 'Loafers', 'Formal', 'Slides', 'Other'];

let igSyncCandidates = [];

const igSyncCheckBtn = document.getElementById('igSyncCheckBtn');
const igSyncCommitBtn = document.getElementById('igSyncCommitBtn');
const igSyncCancelBtn = document.getElementById('igSyncCancelBtn');
const igSyncStatus = document.getElementById('igSyncStatus');
const igSyncListEl = document.getElementById('igSyncList');
const igSyncCommitRow = document.getElementById('igSyncCommitRow');

igSyncCheckBtn?.addEventListener('click', checkForNewIgPosts);
igSyncCancelBtn?.addEventListener('click', resetIgSync);
igSyncCommitBtn?.addEventListener('click', commitIgSync);

async function checkForNewIgPosts() {
  igSyncCheckBtn.disabled = true;
  igSyncStatus.textContent = 'Checking Instagram…';
  igSyncListEl.innerHTML = '';
  igSyncCommitRow.style.display = 'none';
  try {
    const res = await fetch(`${API_BASE}/api/ig-discover?user_id=${IG_USER_ID}&limit=20`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    igSyncCandidates = data.items || [];
    if (!igSyncCandidates.length) {
      igSyncStatus.textContent = '✓ Catalog is up to date. No new posts on Instagram.';
      igSyncCheckBtn.disabled = false;
      return;
    }
    igSyncStatus.textContent = `Found ${igSyncCandidates.length} new post${igSyncCandidates.length === 1 ? '' : 's'}. Review below, then add.`;
    renderIgSyncList();
    igSyncCommitRow.style.display = 'flex';
  } catch (err) {
    igSyncStatus.textContent = '✗ ' + err.message;
  } finally {
    igSyncCheckBtn.disabled = false;
  }
}

function renderIgSyncList() {
  igSyncListEl.innerHTML = igSyncCandidates.map((it, i) => {
    const s = it.suggested || {};
    // Martin Black is NEW-STOCK: stock is { "M":1, "L":1, "XL":1 } etc. Show every
    // detected size as a comma-list so the owner sees the full SKU array at
    // a glance ("M, L, XL" not "M×1 · L×1 · XL×1" — too noisy when most are 1).
    const stockKeys = Object.keys(s.stock || {});
    const stockText = stockKeys.length ? stockKeys.join(', ') : 'One Size';
    const captionShort = (it.caption || '').replace(/\s+/g, ' ').slice(0, 120);
    const catOpts = MENSWEAR_CATEGORIES.map(c => `<option value="${c}" ${c === s.category ? 'selected' : ''}>${c}</option>`).join('');
    return `
      <div class="ig-sync-row" data-idx="${i}">
        <label class="ig-sync-check">
          <input type="checkbox" data-ig-pick="${i}" checked>
        </label>
        <img src="${escapeHtml(it.imageUrl)}" alt="" referrerpolicy="no-referrer">
        <div class="ig-sync-body">
          <div class="ig-sync-row-1">
            <input type="text" class="ig-sync-name" data-ig-name="${i}" value="${escapeHtml(s.name || '')}" placeholder="Name">
            <select class="ig-sync-cat" data-ig-cat="${i}">${catOpts}</select>
          </div>
          <div class="ig-sync-row-2">
            <span class="ig-sync-size">${escapeHtml(stockText)}</span>
            <a href="${escapeHtml(it.postUrl)}" target="_blank" rel="noopener" class="ig-sync-postlink">view on IG ↗</a>
          </div>
          <div class="ig-sync-caption">${escapeHtml(captionShort)}</div>
        </div>
      </div>`;
  }).join('');
}

function resetIgSync() {
  igSyncCandidates = [];
  igSyncListEl.innerHTML = '';
  igSyncCommitRow.style.display = 'none';
  igSyncStatus.textContent = '';
}

async function commitIgSync() {
  const picks = [];
  igSyncCandidates.forEach((it, i) => {
    const cb = igSyncListEl.querySelector(`[data-ig-pick="${i}"]`);
    if (!cb || !cb.checked) return;
    const nameEl = igSyncListEl.querySelector(`[data-ig-name="${i}"]`);
    const catEl = igSyncListEl.querySelector(`[data-ig-cat="${i}"]`);
    picks.push({
      shortcode: it.shortcode,
      name: (nameEl?.value || it.suggested?.name || '').trim() || 'New Item',
      category: catEl?.value || it.suggested?.category || 'Shirts',
      stock: it.suggested?.stock || { 'One Size': 1 },
      description: it.suggested?.description || '',
      imageUrls: it.imageUrls || [it.imageUrl],
      takenAt: it.takenAt,
    });
  });
  if (!picks.length) { showToast('Tick at least one item to add.'); return; }
  igSyncCommitBtn.disabled = true;
  igSyncCommitBtn.textContent = `Adding ${picks.length}…`;
  try {
    const res = await fetch(`${API_BASE}/api/ig-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ items: picks }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`Added ${data.added} item${data.added === 1 ? '' : 's'} from Instagram.`);
    igSyncStatus.textContent = `✓ Added ${data.added}. ${data.errors?.length ? `(${data.errors.length} failures)` : ''}`;
    resetIgSync();
    await loadData();
    renderList();
    renderDashboard();
    renderInventory();
  } catch (err) {
    showToast('Error: ' + err.message);
    igSyncStatus.textContent = '✗ ' + err.message;
  } finally {
    igSyncCommitBtn.disabled = false;
    igSyncCommitBtn.textContent = 'Add selected items';
  }
}

async function init() {
  showToast('Loading…');
  await loadData();
  renderSuspendedBanner();
  renderList();
  renderTrash();
  renderDashboard();
  renderInventory();
  renderBroadcastSelected();
  renderBroadcastPicker();
  renderBroadcastRecipients();
  renderBroadcastPreview();
  renderInsights();
}

checkAuth();
