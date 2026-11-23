// 기준금리 자동 수집 → base-rates.json (현재 값 + 최근 이력)
//  · 신규 COFIX / 신잔액 COFIX : 은행연합회 소비자포털 COFIX 연도별 엑셀(월별 공시)
//  · 단기 COFIX : 은행연합회 소비자포털 단기 COFIX 연도별 엑셀(매주 수요일 공시)
//  · 금융채 3개월·6개월·1년·2년·5년 : 금융투자협회 채권정보센터(KOFIA BIS) 채권시가평가수익률
//                 금융채 I(은행채) · 무보증 · AAA · 평가사 평균
// GitHub Actions에서 실행:  node fetch-base-rates.mjs cofix | short | bond | all(직접 실행)
//  · short : 매주 수요일 15:01 단기 COFIX 조회 (bond 실행 때도 함께 확인해 공휴일로 밀린 공시를 채움)
//  · cofix : 매월 15~21일 15:01 실행되지만, 실제 조회는 "15일 이후 첫 영업일" 하루만
//  · bond  : 하루 4번(평일 19:05·23:05, 화~토 09:05·11:05) 조회, 빠진 평일 자동 채움
//  · fill 2026-10-30 : 빠진 날 하루만 다시 조회 (.github/bond-fill-date 파일을 바꿔 올리면 자동 실행)
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

/* ── 단기 COFIX: 주별 공시 (올해 엑셀, 부족하면 작년 엑셀까지 · 최근 30주 보관) ── */
async function cofixShort() {
  const y = kstNow().getUTCFullYear(), map = new Map();
  ((prev.history || {}).cofixShort || []).forEach(p => map.set(p.date, p.rate));
  const year = async yy => {
    const r = await fetch(`https://portal.kfb.or.kr/fingoods/cofix_w_excel.php?BasicYear=${yy}`, { headers: { ...UA, Referer: 'https://portal.kfb.or.kr/fingoods/cofix.php' } });
    if (!r.ok) throw new Error('단기 COFIX 엑셀 HTTP ' + r.status);
    let n = 0;
    for (const row of readSheet(Buffer.from(await r.arrayBuffer()))) {
      const m = String(row[0] || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/), v = parseFloat(row[2]);
      if (m && v > 0.3 && v < 15) { map.set(`${m[1]}-${pad(m[2])}-${pad(m[3])}`, v); n++; }   // 열: 공시일 | 대상기간 | 단기 COFIX
    }
    return n;
  };
  if (await year(y) < 30) await year(y - 1);
  const ok = [...map].map(([date, rate]) => ({ date, rate })).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  if (!ok.length) throw new Error('단기 COFIX 엑셀에서 값을 찾지 못함');
  const last = ok[ok.length - 1];
  return { cofixShort: { rate: last.rate, date: last.date }, hist: { cofixShort: ok } };
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
async function bonds(day) {
  // 평일 19:00 조회. GitHub 예약 실행이 늦어져 다음 날(주말 등)에 돌 수 있으므로,
  // 마지막 저장일 다음 날부터 오늘까지 빠진 평일을 모두 조회해 채움 (최대 14일). 공휴일은 자료가 없어 건너뜀
  // day 를 주면(빠진 날 채우기) 그날 값만 이력에 넣고, 현재 값보다 최신일 때만 현재 값도 바꿈
  const todayDate = ymd(kstNow());
  let days = [day];
  if (!day) {
    const h5 = (prev.history || {}).bond5 || [];
    const last = [prev.bond5 && prev.bond5.date, h5.length && h5[h5.length - 1].date].filter(Boolean).sort().pop();
    const start = new Date(Math.max(Date.parse(last || todayDate) + 86400000, Date.parse(todayDate) - 13 * 86400000));
    days = [];
    for (const d = start; ymd(d) <= todayDate; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6 !== 0) days.push(ymd(d));
    if (!days.length) throw new Error(todayDate + ' 새로 조회할 평일 없음 — 이전 값 유지');
  }
  const out = {};
  const hist = { bond24: [...((prev.history || {}).bond24 || [])], bond5: [...((prev.history || {}).bond5 || [])] };
  let got = 0;
  for (const dd of days) {
    const v = await bondDay(dd);
    if (!v) { console.error('·', dd, '금융채 자료 없음 (공휴일 등)'); continue; }
    got++;
    if (!prev.bond5 || prev.bond5.date <= dd)
      for (const k in v) if (v[k] !== undefined) out[k] = { rate: v[k], date: dd };
    ['bond24', 'bond5'].forEach(k => { if (v[k] !== undefined && !hist[k].some(p => p.date === dd)) hist[k].push({ date: dd, rate: v[k] }); });
  }
  if (!got) throw new Error(days.join(', ') + ' 금융채 자료 없음 (공휴일 등) — 이전 값 유지');
  out.hist = hist;
  return out;
}

const next = { ...prev }, errors = [], history = { ...(prev.history || {}) };
const FILL = process.argv[3];
if (MODE === 'fill' && !/^\d{4}-\d\d-\d\d$/.test(FILL || '')) { console.error('사용법: node fetch-base-rates.mjs fill 2026-10-30'); process.exit(1); }
const jobs = { cofix: [cofix], short: [cofixShort], bond: [() => bonds(), cofixShort], all: [cofix, cofixShort, () => bonds()], fill: [() => bonds(FILL)] }[MODE];
if (!jobs) { console.error('사용법: node fetch-base-rates.mjs cofix | short | bond | all | fill 날짜'); process.exit(1); }
for (const job of jobs) {
  try { const { hist, ...vals } = await job(); Object.assign(next, vals); Object.assign(history, hist); }
  catch (e) { errors.push(e.message); console.error('⚠', e.message); }
}
if (!next.cofixNew && !next.bond5 && !next.cofixShort) { console.error('수집 실패 — 파일을 바꾸지 않음'); process.exit(1); }
// 이력 정리: 날짜순, 최근 KEEP_DAYS일만
const cut = ymd(new Date(kstNow().getTime() - KEEP_DAYS * 86400000));
for (const k in history) history[k] = history[k].filter(p => p.date >= cut || k.startsWith('cofix')).sort((a, b) => a.date.localeCompare(b.date));
next.history = history;
const keys = ['cofixNew', 'cofixNewBal', 'cofixShort', 'bond3', 'bond6', 'bond12', 'bond24', 'bond5', 'history'];
const changed = keys.some(k => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
if (changed || !prev.updated) {
  next.updated = kstNow().toISOString().replace('Z', '+09:00');
  if (errors.length) next.errors = errors; else delete next.errors;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 1) + '\n');
  console.log('업데이트 완료', errors.length ? '(일부 실패: ' + errors.join(' / ') + ')' : '');
} else {
  console.log('변경 없음');
}
