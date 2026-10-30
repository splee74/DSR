// 기준금리 자동 수집 → base-rates.json (현재 값 + 최근 이력)
//  · 신규 COFIX / 신잔액 COFIX : 은행연합회 소비자포털 COFIX 연도별 엑셀(월별 공시)
//  · 금융채 3개월·6개월·1년·2년·5년 : 금융투자협회 채권정보센터(KOFIA BIS) 채권시가평가수익률
//                 금융채 I(은행채) · 무보증 · AAA · 평가사 평균
// GitHub Actions에서 실행:  node fetch-base-rates.mjs cofix | bond | all(직접 실행)
//  · cofix : 매월 15~21일 15:01 실행되지만, 실제 조회는 "15일 이후 첫 영업일" 하루만
//  · bond  : 평일 18:30에 시작해 19:00까지 기다린 뒤 오늘 값만 한 번 조회 (20:30 예비 실행은 오늘 값이 있으면 건너뜀)
// 실패한 값은 이전 값을 유지.
import fs from 'node:fs';
import { readSheet } from './xlsx-lite.mjs';

const FILE = new URL('../base-rates.json', import.meta.url);
const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const pad = n => String(n).padStart(2, '0');
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);   // 한국 시간
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const UA = { 'User-Agent': 'Mozilla/5.0 (DSR calculator; dsr1.co.kr)' };
const KEEP_DAYS = 200;   // 이력 보관 기간 (화면은 최근 6개월 표시)
const MODE = process.argv[2] || 'all';

/* ── 영업일 판단: 주말 + 15~21일에 걸리는 공휴일(대체공휴일 포함). 해마다 추가 필요 ── */
const HOLIDAYS_15_21 = [
  '2026-02-16', '2026-02-17', '2026-02-18',   // 설날 연휴
  '2026-08-17',                               // 광복절 대체공휴일
  '2027-08-16',                               // 광복절 대체공휴일
  '2027-09-14', '2027-09-15', '2027-09-16'    // 추석 연휴
];
const isBiz = d => d.getUTCDay() % 6 !== 0 && !HOLIDAYS_15_21.includes(ymd(d));
function cofixDay(now) {   // 이번 달 COFIX 공시일 = 15일, 휴일이면 다음 첫 영업일
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  while (!isBiz(d)) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

/* ── COFIX: 올해 엑셀에서 월별 공시 (이전 이력과 합쳐 최근 13개월 보관) ── */
async function cofix() {
  const now = kstNow(), day = cofixDay(now);
  if (MODE === 'cofix' && ymd(now) !== day) { console.log(`COFIX: 오늘은 공시일(${day})이 아님 — 조회 안 함`); return {}; }
  const r = await fetch(`https://portal.kfb.or.kr/fingoods/cofix_excel_jan.php?BasicYear=${now.getUTCFullYear()}`, { headers: { ...UA, Referer: 'https://portal.kfb.or.kr/fingoods/cofix.php' } });
  if (!r.ok) throw new Error('COFIX 엑셀 HTTP ' + r.status);
  const map = new Map();
  const old = (prev.history || {});
  (old.cofixNew || []).forEach(p => map.set(p.date, { date: p.date, n: p.rate, b: ((old.cofixNewBal || []).find(q => q.date === p.date) || {}).rate }));
  for (const row of readSheet(Buffer.from(await r.arrayBuffer()))) {
    const m = String(row[0] || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;   // 제목·머리줄 건너뜀 (열: 공시일 | 대상월 | 신규취급액 | 잔액 | 신잔액)
    const x = { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, n: parseFloat(row[2]), b: parseFloat(row[4]) };
    if (x.n > 0 && x.b > 0) map.set(x.date, x);
  }
  const ok = [...map.values()].filter(x => x.n > 0 && x.b > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!ok.length) throw new Error('COFIX 엑셀에서 값을 찾지 못함');
  const last = ok[ok.length - 1], recent = ok.slice(-13);
  if (last.date < day.slice(0, 8) + '01') console.error(`⚠ COFIX: ${day} 공시가 아직 엑셀에 없음 — 이전 값 유지`);
  return {
    cofixNew: { rate: last.n, date: last.date }, cofixNewBal: { rate: last.b, date: last.date },
    hist: { cofixNew: recent.map(x => ({ date: x.date, rate: x.n })), cofixNewBal: recent.map(x => ({ date: x.date, rate: x.b })) }
  };
}

/* ── 금융채: 특정 날짜의 시가평가 (휴일이면 null) ── */
async function bondDay(day) {
  const body = `<?xml version="1.0" encoding="utf-8"?><message><proframeHeader><pfmAppName>BIS-KOFIABOND</pfmAppName><pfmSvcName>BISBndSrtPrcSrchSO</pfmSvcName><pfmFnName>selectDay</pfmFnName></proframeHeader><systemHeader></systemHeader><BISBndSrtPrcDayDTO><standardDt>${day.replace(/-/g, '')}</standardDt><reportCompCd>A20000</reportCompCd><applyGbCd>C02</applyGbCd><val1>A10002</val1><val2>A10003</val2><val3>A10004</val3><val4>A10005</val4><val5>A10006</val5></BISBndSrtPrcDayDTO></message>`;
  const r = await fetch('https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/', {
    method: 'POST', headers: { ...UA, 'Content-Type': 'application/xml; charset=UTF-8', Referer: 'https://www.kofiabond.or.kr/' }, body
  });
  if (!r.ok) throw new Error('KOFIA HTTP ' + r.status);
  const xml = await r.text();
  const g = (row, tag) => ((row.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '').trim();
  const row = xml.split('<BISBndSrtPrcDayDTO>').slice(1).find(x => g(x, 'largeCategoryMrk').startsWith('금융채 I') && g(x, 'typeNmMrk') === '무보증' && g(x, 'creditRnkMrk') === 'AAA');
  if (!row) return null;
  // 만기 열 순서: 3월·6월·9월·1년·1년6월·2년·2년6월·3년·4년·5년·7년·10년…
  const at = k => { const x = parseFloat(g(row, k)); return x > 0.3 && x < 15 ? x : undefined; };
  const v = { bond3: at('val1'), bond6: at('val2'), bond12: at('val4'), bond24: at('val6'), bond5: at('val10') };
  if (v.bond5 === undefined) throw new Error('금융채 5년 값 이상');
  return v;
}
async function bonds() {
  // 평일 19:00에 오늘 값만 한 번 조회 (과거 자료는 KOFIA 엑셀로 넣어 둠). 공휴일이면 자료가 없어 건너뜀
  const todayDate = ymd(kstNow());
  if (MODE === 'bond' && prev.bond5?.date === todayDate) { console.log(`금융채: 오늘(${todayDate}) 값이 이미 있음 — 조회 안 함`); return {}; }
  // 19:00 전에 시작했으면 19:00까지 기다림 (KOFIA 공시 후 조회)
  const k = kstNow(), wait = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 19) - k.getTime();
  if (MODE === 'bond' && wait > 0) { console.log(`금융채: 19:00까지 ${Math.ceil(wait / 60000)}분 기다림`); await new Promise(r => setTimeout(r, wait)); }
  const today = await bondDay(todayDate);
  if (!today) throw new Error(todayDate + ' 금융채 자료 없음 (공휴일 등) — 이전 값 유지');
  const out = {};
  for (const k in today) if (today[k] !== undefined) out[k] = { rate: today[k], date: todayDate };
  const hist = { bond24: [...((prev.history || {}).bond24 || [])], bond5: [...((prev.history || {}).bond5 || [])] };
  ['bond24', 'bond5'].forEach(k => { if (today[k] !== undefined && !hist[k].some(p => p.date === todayDate)) hist[k].push({ date: todayDate, rate: today[k] }); });
  out.hist = hist;
  return out;
}

const next = { ...prev }, errors = [], history = { ...(prev.history || {}) };
const jobs = { cofix: [cofix], bond: [bonds], all: [cofix, bonds] }[MODE];
if (!jobs) { console.error('사용법: node fetch-base-rates.mjs cofix | bond | all'); process.exit(1); }
for (const job of jobs) {
  try { const { hist, ...vals } = await job(); Object.assign(next, vals); Object.assign(history, hist); }
  catch (e) { errors.push(e.message); console.error('⚠', e.message); }
}
if (!next.cofixNew && !next.bond5) { console.error('수집 실패 — 파일을 바꾸지 않음'); process.exit(1); }
// 이력 정리: 날짜순, 최근 KEEP_DAYS일만
const cut = ymd(new Date(kstNow().getTime() - KEEP_DAYS * 86400000));
for (const k in history) history[k] = history[k].filter(p => p.date >= cut || k.startsWith('cofix')).sort((a, b) => a.date.localeCompare(b.date));
next.history = history;
const keys = ['cofixNew', 'cofixNewBal', 'bond3', 'bond6', 'bond12', 'bond24', 'bond5', 'history'];
const changed = keys.some(k => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
if (changed || !prev.updated) {
  next.updated = kstNow().toISOString().replace('Z', '+09:00');
  if (errors.length) next.errors = errors; else delete next.errors;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 1) + '\n');
  console.log('업데이트 완료', errors.length ? '(일부 실패: ' + errors.join(' / ') + ')' : '');
} else {
  console.log('변경 없음');
}
