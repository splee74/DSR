// 최초 1회 카카오 연결
// 브라우저에서 https://<사이트주소>/.netlify/functions/kakao-auth?key=<SETUP_KEY> 로 접속
import { exchangeCode, sendMemo } from '../lib/kakao.mjs';

const page = (msg, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   <title>카카오 알림 연결</title>
   <body style="font-family:sans-serif;padding:40px 20px;text-align:center;line-height:1.6"><h2>${msg}</h2></body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export default async req => {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/.netlify/functions/kakao-auth`;
  const key = process.env.SETUP_KEY;
  const code = url.searchParams.get('code');

  if (!process.env.KAKAO_REST_KEY || !key) return page('Netlify 환경변수(KAKAO_REST_KEY, SETUP_KEY)를 먼저 등록해 주세요.', 500);

  // 1단계: 카카오 로그인 화면으로 이동
  if (!code) {
    if (url.searchParams.get('key') !== key) return page('접근 권한이 없습니다.', 403);
    const auth = new URL('https://kauth.kakao.com/oauth/authorize');
    auth.search = new URLSearchParams({ client_id: process.env.KAKAO_REST_KEY, redirect_uri: redirectUri, response_type: 'code', scope: 'talk_message', state: key });
    return Response.redirect(auth.toString(), 302);
  }

  // 2단계: 카카오에서 돌아옴 → 토큰 저장 → 시험 메시지
  if (url.searchParams.get('state') !== key) return page('접근 권한이 없습니다.', 403);
  try {
    await exchangeCode(code, redirectUri);
    await sendMemo('[DSR계산기] 카카오톡 알림 연결이 완료되었습니다. 이제 의견·문의가 오면 이 채팅으로 알려드립니다.', url.origin);
    return page('연결 완료! 카카오톡 &lsquo;나와의 채팅&rsquo;에서 시험 메시지를 확인하세요.');
  } catch (e) {
    return page(`연결 실패: ${e.message}`, 500);
  }
};
