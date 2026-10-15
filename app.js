const $ = (selector) => document.querySelector(selector);
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_BACKUP_SIZE = 200 * 1024 * 1024;
const DAY = 86400000;
let db, assignments = [], view = 'active', filter = 'all', search = '', selectedDay = null, selectedFiles = [], retainedFiles = [], toastTimer;
const LOCALE = 'fa-IR';
const numbers = new Intl.NumberFormat(LOCALE);
const number = (value) => numbers.format(value);
const types = { Assignment:'تکلیف', Exam:'آزمون', Project:'پروژه', Reading:'مطالعه', Other:'سایر' };
const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const dateFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sizeLabel = (size) => size < 1024 ? number(size) + ' بایت' : size < 1048576 ? number(Math.round(size / 102.4) / 10) + ' کیلوبایت' : number(Math.round(size / 104857.6) / 10) + ' مگابایت';
function notify(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error-toast', error); $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function failure(error) {
  console.error(error);
  notify(error?.name === 'QuotaExceededError' ? 'فضای ذخیره‌سازی مرورگر پر شده است. پشتیبان بگیر و فایل‌های غیرضروری را حذف کن.' : 'ذخیرهٔ تغییرات ممکن نشد. دوباره تلاش کن یا پشتیبان بگیر.', true);
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('due-north-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assignments', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database is blocked by another tab.'));
  });
}
function transaction(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assignments', mode);
    let result;
    try { result = action(tx.objectStore('assignments')); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
  });
}
async function refresh() { assignments = await transaction('readonly', (store) => store.getAll()); render(); }
function remaining(due, now = Date.now()) {
  const diff = due - now, distance = Math.abs(diff);
  let value;
  if (distance < 60000) value = 'کمتر از یک دقیقه';
  else if (distance < 3600000) value = number(Math.floor(distance / 60000)) + ' دقیقه';
  else if (distance < DAY) value = number(Math.floor(distance / 3600000)) + ' ساعت و ' + number(Math.floor(distance % 3600000 / 60000)) + ' دقیقه';
  else value = number(Math.floor(distance / DAY)) + ' روز و ' + number(Math.floor(distance % DAY / 3600000)) + ' ساعت';
  return { text: value + (diff <= 0 ? ' گذشته' : ' مانده'), short: value, overdue: diff <= 0, soon: diff > 0 && diff < DAY * 2 };
}
function localDateValue(time) {
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function courseTone(course) { return Array.from(course).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5; }
function rowMarkup(item) {
  const time = remaining(item.due);
  return '<article class="assignment-row ' + (item.completed ? 'is-complete' : '') + '" data-id="' + escape(item.id) + '">' +
    '<button class="complete-button ' + (item.completed ? 'checked' : '') + '" data-action="complete" aria-label="' + (item.completed ? 'بازگرداندن به کارهای پیش رو: ' : 'انجام شد: ') + escape(item.title) + '" aria-pressed="' + item.completed + '">' + icon('check') + '</button>' +
    '<div class="assignment-content"><div class="assignment-top"><div><h3 class="assignment-title" dir="auto">' + escape(item.title) + '</h3><div class="course-line"><span class="course-tag course-tone-' + courseTone(item.course) + '">' + escape(item.course) + '</span><span>' + escape(types[item.type] || item.type) + '</span></div></div>' +
    '<span class="time-badge ' + (item.completed ? 'completed' : time.overdue ? 'overdue' : time.soon ? 'soon' : '') + '" data-countdown="' + item.due + '" data-completed="' + item.completed + '">' + (item.completed ? '✓ انجام‌شده' : escape(time.text)) + '</span></div>' +
    (item.notes ? '<p class="assignment-notes">' + escape(item.notes) + '</p>' : '') +
    (item.files.length ? '<div class="attachments">' + item.files.map((file, index) => '<button class="attachment" data-action="download" data-file="' + index + '" title="دریافت ' + escape(file.name) + '">' + icon('file') + '<span class="file-name">' + escape(file.name) + '</span><span>' + sizeLabel(file.size) + '</span></button>').join('') + '</div>' : '') +
    '<div class="assignment-bottom"><time class="deadline-date" datetime="' + new Date(item.due).toISOString() + '">' + icon('calendar') + escape(dateFormat.format(item.due)) + '</time><div class="row-actions"><button data-action="edit">ویرایش</button><button class="delete-button" data-action="delete">حذف</button></div></div></div></article>';
}
function render() {
  const now = Date.now();
  const active = assignments.filter((item) => !item.completed);
  const completed = assignments.filter((item) => item.completed);
  const thisWeek = active.filter((item) => item.due >= now && item.due <= now + DAY * 7);
  const overdue = active.filter((item) => item.due <= now);
  $('#active-count').textContent = number(active.length); $('#nav-count').textContent = number(active.length);
  $('#week-count').textContent = number(thisWeek.length); $('#overdue-count').textContent = number(overdue.length);
  $('#complete-count').textContent = number(completed.length); $('#completed-nav-count').textContent = number(completed.length);
  $('#today').textContent = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const progress = assignments.length ? Math.round(completed.length / assignments.length * 100) : 0;
  $('#progress-label').textContent = number(completed.length) + ' از ' + number(assignments.length) + ' تکلیف انجام شده';
  $('#progress-percent').textContent = number(progress) + '٪';
  $('#progress-fill').style.width = progress + '%';
  $('.progress-track').setAttribute('aria-valuenow', String(progress));
  $('#progress-note').textContent = progress === 100 ? 'همهٔ کارها انجام شده؛ وقت یک استراحت کوتاه است!' : 'هر تکلیف انجام‌شده، یک قدم رو به جلوست.';
  let visible = view === 'completed' ? completed : view === 'week' ? thisWeek : active;
  if (view !== 'completed') visible = visible.filter((item) => filter === 'all' || (filter === 'overdue' ? item.due <= now : item.due > now));
  if (selectedDay !== null) { const end = new Date(selectedDay); end.setDate(end.getDate() + 1); visible = visible.filter((item) => item.due >= selectedDay && item.due < end.getTime()); }
  const normalize = (value) => value.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').toLocaleLowerCase(LOCALE);
  visible = visible.filter((item) => normalize(item.title + ' ' + item.course + ' ' + item.notes).includes(normalize(search))).sort((a, b) => a.due - b.due || a.title.localeCompare(b.title, LOCALE));
  $('#list-title').innerHTML = (view === 'completed' ? 'انجام‌شده‌ها' : view === 'week' ? 'هفت روز آینده' : 'مهلت‌های من') + ' <span id="list-count">' + number(visible.length) + '</span>';
  $('#breadcrumb-current').textContent = view === 'completed' ? 'انجام‌شده‌ها' : view === 'week' ? 'هفت روز آینده' : 'نمای کلی';
  $('#date-filter').hidden = selectedDay === null;
  if (selectedDay !== null) $('#date-filter-label').textContent = 'موعد: ' + new Intl.DateTimeFormat(LOCALE, { month:'long', day:'numeric' }).format(selectedDay);
  $('.tabs').hidden = view === 'completed';
  $('#assignment-list').innerHTML = visible.length ? visible.map(rowMarkup).join('') : emptyMarkup();
  const next = active.filter((item) => item.due > now).sort((a,b) => a.due - b.due)[0];
  $('#next-assignment').innerHTML = next ? '<h3 class="next-title" dir="auto">' + escape(next.title) + '</h3><p class="next-course">' + escape(next.course) + '</p><p class="next-countdown" data-next-due="' + next.due + '">' + escape(remaining(next.due).short) + '<small>تا رسیدن به موعد تحویل</small></p><button class="next-open" data-next-id="' + escape(next.id) + '">جزئیات و ویرایش ' + icon('arrow') + '</button>' : '<h3 class="next-title">' + (active.length ? 'فرصت یک شروع تازه' : 'کمی فرصت برای نفس کشیدن') + '</h3><p class="next-course">' + (active.length ? 'به تکلیف‌های عقب‌افتاده نگاهی بینداز.' : 'مهلت بعدی تو اینجا نمایش داده می‌شود.') + '</p><p class="next-countdown">با خیال آسوده<small>هر بار، فقط یک قدم.</small></p>';
  renderCalendar(active, now);
}
function emptyMarkup() {
  const clean = assignments.length === 0 && !search && selectedDay === null && filter === 'all' && view === 'active';
  return '<div class="empty-state"><div class="empty-illustration" aria-hidden="true"><div class="empty-paper"></div>' + icon('check') + '<span class="empty-spark">✧</span></div><h3>' + (clean ? 'شروع یک برنامهٔ روشن' : search ? 'تکلیفی با این عبارت پیدا نشد' : view === 'completed' ? 'اولین قدمت را ثبت کن' : 'اینجا کاری برای نمایش نیست') + '</h3><p>' +
    (clean ? 'اولین مهلت را اضافه کن؛ از اینجا به بعد، هر تکلیف جای خودش را دارد.' : search ? 'نام درس، عنوان تکلیف یا کلمه‌ای از یادداشت‌ها را جست‌وجو کن.' : view === 'completed' ? 'با انجام اولین تکلیف، پیشرفتت را اینجا می‌بینی.' : 'می‌توانی فیلتر را تغییر بدهی یا برای قدم بعدی برنامه بریزی.') + '</p>' +
    '<button class="button secondary" data-empty-add>' + icon('plus') + 'افزودن مهلت</button>' + (clean ? '<button class="text-button" id="demo-button">اول با چند تکلیف نمونه امتحان می‌کنم</button>' : '') + '</div>';
}
function renderCalendar(active, now) {
  const start = new Date(now); start.setHours(0,0,0,0);
  const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(start); date.setDate(date.getDate() + i); return date; });
  $('#week-range').textContent = days[0].toLocaleDateString(LOCALE, { month:'long', day:'numeric' }) + ' تا ' + days[6].toLocaleDateString(LOCALE, { month:'long', day:'numeric' });
  $('#week-calendar').innerHTML = days.map((date, i) => {
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const count = active.filter((item) => item.due >= date.getTime() && item.due < end.getTime()).length;
    return '<button class="calendar-day ' + (!i ? 'is-today ' : '') + (selectedDay === date.getTime() ? 'is-selected' : '') + '" data-day="' + date.getTime() + '" aria-pressed="' + (selectedDay === date.getTime()) + '" aria-label="' + escape(date.toLocaleDateString(LOCALE, { weekday:'long', month:'long', day:'numeric' })) + ': ' + number(count) + ' تکلیف"><span>' + escape(date.toLocaleDateString(LOCALE, { weekday:'narrow' })) + '</span><strong>' + date.toLocaleDateString(LOCALE, { day:'numeric' }) + '</strong><span class="calendar-indicator ' + (count ? 'has-deadline' : '') + '"></span></button>';
  }).join('');
}
function showEditor(item) {
  $('#assignment-form').reset(); $('#form-error').textContent = '';
  $('#assignment-id').value = item?.id || '';
  $('#dialog-title').textContent = item ? 'ویرایش مهلت' : 'افزودن مهلت';
  $('#assignment-title').value = item?.title || '';
  $('#assignment-course').value = item?.course || '';
  $('#assignment-type').value = item?.type || 'Assignment';
  $('#assignment-due').value = localDateValue(item?.due || Date.now() + DAY);
  $('#assignment-notes').value = item?.notes || '';
  updateDateNote();
  selectedFiles = []; retainedFiles = [...(item?.files || [])]; renderFormFiles();
  $('#assignment-dialog').showModal(); $('#assignment-title').focus();
}
function updateDateNote() {
  const due = new Date($('#assignment-due').value).getTime();
  const zone = new Intl.DateTimeFormat(LOCALE, { timeZoneName:'long' }).formatToParts(Date.now()).find((part) => part.type === 'timeZoneName').value;
  $('#timezone-note').textContent = Number.isFinite(due) ? dateFormat.format(due) + ' · ' + zone : 'یک تاریخ و ساعت معتبر انتخاب کن.';
}
$('#assignment-due').addEventListener('input', updateDateNote);
function renderFormFiles() {
  $('#form-files').innerHTML = [...retainedFiles.map((f,i) => ({ ...f, key:'existing-' + i })), ...selectedFiles.map((f,i) => ({ name:f.name, size:f.size, key:'new-' + i }))].map((f) => '<div class="form-file"><span>' + escape(f.name) + ' · ' + sizeLabel(f.size) + '</span><button type="button" data-remove-file="' + f.key + '" aria-label="حذف پیوست ' + escape(f.name) + '">حذف</button></div>').join('');
}
$('#add-button').addEventListener('click', () => showEditor());
$('#next-assignment').addEventListener('click', (event) => {
  const button = event.target.closest('[data-next-id]');
  const item = button && assignments.find((a) => a.id === button.dataset.nextId);
  if (item) showEditor(item);
});
$('#week-calendar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]'); if (!button || !db) return;
  const day = Number(button.dataset.day);
  const toggled = selectedDay === day;
  document.querySelector('[data-view="active"]').click();
  selectedDay = toggled ? null : day; render();
});
$('#clear-date-filter').addEventListener('click', () => { selectedDay = null; render(); });
document.addEventListener('keydown', (event) => {
  if (!db || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable]')) return;
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); showEditor(); }
  if (event.key === '/') { event.preventDefault(); $('#search').focus(); }
});
$('#close-dialog').addEventListener('click', () => $('#assignment-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#assignment-dialog').close());
$('#assignment-files').addEventListener('change', (event) => {
  const files = [...event.target.files];
  const rejected = files.filter((f) => f.size > MAX_FILE_SIZE);
  selectedFiles.push(...files.filter((f) => f.size <= MAX_FILE_SIZE)); event.target.value = ''; renderFormFiles();
  $('#form-error').textContent = rejected.length ? 'برخی فایل‌ها بزرگ‌تر از ۲۵ مگابایت بودند و اضافه نشدند.' : '';
});
$('#form-files').addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-file]'); if (!button) return;
  const [type,index] = button.dataset.removeFile.split('-');
  (type === 'existing' ? retainedFiles : selectedFiles).splice(Number(index), 1); renderFormFiles();
});
$('#assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('#assignment-title').value.trim(), course = $('#assignment-course').value.trim(), due = new Date($('#assignment-due').value).getTime();
  if (!title || !course || !Number.isFinite(due)) { $('#form-error').textContent = 'عنوان، نام درس و یک موعد معتبر وارد کن.'; return; }
  $('#save-button').disabled = true;
  const id = $('#assignment-id').value || crypto.randomUUID();
  const previous = assignments.find((item) => item.id === id);
  const item = { id, title, course, type:$('#assignment-type').value, due, notes:$('#assignment-notes').value.trim(), completed:previous?.completed || false, createdAt:previous?.createdAt || Date.now(), files:[...retainedFiles, ...selectedFiles.map((f) => ({ name:f.name, size:f.size, type:f.type, blob:f }))] };
  try { await transaction('readwrite', (store) => store.put(item)); await refresh(); $('#assignment-dialog').close(); if (!previous) { search = ''; $('#search').value = ''; document.querySelector('[data-view="active"]').click(); } notify(previous ? 'مهلت با موفقیت به‌روز شد.' : 'مهلت اضافه شد؛ یک قدم جلوتر هستی.'); }
  catch(error) { failure(error); $('#form-error').textContent = 'مهلت ذخیره نشد. فضای مرورگر را بررسی کن و دوباره تلاش کن.'; }
  finally { $('#save-button').disabled = false; }
});
function confirmRemove(item) {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog'); dialog.returnValue = 'cancel';
    $('#confirm-message').textContent = '«' + item.title + '» و فایل‌های پیوستش از این مرورگر حذف می‌شوند. برای نگهداری آن‌ها، ابتدا پشتیبان بگیر.';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once:true }); dialog.showModal();
  });
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('#assignment-list').addEventListener('click', async (event) => {
  if (event.target.closest('[data-empty-add]')) { showEditor(); return; }
  if (event.target.closest('#demo-button')) { await addExamples(); return; }
  const action = event.target.closest('[data-action]'); if (!action) return;
  const item = assignments.find((a) => a.id === action.closest('[data-id]').dataset.id); if (!item) return;
  try {
    if (action.dataset.action === 'edit') showEditor(item);
    else if (action.dataset.action === 'download') { const file = item.files[Number(action.dataset.file)]; download(file.blob, file.name); }
    else if (action.dataset.action === 'complete') { await transaction('readwrite', (store) => store.put({ ...item, completed:!item.completed })); await refresh(); notify(item.completed ? 'تکلیف به کارهای پیش رو برگشت.' : 'یک کار کمتر؛ خسته نباشی!'); }
    else if (action.dataset.action === 'delete' && await confirmRemove(item)) { await transaction('readwrite', (store) => store.delete(item.id)); await refresh(); notify('مهلت حذف شد.'); }
  } catch (error) { failure(error); }
});
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  view = button.dataset.view; filter = 'all'; selectedDay = null; document.querySelectorAll('[data-view]').forEach((b) => { b.classList.toggle('active', b === button); if (b === button) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-filter]').forEach((b) => { b.classList.toggle('active', b.dataset.filter === 'all'); b.setAttribute('aria-pressed', String(b.dataset.filter === 'all')); }); render();
}));
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((b) => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); render();
}));
$('#search').addEventListener('input', (event) => { search = event.target.value; render(); });
function toDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
$('#export-button').addEventListener('click', async () => {
  const button = $('#export-button'); button.disabled = true;
  try {
    const snapshot = await transaction('readonly', (store) => store.getAll());
    if (snapshot.reduce((size, item) => size + item.files.reduce((sum, f) => sum + f.size, 0), 0) > MAX_BACKUP_SIZE * .7) throw new Error('حجم پشتیبان خیلی زیاد است. برخی فایل‌ها را جداگانه دریافت و از تکلیف‌ها حذف کن.');
    const records = await Promise.all(snapshot.map(async (item) => ({ ...item, files:await Promise.all(item.files.map(async ({ blob, ...file }) => ({ ...file, data:await toDataUrl(blob) }))) })));
    download(new Blob([JSON.stringify({ format:'due-north', version:1, exportedAt:new Date().toISOString(), assignments:records })], { type:'application/json' }), 'due-north-' + new Date().toISOString().slice(0,10) + '.backup.json');
    notify('پشتیبان، همراه با فایل‌های پیوست، دریافت شد.');
  } catch (error) { console.error(error); notify(error.message || 'دریافت پشتیبان ممکن نشد.', true); }
  finally { button.disabled = false; }
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
function parseRecord(item) {
  const types = ['Assignment','Exam','Project','Reading','Other'];
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length > 200 || !item.id || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 || typeof item.course !== 'string' || !item.course.trim() || item.course.length > 80 || !types.includes(item.type) || !Number.isFinite(item.due) || !Number.isFinite(new Date(item.due).getTime()) || typeof item.notes !== 'string' || item.notes.length > 4000 || typeof item.completed !== 'boolean' || !Array.isArray(item.files)) throw new Error('یکی از تکلیف‌های این پشتیبان معتبر نیست.');
  const files = item.files.map((f) => {
    if (!f || typeof f.name !== 'string' || !f.name || f.name.length > 1024 || typeof f.type !== 'string' || typeof f.data !== 'string' || !/^data:[^,]*;base64,/.test(f.data)) throw new Error('یکی از فایل‌های این پشتیبان معتبر نیست.');
    const raw = atob(f.data.slice(f.data.indexOf(',') + 1)); if (raw.length > MAX_FILE_SIZE) throw new Error('یکی از فایل‌های پشتیبان بزرگ‌تر از ۲۵ مگابایت است.');
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0)), blob = new Blob([bytes], { type:f.type });
    return { name:f.name, type:f.type, size:blob.size, blob };
  });
  return { id:item.id, title:item.title.trim(), course:item.course.trim(), type:item.type, due:item.due, notes:item.notes, completed:item.completed, createdAt:Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), files };
}
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const button = $('#import-button'); button.disabled = true;
  try {
    if (file.size > MAX_BACKUP_SIZE) throw new Error('این پشتیبان بزرگ‌تر از ۲۰۰ مگابایت است. فایل کوچک‌تری انتخاب کن.');
    const data = JSON.parse(await file.text());
    if (data.format !== 'due-north' || data.version !== 1 || !Array.isArray(data.assignments) || data.assignments.length > 10000) throw new Error('یک فایل پشتیبان معتبر مهلت یا Due North انتخاب کن.');
    const records = data.assignments.map(parseRecord);
    // Merge in one transaction. Existing deadlines are preserved; ID conflicts get a new ID.
    const current = await transaction('readonly', (store) => store.getAll()); const ids = new Set(current.map((a) => a.id));
    for (const record of records) { if (ids.has(record.id)) record.id = crypto.randomUUID(); ids.add(record.id); }
    await transaction('readwrite', (store) => { for (const record of records) store.put(record); });
    await refresh(); notify(number(records.length) + ' مهلت بازیابی شد. مهلت‌های قبلی هم حفظ شدند.');
  } catch(error) { console.error(error); notify(error instanceof SyntaxError ? 'این فایل یک پشتیبان JSON معتبر نیست.' : error.message || 'بازیابی پشتیبان ممکن نشد.', true); }
  finally { button.disabled = false; }
});
async function addExamples() {
  const now = Date.now();
  const records = [
    ['مرور منابع پژوهش','روش تحقیق','Assignment',now + DAY * 1.3,'سه منبع را بخوان و پیش‌نویس اولیه را آماده کن.'],
    ['حل تمرین فصل چهارم','ریاضی عمومی ۲','Assignment',now + DAY * 3.2,'تمرین‌های فصل پنجم و ششم؛ راه‌حل‌ها را کامل بنویس.'],
    ['پروژهٔ طراحی تعامل','کارگاه طراحی','Project',now + DAY * 5.4,'نمونهٔ اولیه، یادداشت‌های فرایند و یک گزارش کوتاه.'],
    ['گزارش مطالعهٔ هفتگی','ادبیات فارسی','Reading',now - DAY * .3,'برداشت خودت از مطالعهٔ این هفته را در ۵۰۰ کلمه بنویس.'],
    ['آزمون میان‌ترم','مبانی کامپیوتر','Exam',now + DAY * 9.3,'ساختمان داده و پیچیدگی الگوریتم‌ها را مرور کن.']
  ].map(([title,course,type,due,notes]) => ({ id:crypto.randomUUID(), title,course,type,due,notes,completed:false,createdAt:now,files:[] }));
  try { await transaction('readwrite', (store) => { for (const record of records) store.put(record); }); await refresh(); notify('تکلیف‌های نمونه اضافه شدند. می‌توانی آن‌ها را ویرایش یا حذف کنی.'); } catch(error) { failure(error); }
}
let lastTimeGroup = '';
function timeGroup() { const now = Date.now(); return new Date().toDateString() + ':' + assignments.map((a) => a.completed ? 'c' : a.due <= now ? 'o' : a.due <= now + DAY * 7 ? 'w' : 'l').join(''); }
setInterval(() => {
  if (!db) return;
  const group = timeGroup(); if (group !== lastTimeGroup) { lastTimeGroup = group; render(); return; }
  document.querySelectorAll('[data-countdown]').forEach((el) => { if (el.dataset.completed === 'true') return; const time = remaining(Number(el.dataset.countdown)); el.textContent = time.text; el.classList.toggle('overdue', time.overdue); el.classList.toggle('soon', time.soon); });
  const next = $('[data-next-due]'); if (next) next.innerHTML = escape(remaining(Number(next.dataset.nextDue)).short) + '<small>تا رسیدن به موعد تحویل</small>';
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && db) refresh().catch(failure); });
window.addEventListener('focus', () => { if (db) refresh().catch(failure); });
try {
  db = await openDatabase(); db.onversionchange = () => { db.close(); notify('برنامه در زبانهٔ دیگری به‌روز شده است. صفحه را تازه‌سازی کن.', true); };
  await refresh();
} catch (error) {
  console.error(error); $('#storage-status').textContent = 'ذخیره‌سازی مرورگر در دسترس نیست';
  $('#assignment-list').innerHTML = '<div class="empty-state"><div class="empty-icon">!</div><h3>به فضای ذخیره‌سازی مرورگر نیاز داریم</h3><p>دسترسی ذخیره‌سازی این سایت را در مرورگر فعال کن و صفحه را تازه‌سازی کن. حالت خصوصی یا تنظیمات مرورگر ممکن است مانع ذخیره‌سازی شود.</p></div>';
  document.querySelectorAll('#add-button,#import-button,#export-button').forEach((button) => button.disabled = true);
}

