/* 앱 안 화면 이동 · 휴대폰 [뒤로] 처리 (모든 화면 공통)
   1) 앱 안 링크는 이동 기록을 쌓지 않고 '바꿔치기'로 이동 → 시작 화면에서 [뒤로]를 눌러도 예전 화면이 줄줄이 나오지 않음
   2) appBack(fn) : 휴대폰 [뒤로]를 누르면 fn 실행 (각 화면이 돌아갈 곳을 정함)
      fn 이 false 를 돌려주면 다시 걸지 않음 → 돌려받은 arm() 을 직접 불러 다시 걸 수 있음
      CloseWatcher(안드로이드 크롬)를 먼저 쓰고, 없으면 기록 한 칸(pushState)으로 대신함 */
(() => {
  const APP = /^\/(index\.html)?$|^\/(bank|idscan|policy|rules)\.html$|^\/calc\/([a-z]+\.html)?$/;
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]'); if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    let u; try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin || !APP.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return;   // 같은 화면 안 이동(#)
    e.preventDefault();
    location.replace(u.href);
  });

  const CW = 'CloseWatcher' in window;
  window.appBack = fn => {
    let armed = false, want = false, w = null;
    // 기록 방식: 크롬은 사용자가 누르기 전에 만든 기록을 [뒤로]에서 건너뛰므로, 화면을 누른 뒤에 한 칸 만듦
    const push = () => {
      if (!want || armed) return;
      try { history.pushState({ appBack: 1 }, '', location.href); armed = true; want = false; } catch (_) {}
    };
    const arm = () => {
      if (CW) {
        if (armed) return; armed = true;
        try { w = new CloseWatcher(); } catch (_) { armed = false; return; }
        w.onclose = () => { armed = false; w = null; if (fn() !== false) setTimeout(arm, 0); };
      } else {
        want = true;
        if (!navigator.userActivation || navigator.userActivation.isActive) push();
      }
    };
    if (!CW) {
      ['click', 'keydown', 'pointerup'].forEach(t => addEventListener(t, push, true));
      addEventListener('popstate', () => {
        if (!armed || (history.state && history.state.appBack)) return;
        armed = false; if (fn() !== false) arm();
      });
    }
    arm();
    return { arm, mode: CW ? 'watcher' : 'history' };
  };
  // 앱 끝내기: 창 닫기 → 안 되면 앱에 들어오기 전 화면으로 → 그래도 남아 있으면 false
  window.appExit = () => new Promise(res => {
    try { window.close(); } catch (_) {}
    setTimeout(() => {
      if (document.visibilityState === 'hidden') return res(true);
      try { if (history.length > 1) history.back(); } catch (_) {}
      setTimeout(() => res(document.visibilityState === 'hidden'), 600);
    }, 300);
  });
})();
