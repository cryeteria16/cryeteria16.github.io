    (function () {
      var V = ['navy','navy-mid','navy-lt','accent','accent-lt','bg','bg-card','border','border-dk','text','text-2','text-3','solid','solid-hover','glow-1','glow-2','hover-row','head-2','title-end','link-soft'];
      function row(a) { var o = {}; V.forEach(function (k, i) { o[k] = a[i]; }); return o; }
      var T = window.VW_THEMES = {
        amethyst: { name: 'Amethyst', note: 'Deep violet with a rose accent',
          light: row(['#2A1652','#4B2A8A','#6E44D0','#D63B74','#FCE7F0','#F7F5FC','#FFFFFF','#E7E2F3','#CFC6E6','#1A1230','#4A3F66','#7F749A','#6D3FD1','#7C52DB','rgba(124,77,219,.16)','rgba(214,59,116,.08)','#F1ECFB','#2A1652','#7C4DDB','#6E44D0']),
          dark:  row(['#E2D9FA','#A98BF0','#9B7BF0','#FF6FA3','rgba(255,111,163,.16)','#0F0B1A','#18132A','#2A2342','#3B3259','#EEEAF7','#C3BAD8','#9187AD','#6D3FD1','#7C52DB','rgba(155,123,240,.18)','rgba(255,111,163,.08)','#211A36','#221A3A','#C4A8FF','#C4A8FF']) },
        midnight: { name: 'Midnight', note: 'The original navy blue',
          light: row(['#0F2140','#1B365D','#2A4A7F','#E31837','#FEE8EC','#F7F8FB','#FFFFFF','#E4E8F0','#C8D0E0','#0F1824','#3D4F6A','#7A8CA8','#1B365D','#2A4A7F','rgba(91,141,239,.16)','rgba(227,24,55,.07)','#EEF2F9','#0F2140','#2A4A7F','#2A4A7F']),
          dark:  row(['#C9D7F0','#6E9BF2','#5B8DEF','#FF5A6E','rgba(255,90,110,.16)','#0B1220','#121B2E','#22304A','#33445F','#E6ECF5','#B5C2D6','#8A9BB5','#2D5BB0','#3A6AC4','rgba(91,141,239,.14)','rgba(255,90,110,.07)','#18243A','#16264A','#8FB1F2','#9DB8EE']) },
        aurora: { name: 'Aurora', note: 'Teal with a warm amber accent',
          light: row(['#0B3B3A','#0F5C59','#0B7C76','#D9762B','#FDEEDF','#F4F9F8','#FFFFFF','#DDECEA','#BFD9D5','#0C1E1D','#36514F','#6E8C89','#0F7F79','#12968F','rgba(20,160,152,.15)','rgba(242,153,74,.08)','#EAF5F3','#0B3B3A','#0F8F88','#0B7C76']),
          dark:  row(['#CDEFEB','#5FD4C9','#2DD4BF','#FFB070','rgba(255,176,112,.16)','#071413','#0E1F1E','#1C3533','#2B4A47','#E3F4F2','#A9CBC7','#7FA29E','#0F7F79','#139A92','rgba(45,212,191,.14)','rgba(255,176,112,.07)','#112826','#0F2B29','#7BE3D6','#7BE3D6']) },
        sunset: { name: 'Sunset', note: 'Warm coral and terracotta',
          light: row(['#3D1A12','#7A2E1C','#C24A28','#C2185B','#FCE4EE','#FBF7F4','#FFFFFF','#F0E4DC','#E0CBBE','#22140F','#5C4238','#94796F','#C24A28','#D65A34','rgba(226,96,58,.14)','rgba(194,24,91,.07)','#FAEFE9','#3D1A12','#D0562F','#C24A28']),
          dark:  row(['#FFE1D6','#FF9E7A','#FF8A5C','#FF6FA3','rgba(255,111,163,.15)','#140C0A','#1F1411','#36241E','#4A332B','#F7ECE8','#D6BFB6','#A88E84','#C24A28','#D65A34','rgba(255,138,92,.14)','rgba(255,111,163,.07)','#2A1B16','#2A1914','#FFB596','#FFB596']) },
        forest: { name: 'Forest', note: 'Calm green with a gold accent',
          light: row(['#13301F','#1F4D33','#277A4C','#C26A05','#FEF3C7','#F5F8F5','#FFFFFF','#E0E9E2','#C3D4C7','#0F1C14','#3B5244','#71867A','#2E7D50','#36905D','rgba(46,139,87,.14)','rgba(217,119,6,.07)','#ECF4EE','#13301F','#2E8B57','#277A4C']),
          dark:  row(['#D4EEDD','#7FD3A0','#4ADE80','#FBBF24','rgba(251,191,36,.15)','#08110C','#101C15','#1F3227','#2D4637','#E4F2E9','#AEC8B8','#84A08F','#2E7D50','#36905D','rgba(74,222,128,.12)','rgba(251,191,36,.06)','#142419','#13261A','#86E3A8','#86E3A8']) },
        agfs: { name: 'AGFS', note: 'Al Ghurair deep purple and white',
          light: row(['#2A0F42','#4A1A70','#5E2A8C','#C2185B','#FCE4EE','#F8F6FB','#FFFFFF','#E8E2F0','#D3C7E2','#1C1326','#4D4060','#6F6382','#4A1A70','#5E2A8C','rgba(74,26,112,.12)','rgba(194,24,91,.05)','#F3EEF9','#2A0F42','#5E2A8C','#5E2A8C']),
          dark:  row(['#E6DAF5','#B48AE0','#A77BDB','#FF6FA3','rgba(255,111,163,.15)','#0E0816','#170F22','#2B1F3D','#3C2C55','#F1EDF6','#C9BEDA','#9A8EAF','#4A1A70','#5E2A8C','rgba(167,123,219,.14)','rgba(255,111,163,.06)','#1E1430','#241236','#CDB2F0','#CDB2F0']) },
        graphite: { name: 'Graphite', note: 'Neutral grey with an indigo accent',
          light: row(['#111827','#374151','#4F46E5','#E11D48','#FFE4E6','#F6F7F9','#FFFFFF','#E5E7EB','#D1D5DB','#111827','#4B5563','#7D8490','#374151','#4B5563','rgba(79,70,229,.10)','rgba(225,29,72,.05)','#F0F1F4','#111827','#4F46E5','#4F46E5']),
          dark:  row(['#E5E7EB','#A5B4FC','#818CF8','#FB7185','rgba(251,113,133,.15)','#0B0B0F','#15161B','#26272F','#363844','#ECEDF1','#B4B7C2','#868A97','#4F46E5','#6366F1','rgba(129,140,248,.12)','rgba(251,113,133,.05)','#1C1D24','#1A1B22','#A5B4FC','#A5B4FC']) }
      };
      var css = '';
      Object.keys(T).forEach(function (k) {
        ['light', 'dark'].forEach(function (m) {
          var s = T[k][m], body = '';
          V.forEach(function (v) { body += '--' + v + ':' + s[v] + ';'; });
          css += 'html[data-palette="' + k + '"][data-theme="' + m + '"]{' + body + '}\n';
        });
      });
      var st = document.createElement('style'); st.id = 'vw-palettes'; st.textContent = '@media screen{' + css + '}';
      document.head.appendChild(st);
      var p = '';
      try { p = localStorage.getItem('vwPalette') || ''; } catch (e) {}
      if (!T[p]) p = 'amethyst';
      document.documentElement.setAttribute('data-palette', p);
    })();
  