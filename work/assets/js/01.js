    (function () {
      // v37: the app always opens in light mode; the switch in the header changes it for this visit
      var t = 'light';
      try { localStorage.setItem('vwTheme', 'light'); } catch (e) {}
      document.documentElement.setAttribute('data-theme', t);
    })();
  