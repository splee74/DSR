// 기준금리 자동 수집 → base-rates.json
//  · 신규 COFIX / 신잔액 COFIX : 은행연합회 소비자포털 COFIX 공시
//  · 금융채 5년 : 금융투자협회 채권정보센터(KOFIA BIS) 채권시가평가수익률
//                 금융채 I(은행채) · 무보증 · AAA · 평가사 평균, 잔존 5년
// GitHub Actions에서 매일 실행. 한 곳이 실패해도 나머지는 갱신하고, 실패한 값은 이전 값을 유지.
import fs from 'node:fs';

const FILE = new URL('../base-rates.json', import.meta.url);
const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const pad = n => String(n).padStart(2, '0');
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);   // 한국 시간
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const UA = { 'User-Agent': 'Mozilla/5.0 (DSR calculator; dsr1.co.kr)' };

async function cofix() {
  const r = await fetch('https://portal.kfb.or.kr/fingoods/cofix.php', { headers: UA });
  if (!r.ok) throw new Error('COFIX HTTP ' + r.status);
  const html = new TextDecoder('euc-kr').decode(await r.arrayBuffer());
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const grab = re => {
    const m = text.match(re);
    if (!m) throw new Error('COFIX 형식을 찾지 못함: ' + re);
    return { rate: +m[4], date: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
  };
  return {
    cofixNew: grab(/신규취급액기준\s*COFIX\s*공시일\s*:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d+\.\d+)\s*%/),
    cofixNewBal: grab(/신\s*잔액기준\s*COFIX\s*공시일\s*:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d+\.\d+)\s*%/)
  };
}

async function bond5() {
  // 가장 최근 영업일 값: 오늘부터 하루씩 거슬러 올라가며 조회
  for (let back = 0; back < 10; back++) {
    const d = new Date(kstNow().getTime() - back * 86400000), day = ymd(d).replace(/-/g, '');
    const body = `<?xml version="1.0" encoding="utf-8"?><message><proframeHeader><pfmAppName>BIS-KOFIABOND</pfmAppName><pfmSvcName>BISBndSrtPrcSrchSO</pfmSvcName><pfmFnName>selectDay</pfmFnName></proframeHeader><systemHeader></systemHeader><BISBndSrtPrcDayDTO><standardDt>${day}</standardDt><reportCompCd>A20000</reportCompCd><applyGbCd>C02</applyGbCd><val1>A10002</val1><val2>A10003</val2><val3>A10004</val3><val4>A10005</val4><val5>A10006</val5></BISBndSrtPrcDayDTO></message>`;
    const r = await fetch('https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/', {
      method: 'POST', headers: { ...UA, 'Content-Type': 'application/xml; charset=UTF-8', Referer: 'https://www.kofiabond.or.kr/' }, body
    });
    if (!r.ok) throw new Error('KOFIA HTTP ' + r.status);
    const xml = await r.text();
    const rows = xml.split('<BISBndSrtPrcDayDTO>').slice(1);
    const g = (row, tag) => ((row.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '').trim();
    const row = rows.find(x => g(x, 'largeCategoryMrk').startsWith('금융채 I') && g(x, 'typeNmMrk') === '무보증' && g(x, 'creditRnkMrk') === 'AAA');
    if (!row) continue;                      // 휴일 등 → 전날로
    // 만기 열 순서: 3월·6월·9월·1년·1년6월·2년·2년6월·3년·4년·5년·7년·10년… → 5년 = val10
    const v = parseFloat(g(row, 'val10'));
    if (!(v > 0.3 && v < 15)) throw new Error('금융채 5년 값 이상: ' + g(row, 'val10'));
    return { bond5: { rate: v, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` } };
  }
  throw new Error('최근 10일 금융채 자료 없음');
}

const next = { ...prev }, errors = [];
for (const job of [cofix, bond5]) {
  try { Object.assign(next, await job()); } catch (e) { errors.push(e.message); console.error('⚠', e.message); }
}
if (!next.cofixNew && !next.bond5) { console.error('수집 실패 — 파일을 바꾸지 않음'); process.exit(1); }
const changed = ['cofixNew', 'cofixNewBal', 'bond5'].some(k => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
if (changed || !prev.updated) {
  next.updated = kstNow().toISOString().replace('Z', '+09:00');
  if (errors.length) next.errors = errors; else delete next.errors;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
  console.log('업데이트:', JSON.stringify(next));
} else {
  console.log('변경 없음');
}
