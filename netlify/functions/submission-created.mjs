// 의견·문의 폼이 접수되면 Netlify가 자동으로 실행 → 카카오톡 나와의 채팅으로 전송
import { sendMemo } from '../lib/kakao.mjs';

export default async req => {
  const { payload } = await req.json();
  if (!payload || payload.form_name !== 'feedback') return new Response('skip');
  const d = payload.data || {};
  const text = `[DSR계산기 ${d.type || '문의'}]\n이름: ${d.name || '-'}\n연락처: ${d.phone || '-'}\n\n${d.message || ''}`;
  try {
    await sendMemo(text, process.env.URL || new URL(req.url).origin);
  } catch (e) {
    console.error(e.message);   // 실패해도 접수 내용은 Netlify Forms에 남아 있음
  }
  return new Response('ok');
};
