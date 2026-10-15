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
vm.runInContext(source.slice(0, source.lastIndexOf('\ntry {')) + '\nglobalThis.helpers = { remaining, persianDateValue, timeValue, parsePersianDateTime, parseRecord, sizeLabel, dateFormat, getMonthCalendar, persianParts, calendarEvents };', context);
const { remaining, persianDateValue, timeValue, parsePersianDateTime, parseRecord, sizeLabel, dateFormat, getMonthCalendar, persianParts, calendarEvents } = context.helpers;
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
  assert.equal(persianDateValue(now), '۱۴۰۵/۰۷/۲۳');
  assert.equal(parsePersianDateTime(persianDateValue(now), timeValue(now)), now);
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

test('monthly planner starts on Persian day one and navigates from Mehr to Aban', () => {
  const mehr = getMonthCalendar(new Date('2026-10-15T12:00:00'));
  assert.equal(persianParts(mehr.start).day, 1);
  assert.equal(persianParts(mehr.start).month, 7);
  assert.equal(mehr.days.length, 30);
  assert.equal(mehr.offset, (mehr.start.getDay() + 1) % 7);
  const aban = getMonthCalendar(mehr.end);
  assert.equal(persianParts(aban.start).month, 8);
  assert.equal(persianParts(aban.start).day, 1);
  assert.equal(aban.days.length, 30);
  assert.equal(getMonthCalendar(aban.previous).start.getTime(), mehr.start.getTime());
});

test('monthly planner handles 31-day months, leap Esfand, and Nowruz', () => {
  assert.equal(getMonthCalendar(new Date('2026-07-01T12:00:00')).days.length, 31);
  const leap = getMonthCalendar(new Date('2025-03-10T12:00:00'));
  assert.equal(leap.days.length, 30);
  const normal = getMonthCalendar(new Date('2026-03-10T12:00:00'));
  assert.equal(normal.days.length, 29);
  const newYear = getMonthCalendar(normal.end);
  assert.equal(persianParts(newYear.start).month, 1);
  assert.equal(persianParts(newYear.start).year, 1405);
});

test('events on 1 Aban are marked only on their exact local date, including exams and quizzes', () => {
  const aban = getMonthCalendar(new Date('2026-11-01T12:00:00'));
  const first = aban.days[0], second = aban.days[1];
  const exam = new Date(first); exam.setHours(9,30);
  const quiz = new Date(first); quiz.setHours(23,59,59,999);
  const events = [
    { id:'exam', type:'Exam', due:exam.getTime(), completed:false },
    { id:'quiz', type:'Quiz', due:quiz.getTime(), completed:false },
    { id:'next-day', due:second.getTime(), completed:false },
    { id:'completed', due:exam.getTime(), completed:true }
  ];
  assert.equal(calendarEvents(events, first).map((item) => item.id).join(','), 'exam,quiz');
  assert.equal(calendarEvents(events, second).map((item) => item.id).join(','), 'next-day');
  assert.equal(calendarEvents(events, getMonthCalendar(first).previous).length, 0);
});

test('quiz dates survive backup parsing alongside existing exam records', () => {
  assert.equal(parseRecord({ ...record, type:'Quiz' }).type, 'Quiz');
  assert.equal(parseRecord(record).type, 'Exam');
});

test('Persian, Arabic, and Latin date digits map to the same local deadline', () => {
  const expected = new Date(2026, 9, 23, 9, 30).getTime();
  assert.equal(parsePersianDateTime('۱۴۰۵/۰۸/۰۱', '09:30'), expected);
  assert.equal(parsePersianDateTime('1405/08/01', '09:30'), expected);
  assert.equal(parsePersianDateTime('١٤٠٥/٠٨/٠١', '٠٩:٣٠'), expected);
  assert.equal(parsePersianDateTime('1405/8/1', '09:30'), expected);
  assert.equal(parsePersianDateTime('۱۴۰۵۰۸۰۱', '09:30'), expected);
});

test('Persian date entry validates month lengths, leap Esfand, and clock values', () => {
  assert.equal(persianDateValue(parsePersianDateTime('1403/12/30', '23:59')), '۱۴۰۳/۱۲/۳۰');
  assert.equal(persianDateValue(parsePersianDateTime('1405/01/31', '00:00')), '۱۴۰۵/۰۱/۳۱');
  for (const date of ['1404/12/30', '1405/07/31', '1405/13/01', '1405/00/10', '1405/08/00', '1405/08', '', 'not a date']) {
    assert.ok(Number.isNaN(parsePersianDateTime(date, '09:30')), date);
  }
  for (const time of ['24:00', '12:60', '', '9:3']) assert.ok(Number.isNaN(parsePersianDateTime('1405/08/01', time)), time);
});

test('saved timestamps round-trip through Persian input around Nowruz and midnight', () => {
  for (const value of ['2025-03-20T23:59', '2025-03-21T00:00', '2026-03-20T23:59', '2026-03-21T00:00', '2026-10-23T00:00', '2026-12-31T23:59']) {
    const timestamp = new Date(value).getTime();
    assert.equal(parsePersianDateTime(persianDateValue(timestamp), timeValue(timestamp)), timestamp, value);
  }
});
