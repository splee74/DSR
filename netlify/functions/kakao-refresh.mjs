// 매주 카카오 토큰을 갱신해 연결이 만료되지 않게 유지
import { refresh } from '../lib/kakao.mjs';

export default async () => {
  try { await refresh(); } catch (e) { console.error(e.message); }
};

export const config = { schedule: '@weekly' };
