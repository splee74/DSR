// 카카오톡 "나에게 보내기" 공통 모듈
// 필요한 환경변수 (Netlify > Project configuration > Environment variables)
//   KAKAO_REST_KEY      : 카카오 앱 REST API 키
//   KAKAO_CLIENT_SECRET : (선택) 카카오 앱에서 Client Secret을 켠 경우
//   SETUP_KEY           : 최초 연결 주소를 보호하는 비밀번호 (임의로 정함)
// 토큰은 Netlify Blobs("kakao" 저장소)에 보관하고, 매주 자동 갱신합니다.
import { getStore } from '@netlify/blobs';

const store = () => getStore('kakao');
const env = k => process.env[k] || '';

export const loadTokens = () => store().get('token', { type: 'json' });
const saveTokens = t => store().setJSON('token', t);

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: env('KAKAO_REST_KEY'), ...params });
  if (env('KAKAO_CLIENT_SECRET')) body.set('client_secret', env('KAKAO_CLIENT_SECRET'));
  const r = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`카카오 토큰 오류: ${j.error_description || j.error || r.status}`);
  return j;
}

// 최초 연결: 인가 코드 → 토큰
export async function exchangeCode(code, redirectUri) {
  const j = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: redirectUri, code });
  const t = { access_token: j.access_token, refresh_token: j.refresh_token, refreshed_at: new Date().toISOString() };
  await saveTokens(t);
  return t;
}

// 토큰 갱신 (리프레시 토큰은 만료 1개월 전부터 새로 발급됨)
export async function refresh() {
  const t = await loadTokens();
  if (!t || !t.refresh_token) throw new Error('카카오 연결이 필요합니다. 연결 주소로 다시 로그인해 주세요.');
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const n = { access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, refreshed_at: new Date().toISOString() };
  await saveTokens(n);
  return n;
}

// 나와의 채팅으로 텍스트 메시지 전송 (텍스트는 최대 200자)
export async function sendMemo(text, siteUrl) {
  const { access_token } = await refresh();
  const msg = text.length > 200 ? text.slice(0, 190) + '…(이하 생략)' : text;
  const template = { object_type: 'text', text: msg, link: { web_url: siteUrl, mobile_web_url: siteUrl }, button_title: '계산기 열기' };
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(template) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result_code !== 0) throw new Error(`카카오 전송 오류: ${j.msg || r.status}`);
}
