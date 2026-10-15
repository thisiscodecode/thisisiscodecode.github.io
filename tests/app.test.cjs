const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
// Load the production module with inert DOM listeners; omit only browser startup.
const elements = new Map();
const document = {
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { addEventListener() {} });
    return elements.get(selector);
  },
  querySelectorAll() { return []; }, addEventListener() {}
};
const context = vm.createContext({ document, window:{ addEventListener() {} }, setInterval() {}, Intl, Date, Blob, atob, Uint8Array, console });
vm.runInContext(source.slice(0, source.lastIndexOf('\ntry {')) + '\nglobalThis.helpers = { remaining, localDateValue, parseRecord, sizeLabel, dateFormat };', context);
const { remaining, localDateValue, parseRecord, sizeLabel, dateFormat } = context.helpers;
const now = Date.parse('2026-10-15T12:00:00Z');

test('countdowns use Persian digits and distinguish future and overdue boundaries', () => {
  assert.equal(remaining(now + 90000, now).text, '۱ دقیقه مانده');
  assert.equal(remaining(now, now).text, 'کمتر از یک دقیقه گذشته');
  assert.equal(remaining(now - 3600000, now).text, '۱ ساعت و ۰ دقیقه گذشته');
  assert.equal(remaining(now + 86400000 * 3, now).text, '۳ روز و ۰ ساعت مانده');
  assert.equal(remaining(now + 86400000 * 2, now).soon, false);
});
test('dates display the Persian calendar and editor values round-trip in local time', () => {
  assert.match(dateFormat.format(now), /۲۳ مهر/);
  assert.equal(new Date(localDateValue(now)).getTime(), now);
  assert.equal(sizeLabel(1048576), '۱ مگابایت');
});
const record = { id:'legacy-backup', title:'  آزمون  ', course:'ریاضی', type:'Exam', due:now, notes:'مرور فصل اول', completed:false, files:[{name:'notes.txt',type:'text/plain',data:'data:text/plain;base64,aGVsbG8='}] };
test('old backup type values remain compatible and attachment bytes survive', async () => {
  const parsed = parseRecord(record);
  assert.equal(parsed.title, 'آزمون');
  assert.equal(parsed.type, 'Exam');
  assert.equal(parsed.files[0].size, 5);
  assert.equal(await parsed.files[0].blob.text(), 'hello');
});
test('invalid backup records and malformed attachments are rejected in Persian', () => {
  assert.throws(() => parseRecord({...record,due:Infinity}), /معتبر نیست/);
  assert.throws(() => parseRecord({...record,type:'ناشناخته'}), /معتبر نیست/);
  assert.throws(() => parseRecord({...record,files:[{name:'notes.txt',type:'text/plain',data:'not a data URL'}]}), /معتبر نیست/);
});
