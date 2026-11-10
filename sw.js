// 오프라인 실행용 캐시. index.html 등을 수정하면 VERSION 값을 올려주세요.
const VERSION = 'dsr-v119';
const FILES = ['./', './index.html', './policy.html', './bank.html', './rules.html', './idscan.html', './manifest.webmanifest', './icon-192.png', './logo-head.png', './icon-512.png', './apple-touch-icon.png', './splash2.jpg'];

self.addEventListener('install', e => {
  // 설치할 때도 브라우저 저장본이 아닌 서버의 최신 파일로 채움
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 네트워크 우선, 실패하면(오프라인) 캐시 사용
// 사이트 파일은 매번 서버에 바뀌었는지 확인(no-cache) → 올린 직후에도 앱을 다시 열면 새 버전
// (GitHub Pages는 파일을 10분간 저장해 두라고 보내서, 그대로 두면 최대 10분 예전 화면이 보임)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/.netlify/')) return;   // 서버 함수는 캐시하지 않음
  if (u.pathname.startsWith('/cs/')) return;   // 고객관리(/cs/)는 자체 서비스워커가 관리
  if (/google/.test(u.hostname)) return;   // 방문자 분석은 캐시하지 않음
  e.respondWith(
    fetch(u.origin === self.location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
