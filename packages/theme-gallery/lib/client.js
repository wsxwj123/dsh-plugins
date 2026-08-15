window.__ModuleLoader__.load({ id: "dsh-theme-gallery", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  const React = require('react');
// Curated theme families with native DSH light/dark token pairs.
const THEME_FAMILIES = [{"id":"jade","label":"翠玉 / Jade","preview":{"light":{"background":"#ededed","accent":"#07c160"},"dark":{"background":"#111","accent":"#07c160"}},"tokens":{"--dsw-alias-bg-base":{"light":"#ededed","dark":"#111"},"--dsw-alias-bg-layer-1":{"light":"#fff","dark":"#1e1e1e"},"--dsw-alias-bg-layer-2":{"light":"#e3e3e3","dark":"#2a2a2a"},"--dsw-alias-bg-overlay":{"light":"#fff","dark":"#1e1e1e"},"--dsw-alias-border-l1":{"light":"#c4c4c4","dark":"#4a4a4a"},"--dsw-alias-border-l2":{"light":"#80C3A0","dark":"#327552"},"--dsw-alias-brand-primary":{"light":"#07c160","dark":"#07c160"},"--dsw-alias-button-ghost-active-border":{"light":"#4FC286","dark":"#209458"},"--dsw-alias-button-ghost-active-fill":{"light":"#D7F5E6","dark":"#1A3829"},"--dsw-alias-button-ghost-active-hover":{"light":"#BCEED4","dark":"#184A30"},"--dsw-alias-button-info-fill":{"light":"#07c160","dark":"#07c160"},"--dsw-alias-button-info-hover":{"light":"#06ad56","dark":"#38d07f"},"--dsw-alias-button-primary-dimmed":{"light":"#BAEED2","dark":"#184C30"},"--dsw-alias-button-primary-fill":{"light":"#07c160","dark":"#07c160"},"--dsw-alias-button-primary-hover":{"light":"#06ad56","dark":"#38d07f"},"--dsw-alias-button-tool-bar-fill":{"light":"#DAF6E7","dark":"#1B3628"},"--dsw-alias-button-tool-bar-hover":{"light":"#BCEED4","dark":"#184A30"},"--dsw-alias-label-primary":{"light":"#1a1a1a","dark":"#ededed"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#6b6b6b","dark":"#909090"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#fff","dark":"#1e1e1e"}}},{"id":"terracotta","label":"陶土 / Terracotta","preview":{"light":{"background":"#faf7f2","accent":"#d97757"},"dark":{"background":"#1f1d1a","accent":"#d97757"}},"tokens":{"--dsw-alias-bg-base":{"light":"#faf7f2","dark":"#1f1d1a"},"--dsw-alias-bg-layer-1":{"light":"#f2ede3","dark":"#29251f"},"--dsw-alias-bg-layer-2":{"light":"#ebe5d8","dark":"#332e27"},"--dsw-alias-bg-overlay":{"light":"#f2ede3","dark":"#29251f"},"--dsw-alias-border-l1":{"light":"#c7bdb5","dark":"#4a453e"},"--dsw-alias-border-l2":{"light":"#CDA493","dark":"#7D5747"},"--dsw-alias-brand-primary":{"light":"#d97757","dark":"#d97757"},"--dsw-alias-button-ghost-active-border":{"light":"#D2927B","dark":"#A3644E"},"--dsw-alias-button-ghost-active-fill":{"light":"#EEDACD","dark":"#453228"},"--dsw-alias-button-ghost-active-hover":{"light":"#EBCDBD","dark":"#593B2E"},"--dsw-alias-button-info-fill":{"light":"#d97757","dark":"#d97757"},"--dsw-alias-button-info-hover":{"light":"#c26545","dark":"#e68a6b"},"--dsw-alias-button-primary-dimmed":{"light":"#EBCCBC","dark":"#5A3C2F"},"--dsw-alias-button-primary-fill":{"light":"#d97757","dark":"#d97757"},"--dsw-alias-button-primary-hover":{"light":"#c26545","dark":"#e68a6b"},"--dsw-alias-button-tool-bar-fill":{"light":"#EEDBCE","dark":"#433127"},"--dsw-alias-button-tool-bar-hover":{"light":"#EBCDBD","dark":"#593B2E"},"--dsw-alias-label-primary":{"light":"#1a1a1a","dark":"#f5f0e8"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#6b6260","dark":"#a69e92"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f2ede3","dark":"#29251f"}}},{"id":"ember","label":"余烬 / Ember","preview":{"light":{"background":"#fafafa","accent":"#d2691e"},"dark":{"background":"#0a0a0a","accent":"#fab283"}},"tokens":{"--dsw-alias-bg-base":{"light":"#fafafa","dark":"#0a0a0a"},"--dsw-alias-bg-layer-1":{"light":"#f0f0f0","dark":"#141414"},"--dsw-alias-bg-layer-2":{"light":"#e0e0e0","dark":"#1e1e1e"},"--dsw-alias-bg-overlay":{"light":"#f0f0f0","dark":"#141414"},"--dsw-alias-border-l1":{"light":"#b0b0b0","dark":"#404040"},"--dsw-alias-border-l2":{"light":"#BC967B","dark":"#836958"},"--dsw-alias-brand-primary":{"light":"#d2691e","dark":"#fab283"},"--dsw-alias-button-ghost-active-border":{"light":"#C58455","dark":"#B3876A"},"--dsw-alias-button-ghost-active-fill":{"light":"#EBDACE","dark":"#392D26"},"--dsw-alias-button-ghost-active-hover":{"light":"#E8CCB7","dark":"#523F32"},"--dsw-alias-button-info-fill":{"light":"#d2691e","dark":"#fab283"},"--dsw-alias-button-info-hover":{"light":"#b85816","dark":"#ffcb9f"},"--dsw-alias-button-primary-dimmed":{"light":"#E8CAB5","dark":"#544033"},"--dsw-alias-button-primary-fill":{"light":"#d2691e","dark":"#fab283"},"--dsw-alias-button-primary-hover":{"light":"#b85816","dark":"#ffcb9f"},"--dsw-alias-button-tool-bar-fill":{"light":"#ECDCD0","dark":"#362C25"},"--dsw-alias-button-tool-bar-hover":{"light":"#E8CCB7","dark":"#523F32"},"--dsw-alias-label-primary":{"light":"#1a1a1a","dark":"#eee"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#0a0a0a"},"--dsw-alias-label-secondary":{"light":"#606060","dark":"gray"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f0f0f0","dark":"#141414"}}},{"id":"starlight","label":"星夜 / Starlight","preview":{"light":{"background":"#e1e2e7","accent":"#2e7de9"},"dark":{"background":"#1a1b26","accent":"#82aaff"}},"tokens":{"--dsw-alias-bg-base":{"light":"#e1e2e7","dark":"#1a1b26"},"--dsw-alias-bg-layer-1":{"light":"#d5d6db","dark":"#1e2030"},"--dsw-alias-bg-layer-2":{"light":"#b3b5be","dark":"#222436"},"--dsw-alias-bg-overlay":{"light":"#d5d6db","dark":"#1e2030"},"--dsw-alias-border-l1":{"light":"#9699a8","dark":"#3b4261"},"--dsw-alias-border-l2":{"light":"#718FBF","dark":"#55679A"},"--dsw-alias-brand-primary":{"light":"#2e7de9","dark":"#82aaff"},"--dsw-alias-button-ghost-active-border":{"light":"#5688D0","dark":"#6782C3"},"--dsw-alias-button-ghost-active-fill":{"light":"#BAC8DD","dark":"#2E3651"},"--dsw-alias-button-ghost-active-hover":{"light":"#A8BEDF","dark":"#394568"},"--dsw-alias-button-info-fill":{"light":"#2e7de9","dark":"#82aaff"},"--dsw-alias-button-info-hover":{"light":"#1a6ce7","dark":"#98b8ff"},"--dsw-alias-button-primary-dimmed":{"light":"#A6BDDF","dark":"#3A476A"},"--dsw-alias-button-primary-fill":{"light":"#2e7de9","dark":"#82aaff"},"--dsw-alias-button-primary-hover":{"light":"#1a6ce7","dark":"#98b8ff"},"--dsw-alias-button-tool-bar-fill":{"light":"#BCC9DD","dark":"#2D354F"},"--dsw-alias-button-tool-bar-hover":{"light":"#A8BEDF","dark":"#394568"},"--dsw-alias-label-primary":{"light":"#3760bf","dark":"#c8d3f5"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#0A0A0A"},"--dsw-alias-label-secondary":{"light":"#737a8c","dark":"#737aa2"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#d5d6db","dark":"#1e2030"}}},{"id":"rose-mist","label":"蔷薇雾 / Rose Mist","preview":{"light":{"background":"#faf4ed","accent":"#31748f"},"dark":{"background":"#191724","accent":"#9ccfd8"}},"tokens":{"--dsw-alias-bg-base":{"light":"#faf4ed","dark":"#191724"},"--dsw-alias-bg-layer-1":{"light":"#fffaf3","dark":"#1f1d2e"},"--dsw-alias-bg-layer-2":{"light":"#dfdad9","dark":"#26233a"},"--dsw-alias-bg-overlay":{"light":"#fffaf3","dark":"#1f1d2e"},"--dsw-alias-border-l1":{"light":"#c9c4d2","dark":"#403d52"},"--dsw-alias-border-l2":{"light":"#92A7BA","dark":"#617282"},"--dsw-alias-brand-primary":{"light":"#31748f","dark":"#9ccfd8"},"--dsw-alias-button-ghost-active-border":{"light":"#6B92A8","dark":"#7998A5"},"--dsw-alias-button-ghost-active-fill":{"light":"#DEE5E3","dark":"#333949"},"--dsw-alias-button-ghost-active-hover":{"light":"#C7D6D8","dark":"#414D5C"},"--dsw-alias-button-info-fill":{"light":"#31748f","dark":"#9ccfd8"},"--dsw-alias-button-info-hover":{"light":"#286983","dark":"#b7dfe7"},"--dsw-alias-button-primary-dimmed":{"light":"#C5D4D7","dark":"#424F5E"},"--dsw-alias-button-primary-fill":{"light":"#31748f","dark":"#9ccfd8"},"--dsw-alias-button-primary-hover":{"light":"#286983","dark":"#b7dfe7"},"--dsw-alias-button-tool-bar-fill":{"light":"#E0E6E4","dark":"#323848"},"--dsw-alias-button-tool-bar-hover":{"light":"#C7D6D8","dark":"#414D5C"},"--dsw-alias-label-primary":{"light":"#575279","dark":"#e0def4"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#191724"},"--dsw-alias-label-secondary":{"light":"#797593","dark":"#908caa"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#fffaf3","dark":"#1f1d2e"}}},{"id":"amethyst","label":"紫晶 / Amethyst","preview":{"light":{"background":"#fffbeb","accent":"#644ac9"},"dark":{"background":"#282a36","accent":"#bd93f9"}},"tokens":{"--dsw-alias-bg-base":{"light":"#fffbeb","dark":"#282a36"},"--dsw-alias-bg-layer-1":{"light":"#f5f1e0","dark":"#383a4a"},"--dsw-alias-bg-layer-2":{"light":"#cfcfde","dark":"#44475a"},"--dsw-alias-bg-overlay":{"light":"#f5f1e0","dark":"#383a4a"},"--dsw-alias-border-l1":{"light":"#bdbaa8","dark":"#555766"},"--dsw-alias-border-l2":{"light":"#9D92B4","dark":"#7A6D9B"},"--dsw-alias-brand-primary":{"light":"#644ac9","dark":"#bd93f9"},"--dsw-alias-button-ghost-active-border":{"light":"#8675BC","dark":"#957CC1"},"--dsw-alias-button-ghost-active-fill":{"light":"#DED6DC","dark":"#4D4866"},"--dsw-alias-button-ghost-active-hover":{"light":"#CEC4DA","dark":"#5C5279"},"--dsw-alias-button-info-fill":{"light":"#644ac9","dark":"#bd93f9"},"--dsw-alias-button-info-hover":{"light":"#533cb0","dark":"#d0aefb"},"--dsw-alias-button-primary-dimmed":{"light":"#CCC2DA","dark":"#5D537B"},"--dsw-alias-button-primary-fill":{"light":"#644ac9","dark":"#bd93f9"},"--dsw-alias-button-primary-hover":{"light":"#533cb0","dark":"#d0aefb"},"--dsw-alias-button-tool-bar-fill":{"light":"#DFD8DD","dark":"#4C4764"},"--dsw-alias-button-tool-bar-hover":{"light":"#CEC4DA","dark":"#5C5279"},"--dsw-alias-label-primary":{"light":"#1f1f1f","dark":"#f8f8f2"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#0A0A0A"},"--dsw-alias-label-secondary":{"light":"#6c664b","dark":"#bfbfb8"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f5f1e0","dark":"#383a4a"}}},{"id":"amber-retro","label":"琥珀旧梦 / Amber Retro","preview":{"light":{"background":"#fbf1c7","accent":"#076678"},"dark":{"background":"#282828","accent":"#fe8019"}},"tokens":{"--dsw-alias-bg-base":{"light":"#fbf1c7","dark":"#282828"},"--dsw-alias-bg-layer-1":{"light":"#f2e5bc","dark":"#3c3836"},"--dsw-alias-bg-layer-2":{"light":"#d5c4a1","dark":"#504945"},"--dsw-alias-bg-overlay":{"light":"#f2e5bc","dark":"#3c3836"},"--dsw-alias-border-l1":{"light":"#a89984","dark":"#5a5450"},"--dsw-alias-border-l2":{"light":"#6E8780","dark":"#95643C"},"--dsw-alias-brand-primary":{"light":"#076678","dark":"#fe8019"},"--dsw-alias-button-ghost-active-border":{"light":"#44797D","dark":"#C06F2E"},"--dsw-alias-button-ghost-active-fill":{"light":"#CCD1B1","dark":"#5B4431"},"--dsw-alias-button-ghost-active-hover":{"light":"#B3C3AA","dark":"#704B2E"},"--dsw-alias-button-info-fill":{"light":"#076678","dark":"#fe8019"},"--dsw-alias-button-info-hover":{"light":"#427b58","dark":"#ffa94d"},"--dsw-alias-button-primary-dimmed":{"light":"#B0C1A9","dark":"#724C2E"},"--dsw-alias-button-primary-fill":{"light":"#076678","dark":"#fe8019"},"--dsw-alias-button-primary-hover":{"light":"#427b58","dark":"#ffa94d"},"--dsw-alias-button-tool-bar-fill":{"light":"#CFD2B2","dark":"#594332"},"--dsw-alias-button-tool-bar-hover":{"light":"#B3C3AA","dark":"#704B2E"},"--dsw-alias-label-primary":{"light":"#3c3836","dark":"#ebdbb2"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#7c6f64","dark":"#a89984"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f2e5bc","dark":"#3c3836"}}},{"id":"ink-river","label":"墨川 / Ink River","preview":{"light":{"background":"#f2e9de","accent":"#2d4f67"},"dark":{"background":"#1f1f28","accent":"#7e9cd8"}},"tokens":{"--dsw-alias-bg-base":{"light":"#f2e9de","dark":"#1f1f28"},"--dsw-alias-bg-layer-1":{"light":"#eae4d7","dark":"#2a2a37"},"--dsw-alias-bg-layer-2":{"light":"#c9bfb1","dark":"#363646"},"--dsw-alias-bg-overlay":{"light":"#eae4d7","dark":"#2a2a37"},"--dsw-alias-border-l1":{"light":"#bfb5a8","dark":"#54546d"},"--dsw-alias-border-l2":{"light":"#8A9091","dark":"#636E94"},"--dsw-alias-brand-primary":{"light":"#2d4f67","dark":"#7e9cd8"},"--dsw-alias-button-ghost-active-border":{"light":"#647680","dark":"#6E81AF"},"--dsw-alias-button-ghost-active-fill":{"light":"#CCCCC5","dark":"#373C51"},"--dsw-alias-button-ghost-active-hover":{"light":"#B7BCB9","dark":"#414962"},"--dsw-alias-button-info-fill":{"light":"#2d4f67","dark":"#7e9cd8"},"--dsw-alias-button-info-hover":{"light":"#1f3a4d","dark":"#9cb4e0"},"--dsw-alias-button-primary-dimmed":{"light":"#B5BAB8","dark":"#424A64"},"--dsw-alias-button-primary-fill":{"light":"#2d4f67","dark":"#7e9cd8"},"--dsw-alias-button-primary-hover":{"light":"#1f3a4d","dark":"#9cb4e0"},"--dsw-alias-button-tool-bar-fill":{"light":"#CECEC6","dark":"#373B4F"},"--dsw-alias-button-tool-bar-hover":{"light":"#B7BCB9","dark":"#414962"},"--dsw-alias-label-primary":{"light":"#54433a","dark":"#dcd7ba"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#0A0A0A"},"--dsw-alias-label-secondary":{"light":"#7e6b5a","dark":"#957fb8"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#eae4d7","dark":"#2a2a37"}}},{"id":"mossland","label":"苔境 / Mossland","preview":{"light":{"background":"#fff","accent":"#4b8b3b"},"dark":{"background":"#1a211c","accent":"#7fc06e"}},"tokens":{"--dsw-alias-bg-base":{"light":"#fff","dark":"#1a211c"},"--dsw-alias-bg-layer-1":{"light":"#f2f7ee","dark":"#232e26"},"--dsw-alias-bg-layer-2":{"light":"#dce8d4","dark":"#2e3b30"},"--dsw-alias-bg-overlay":{"light":"#f2f7ee","dark":"#232e26"},"--dsw-alias-border-l1":{"light":"#b8cdb9","dark":"#3e5240"},"--dsw-alias-border-l2":{"light":"#91B58C","dark":"#557A51"},"--dsw-alias-brand-primary":{"light":"#4b8b3b","dark":"#7fc06e"},"--dsw-alias-button-ghost-active-border":{"light":"#74A46B","dark":"#66965D"},"--dsw-alias-button-ghost-active-fill":{"light":"#D7E6D1","dark":"#324532"},"--dsw-alias-button-ghost-active-hover":{"light":"#C5DABE","dark":"#3C5539"},"--dsw-alias-button-info-fill":{"light":"#4b8b3b","dark":"#7fc06e"},"--dsw-alias-button-info-hover":{"light":"#3a7a2e","dark":"#95d183"},"--dsw-alias-button-primary-dimmed":{"light":"#C3D9BC","dark":"#3D573A"},"--dsw-alias-button-primary-fill":{"light":"#4b8b3b","dark":"#7fc06e"},"--dsw-alias-button-primary-hover":{"light":"#3a7a2e","dark":"#95d183"},"--dsw-alias-button-tool-bar-fill":{"light":"#D9E7D3","dark":"#314431"},"--dsw-alias-button-tool-bar-hover":{"light":"#C5DABE","dark":"#3C5539"},"--dsw-alias-label-primary":{"light":"#2c4a33","dark":"#a8d5a2"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#1a211c"},"--dsw-alias-label-secondary":{"light":"#5e7a63","dark":"#7aa876"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f2f7ee","dark":"#232e26"}}},{"id":"eclipse","label":"日蚀 / Eclipse","preview":{"light":{"background":"#fdf6e3","accent":"#268bd2"},"dark":{"background":"#002b36","accent":"#268bd2"}},"tokens":{"--dsw-alias-bg-base":{"light":"#fdf6e3","dark":"#002b36"},"--dsw-alias-bg-layer-1":{"light":"#f5efd6","dark":"#073642"},"--dsw-alias-bg-layer-2":{"light":"#c8c2a6","dark":"#0e4451"},"--dsw-alias-bg-overlay":{"light":"#f5efd6","dark":"#073642"},"--dsw-alias-border-l1":{"light":"#b7b19a","dark":"#3e5660"},"--dsw-alias-border-l2":{"light":"#83A3AE","dark":"#356989"},"--dsw-alias-brand-primary":{"light":"#268bd2","dark":"#268bd2"},"--dsw-alias-button-ghost-active-border":{"light":"#5D99BD","dark":"#2F77A7"},"--dsw-alias-button-ghost-active-fill":{"light":"#D4DFD5","dark":"#0C4459"},"--dsw-alias-button-ghost-active-hover":{"light":"#BDD4D5","dark":"#0F4D69"},"--dsw-alias-button-info-fill":{"light":"#268bd2","dark":"#268bd2"},"--dsw-alias-button-info-hover":{"light":"#1e6ba0","dark":"#459bdb"},"--dsw-alias-button-primary-dimmed":{"light":"#BBD3D5","dark":"#104E6A"},"--dsw-alias-button-primary-fill":{"light":"#268bd2","dark":"#268bd2"},"--dsw-alias-button-primary-hover":{"light":"#1e6ba0","dark":"#459bdb"},"--dsw-alias-button-tool-bar-fill":{"light":"#D6E0D5","dark":"#0C4358"},"--dsw-alias-button-tool-bar-hover":{"light":"#BDD4D5","dark":"#0F4D69"},"--dsw-alias-label-primary":{"light":"#586e75","dark":"#93a1a1"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#839496","dark":"#657b83"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f5efd6","dark":"#073642"}}},{"id":"horizon","label":"天际 / Horizon","preview":{"light":{"background":"#eef5fa","accent":"#c8901e"},"dark":{"background":"#141e28","accent":"#f0c24e"}},"tokens":{"--dsw-alias-bg-base":{"light":"#eef5fa","dark":"#141e28"},"--dsw-alias-bg-layer-1":{"light":"#f7fbfd","dark":"#1c2a36"},"--dsw-alias-bg-layer-2":{"light":"#cbdce8","dark":"#2e4152"},"--dsw-alias-bg-overlay":{"light":"#f7fbfd","dark":"#1c2a36"},"--dsw-alias-border-l1":{"light":"#afc0cc","dark":"#4a5964"},"--dsw-alias-border-l2":{"light":"#B8AF8D","dark":"#867F5C"},"--dsw-alias-brand-primary":{"light":"#c8901e","dark":"#f0c24e"},"--dsw-alias-button-ghost-active-border":{"light":"#BEA260","dark":"#B19A56"},"--dsw-alias-button-ghost-active-fill":{"light":"#EFEAD9","dark":"#3E423A"},"--dsw-alias-button-ghost-active-hover":{"light":"#EADEC1","dark":"#55533C"},"--dsw-alias-button-info-fill":{"light":"#c8901e","dark":"#f0c24e"},"--dsw-alias-button-info-hover":{"light":"#b37f16","dark":"#e3b23a"},"--dsw-alias-button-primary-dimmed":{"light":"#EADDBF","dark":"#57553D"},"--dsw-alias-button-primary-fill":{"light":"#c8901e","dark":"#f0c24e"},"--dsw-alias-button-primary-hover":{"light":"#b37f16","dark":"#e3b23a"},"--dsw-alias-button-tool-bar-fill":{"light":"#F0EBDC","dark":"#3C413A"},"--dsw-alias-button-tool-bar-hover":{"light":"#EADEC1","dark":"#55533C"},"--dsw-alias-label-primary":{"light":"#1f2e3a","dark":"#e6eef4"},"--dsw-alias-label-primary-foreground":{"light":"#2a2013","dark":"#241b0c"},"--dsw-alias-label-secondary":{"light":"#4a5d6b","dark":"#a8bac6"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#f7fbfd","dark":"#1c2a36"}}},{"id":"azure","label":"晴蓝 / Azure","preview":{"light":{"background":"#FFFFFF","accent":"#005FB8"},"dark":{"background":"#1F1F1F","accent":"#0078D4"}},"tokens":{"--dsw-alias-bg-base":{"light":"#FFFFFF","dark":"#1F1F1F"},"--dsw-alias-bg-layer-1":{"light":"#F8F8F8","dark":"#181818"},"--dsw-alias-bg-layer-2":{"light":"#FFFFFF","dark":"#313131"},"--dsw-alias-bg-overlay":{"light":"#F8F8F8","dark":"#1F1F1F"},"--dsw-alias-border-l1":{"light":"#E5E5E5","dark":"#2B2B2B"},"--dsw-alias-border-l2":{"light":"#005FB8","dark":"#0078D4"},"--dsw-alias-brand-primary":{"light":"#005FB8","dark":"#0078D4"},"--dsw-alias-button-ghost-active-border":{"light":"#5792C9","dark":"#105B94"},"--dsw-alias-button-ghost-active-fill":{"light":"#D0E0EE","dark":"#142736"},"--dsw-alias-button-ghost-active-hover":{"light":"#B5CFE7","dark":"#12324B"},"--dsw-alias-button-info-fill":{"light":"#005FB8","dark":"#0078D4"},"--dsw-alias-button-info-hover":{"light":"#0258A8","dark":"#026EC1"},"--dsw-alias-button-primary-dimmed":{"light":"#B3CDE6","dark":"#11334D"},"--dsw-alias-button-primary-fill":{"light":"#005FB8","dark":"#0078D4"},"--dsw-alias-button-primary-hover":{"light":"#0258A8","dark":"#026EC1"},"--dsw-alias-button-tool-bar-fill":{"light":"#D3E1EE","dark":"#142634"},"--dsw-alias-button-tool-bar-hover":{"light":"#B5CFE7","dark":"#12324B"},"--dsw-alias-label-primary":{"light":"#3B3B3B","dark":"#CCCCCC"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#3B3B3B","dark":"#9D9D9D"},"--dsw-alias-state-error-primary":{"light":"#F85149","dark":"#F85149"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#F8F8F8","dark":"#181818"}}},{"id":"monochrome","label":"黑白界 / Monochrome","preview":{"light":{"background":"#FFFFFF","accent":"#292929"},"dark":{"background":"#000000","accent":"#000080"}},"tokens":{"--dsw-alias-bg-base":{"light":"#FFFFFF","dark":"#000000"},"--dsw-alias-bg-layer-1":{"light":"#F0F0F0","dark":"#0F0F0F"},"--dsw-alias-bg-layer-2":{"light":"#DDDDDD","dark":"#222222"},"--dsw-alias-bg-overlay":{"light":"#F0F0F0","dark":"#0F0F0F"},"--dsw-alias-border-l1":{"light":"#C0C0C0","dark":"#434343"},"--dsw-alias-border-l2":{"light":"#8C8C8C","dark":"#13134C"},"--dsw-alias-brand-primary":{"light":"#292929","dark":"#000080"},"--dsw-alias-button-ghost-active-border":{"light":"#626262","dark":"#191969"},"--dsw-alias-button-ghost-active-fill":{"light":"#D0D0D0","dark":"#0D0D21"},"--dsw-alias-button-ghost-active-hover":{"light":"#BABABA","dark":"#0B0B2E"},"--dsw-alias-button-info-fill":{"light":"#292929","dark":"#000080"},"--dsw-alias-button-info-hover":{"light":"#292929","dark":"#000080"},"--dsw-alias-button-primary-dimmed":{"light":"#B8B8B8","dark":"#0B0B2F"},"--dsw-alias-button-primary-fill":{"light":"#292929","dark":"#000080"},"--dsw-alias-button-primary-hover":{"light":"#292929","dark":"#000080"},"--dsw-alias-button-tool-bar-fill":{"light":"#D2D2D2","dark":"#0D0D20"},"--dsw-alias-button-tool-bar-hover":{"light":"#BABABA","dark":"#0B0B2E"},"--dsw-alias-label-primary":{"light":"#1A1A1A","dark":"#FFFFFF"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-label-secondary":{"light":"#818181","dark":"#8C8C8C"},"--dsw-alias-state-error-primary":{"light":"#D83A3A","dark":"#F05B5B"},"--dsw-alias-state-success-primary":{"light":"#168A4A","dark":"#52D681"},"--dsw-alias-state-warn-primary":{"light":"#B7791F","dark":"#F0B84B"},"--dsw-specific-sidebar-fill":{"light":"#F0F0F0","dark":"#0F0F0F"}}},{"id":"blush-dawn","label":"粉霞 / Blush Dawn","preview":{"light":{"background":"#FFFFFF","accent":"#C43D68"},"dark":{"background":"#171013","accent":"#FF86AD"}},"tokens":{"--dsw-alias-bg-base":{"light":"#FFFFFF","dark":"#171013"},"--dsw-alias-bg-layer-1":{"light":"#FFF8FA","dark":"#21171B"},"--dsw-alias-bg-layer-2":{"light":"#FCEAF0","dark":"#302128"},"--dsw-alias-bg-overlay":{"light":"#FFFFFF","dark":"#281B21"},"--dsw-alias-border-l1":{"light":"#F1D8E1","dark":"#49323C"},"--dsw-alias-border-l2":{"light":"#DFA8BA","dark":"#704859"},"--dsw-alias-brand-primary":{"light":"#C43D68","dark":"#FF86AD"},"--dsw-alias-button-ghost-active-border":{"light":"#D97B99","dark":"#B65E7B"},"--dsw-alias-button-ghost-active-fill":{"light":"#F9DDE6","dark":"#432A34"},"--dsw-alias-button-ghost-active-hover":{"light":"#F2C4D3","dark":"#5E3746"},"--dsw-alias-button-info-fill":{"light":"#C43D68","dark":"#FF86AD"},"--dsw-alias-button-info-hover":{"light":"#AA3158","dark":"#FFA0BE"},"--dsw-alias-button-primary-dimmed":{"light":"#F0C6D3","dark":"#5B3543"},"--dsw-alias-button-primary-fill":{"light":"#C43D68","dark":"#FF86AD"},"--dsw-alias-button-primary-hover":{"light":"#AA3158","dark":"#FFA0BE"},"--dsw-alias-button-tool-bar-fill":{"light":"#FBE3EB","dark":"#432A34"},"--dsw-alias-button-tool-bar-hover":{"light":"#F4C8D6","dark":"#5B3543"},"--dsw-alias-label-primary":{"light":"#24191D","dark":"#F8EBF0"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#211018"},"--dsw-alias-label-secondary":{"light":"#755C65","dark":"#C3A4AF"},"--dsw-alias-state-error-primary":{"light":"#C9364F","dark":"#FF7187"},"--dsw-alias-state-success-primary":{"light":"#218A58","dark":"#5DD694"},"--dsw-alias-state-warn-primary":{"light":"#AD6A16","dark":"#F1B85B"},"--dsw-specific-sidebar-fill":{"light":"#FFF6F9","dark":"#1D1418"}}},{"id":"lilac-mist","label":"紫雾 / Lilac Mist","preview":{"light":{"background":"#FFFFFF","accent":"#7651C9"},"dark":{"background":"#121018","accent":"#BDA6FF"}},"tokens":{"--dsw-alias-bg-base":{"light":"#FFFFFF","dark":"#121018"},"--dsw-alias-bg-layer-1":{"light":"#FBF9FF","dark":"#1C1826"},"--dsw-alias-bg-layer-2":{"light":"#F0EBFC","dark":"#292238"},"--dsw-alias-bg-overlay":{"light":"#FFFFFF","dark":"#231D30"},"--dsw-alias-border-l1":{"light":"#E3DAF5","dark":"#403653"},"--dsw-alias-border-l2":{"light":"#BEABE5","dark":"#625177"},"--dsw-alias-brand-primary":{"light":"#7651C9","dark":"#BDA6FF"},"--dsw-alias-button-ghost-active-border":{"light":"#A589D8","dark":"#8972BC"},"--dsw-alias-button-ghost-active-fill":{"light":"#E9E0F8","dark":"#382E4B"},"--dsw-alias-button-ghost-active-hover":{"light":"#D8C8F0","dark":"#4D4066"},"--dsw-alias-button-info-fill":{"light":"#7651C9","dark":"#BDA6FF"},"--dsw-alias-button-info-hover":{"light":"#6240B3","dark":"#CDBBFF"},"--dsw-alias-button-primary-dimmed":{"light":"#D9CEF1","dark":"#493D61"},"--dsw-alias-button-primary-fill":{"light":"#7651C9","dark":"#BDA6FF"},"--dsw-alias-button-primary-hover":{"light":"#6240B3","dark":"#CDBBFF"},"--dsw-alias-button-tool-bar-fill":{"light":"#EDE5FA","dark":"#382E4B"},"--dsw-alias-button-tool-bar-hover":{"light":"#DCCEF3","dark":"#4B3E63"},"--dsw-alias-label-primary":{"light":"#201A2B","dark":"#F2EEFC"},"--dsw-alias-label-primary-foreground":{"light":"#FFFFFF","dark":"#171022"},"--dsw-alias-label-secondary":{"light":"#6B607D","dark":"#B5A9C8"},"--dsw-alias-state-error-primary":{"light":"#C63F57","dark":"#FF748A"},"--dsw-alias-state-success-primary":{"light":"#238A5B","dark":"#62D89A"},"--dsw-alias-state-warn-primary":{"light":"#AD6C17","dark":"#F1BA60"},"--dsw-specific-sidebar-fill":{"light":"#F9F6FF","dark":"#181420"}}}]

// ---- custom theme registry / import / preview / apply / delete / restore ----
/**
 * custom-theme.js — 自定义主题：JSON 导入校验 + registry + 试穿/应用/删除/恢复（无 React 依赖）。
 *
 * CSS-only 设计：整个导入只做 JSON.parse + 字段校验 + CSS 变量注入，绝不执行 JS。
 * 校验「先全量通过再 commit」：任何失败不落地、不改当前外观。
 * 存储键见 INTERFACE §1.2；轨道互斥写键 dsh-appearance-track-v1 见 INTERFACE §3.6。
 *
 * 本文件自包含（不在文件内 import 其它 src 模块，以免破坏 build 内联），
 * 轨道键读写以本地小助手实现，与 skin-gallery 侧同键（dsh-appearance-track-v1）同语义。
 *
 * 构造参数：
 *   storage        — 必填，{ getItem, setItem, removeItem }（浏览器传 localStorage，测试传内存替身）
 *   builtinThemes  — 必填，内置主题数组，每项至少含 { id, label }（浏览器传 THEME_FAMILIES）
 *   applyTokens    — 可选，function(tokens) 在试穿/应用时被调用，浏览器接线到 themeService.overrideTokens；
 *                    纯逻辑测试省略。
 */

const STORAGE_CUSTOM = 'theme-gallery-custom-v1'
const STORAGE_CUSTOM_APPLIED = 'theme-gallery-custom-applied-v1'
const STORAGE_FAMILY = 'theme-gallery-family-v5'
// 私有标记：用户是否已主动选择过外观（含切到内置兜底）。区分
// 「未触碰的原生 jade 默认 → getCustomAppliedId 返回 null」与
// 「删除 applied 自定义项后显式回 jade → 返回 'jade'」两种同底层状态。
const STORAGE_TOUCHED = 'theme-gallery-custom-touched-v1'
const TRACK_KEY = 'dsh-appearance-track-v1'
const DEFAULT_THEME_ID = 'jade'

/** 错误契约：统一 { code, message }，导入/操作失败不改当前外观。 */
const ERR = {
  INVALID_JSON: 'ERR_IMPORT_INVALID_JSON',
  MISSING_FIELD: 'ERR_THEME_MISSING_FIELD',
  BAD_TOKEN: 'ERR_THEME_BAD_TOKEN',
  ID_CONFLICT: 'ERR_THEME_ID_CONFLICT',
  UNKNOWN_ID: 'ERR_UNKNOWN_ID',
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function readTrack(storage) {
  try {
    const raw = storage.getItem(TRACK_KEY)
    return raw === 'theme' || raw === 'skin' ? raw : ''
  } catch { return '' }
}

function writeTrack(storage, value) {
  try {
    if (value === 'theme' || value === 'skin') storage.setItem(TRACK_KEY, value)
    else storage.removeItem(TRACK_KEY)
  } catch { /* 存储不可用则忽略 */ }
}

function readCustomItems(storage) {
  try {
    const raw = storage.getItem(STORAGE_CUSTOM)
    const data = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items
  } catch { /* 损坏则按空 registry 处理 */ }
  return []
}

function writeCustomItems(storage, items) {
  try { storage.setItem(STORAGE_CUSTOM, JSON.stringify({ version: 1, items })) } catch {}
}

function readScoped(storage, key, fallback = '') {
  try { return storage.getItem(key) || fallback } catch { return fallback }
}

function writeScoped(storage, key, value) {
  try { storage.setItem(key, value) } catch {}
}

function removeScoped(storage, key) {
  try { storage.removeItem(key) } catch {}
}

/** 校验单个 token：键必须以 `--dsw-` 开头，值是 { light, dark } 非空字符串。 */
function isValidToken(key, value) {
  if (typeof key !== 'string' || !key.startsWith('--dsw-')) return false
  if (!value || typeof value !== 'object') return false
  return typeof value.light === 'string' && value.light.length > 0 &&
    typeof value.dark === 'string' && value.dark.length > 0
}

function sanitizeValue(str) {
  const s = String(str)
  // CSS 变量值为字符串字面量；防「拼错成 rule」：拒绝含右花括号或形如 `;xxx` 的内容。
  if (s.includes('}') || (s.includes(';') && s.indexOf(';') < s.length - 1)) {
    throw fail(ERR.BAD_TOKEN, 'token 值含危险字符')
  }
  return s
}

/** 全量校验主题 JSON 形状；通过则返回归一化条目，否则抛带 code 的错。 */
function validateTheme(jsonText, builtinIds) {
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw fail(ERR.INVALID_JSON, 'JSON 解析失败')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail(ERR.INVALID_JSON, '主题必须是 JSON 对象')
  }
  const { id, label, tokens } = parsed
  if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0 ||
    !tokens || typeof tokens !== 'object' || Array.isArray(tokens) || Object.keys(tokens).length === 0) {
    throw fail(ERR.MISSING_FIELD, '主题必须含非空 id / label / tokens')
  }
  if (!ID_RE.test(id)) throw fail(ERR.MISSING_FIELD, `非法 id: ${id}`)
  if (label.length > 80) throw fail(ERR.MISSING_FIELD, 'label 不能超过 80 字符')
  if (builtinIds.includes(id)) {
    throw fail(ERR.ID_CONFLICT, `id 与内置主题冲突: ${id}`)
  }
  const cleanTokens = {}
  for (const [key, value] of Object.entries(tokens)) {
    if (!isValidToken(key, value)) throw fail(ERR.BAD_TOKEN, `非法 token: ${key}`)
    cleanTokens[key] = { light: sanitizeValue(value.light), dark: sanitizeValue(value.dark) }
  }
  return { id, label, tokens: cleanTokens }
}

/** 创建自定义主题公开 API。返回扁平函数集（UI 即测试面，见 INTERFACE §4.1）。 */
function createCustomThemeApi({ storage, builtinThemes, applyTokens }) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('custom-theme: storage required')
  const builtinIds = (builtinThemes || []).map((t) => t.id)

  function resolveBuiltin(id) {
    return (builtinThemes || []).find((t) => t.id === id) || null
  }

  /** 应用某外观（内置或自定义）的 token override；浏览器接线真实 themeService。 */
  function paint(tokens) {
    if (typeof applyTokens === 'function') applyTokens(tokens)
  }

  function getThemes() {
    return (builtinThemes || []).map((t) => ({ id: t.id, label: t.label }))
  }

  function getCustomThemes() {
    return readCustomItems(storage).map((item) => ({ id: item.id, label: item.label, tokens: item.tokens }))
  }

  function findByCustomId(id) {
    return readCustomItems(storage).find((item) => item.id === id) || null
  }

  /** 当前生效外观 id：自定义 applied 优先；未触碰的原生默认返回 null，已触碰则回内置 family。 */
  function getCustomAppliedId() {
    const applied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (applied && findByCustomId(applied)) return applied
    const touched = readScoped(storage, STORAGE_TOUCHED, '') === '1'
    if (!touched) return null
    return readScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID) || DEFAULT_THEME_ID
  }

  async function importCustomTheme(jsonText) {
    const item = validateTheme(jsonText, builtinIds) // 先全量校验，失败即抛
    const items = readCustomItems(storage)
    const idx = items.findIndex((x) => x.id === item.id)
    const next = items.slice()
    if (idx >= 0) next[idx] = item // 重复 id 覆盖（保留原位）
    else next.push(item)
    writeCustomItems(storage, next) // 校验通过才 commit
    return { id: item.id, label: item.label, tokens: item.tokens }
  }

  function previewCustomTheme(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义主题: ${id}`)
    paint(item.tokens) // 不写 applied 键（A3：刷新即丢）
  }

  function applyCustomTheme(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义主题: ${id}`)
    paint(item.tokens)
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, id)
    writeScoped(storage, STORAGE_FAMILY, '')
    writeScoped(storage, STORAGE_TOUCHED, '1')
    writeTrack(storage, 'theme')
  }

  function deleteCustomTheme(id) {
    if (builtinIds.includes(id)) return // 内置不可删（D5）
    const items = readCustomItems(storage)
    if (!items.some((x) => x.id === id)) return
    writeCustomItems(storage, items.filter((x) => x.id !== id))
    const applied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (applied === id) {
      // 删除正被应用的项 → 回内置默认 jade（D1）
      writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
      writeScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID)
      writeScoped(storage, STORAGE_TOUCHED, '1')
      writeTrack(storage, 'theme')
      const jade = resolveBuiltin(DEFAULT_THEME_ID)
      if (jade) paint(jade.tokens)
    }
  }

  function restoreDefaultTheme() {
    writeCustomItems(storage, [])
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID)
    removeScoped(storage, STORAGE_TOUCHED)
    writeTrack(storage, 'theme')
    const jade = resolveBuiltin(DEFAULT_THEME_ID)
    if (jade) paint(jade.tokens)
  }

  function activateFamily(id) {
    const family = resolveBuiltin(id)
    if (!family) return
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeScoped(storage, STORAGE_FAMILY, id)
    writeScoped(storage, STORAGE_TOUCHED, '1')
    writeTrack(storage, 'theme')
    paint(family.tokens)
  }

  function getAppearanceTrack() {
    return readTrack(storage)
  }

  function setAppearanceTrack(value) {
    writeTrack(storage, value)
  }

  return {
    importCustomTheme,
    previewCustomTheme,
    applyCustomTheme,
    deleteCustomTheme,
    restoreDefaultTheme,
    getCustomThemes,
    getCustomAppliedId,
    getThemes,
    activateFamily,
    getAppearanceTrack,
    setAppearanceTrack,
  }
}

// ---- plugin client ----
// theme-gallery client — 内置主题家族 + 自定义主题（CSS-only JSON 导入 / 试穿 / 应用 / 删除 / 恢复）
//
// 内置 15 主题家族显示在此；自定义主题走 createCustomThemeApi（见 custom-theme.js，CSS-only，
// 只注入 CSS 变量，不执行 JS）。明暗模式由 DSH 的"外观"设置统一控制；
// theme 轨道与 skin 轨道经 dsh-appearance-track-v1 软互斥。

const STORAGE_FAMILY_KEY = 'theme-gallery-family-v5'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

function initialFamily() {
  const stored = readStored(STORAGE_FAMILY_KEY, 'jade')
  return THEME_FAMILIES.some((item) => item.id === stored) ? stored : 'jade'
}

const CSS = `
  .theme-gallery-root { display: grid; gap: 11px; padding: 4px 0; }
  .theme-gallery-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .theme-gallery-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .theme-gallery-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .theme-gallery-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .theme-gallery-search { box-sizing: border-box; width: 100%; height: 34px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
  .theme-gallery-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
  .theme-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 2px; }
  .theme-gallery-card { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; text-align: left; }
  .theme-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
  .theme-gallery-card.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-swatches { display: grid; grid-template-columns: 1fr 1fr; width: 30px; height: 22px; overflow: hidden; border-radius: 6px; border: 1px solid rgba(127,127,127,.3); }
  .theme-gallery-swatch { position: relative; min-width: 0; }
  .theme-gallery-swatch span { position: absolute; right: 2px; bottom: 3px; width: 7px; height: 7px; border-radius: 50%; }
  .theme-gallery-copy { min-width: 0; display: grid; gap: 2px; }
  .theme-gallery-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .theme-gallery-meta { color: var(--dsw-alias-label-secondary); font-size: 10px; }
  .theme-gallery-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .theme-gallery-action { min-height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .theme-gallery-action:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
  .theme-gallery-action-primary { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .theme-gallery-custom { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .theme-gallery-custom-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .theme-gallery-custom-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .theme-gallery-import { width: 100%; box-sizing: border-box; min-height: 96px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); }
  .theme-gallery-custom-item { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; }
  .theme-gallery-custom-item.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-custom-ops { margin-left: auto; display: flex; gap: 6px; }
  .theme-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  .theme-gallery-err { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
  @media (max-width: 900px) { .theme-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .theme-gallery-grid { grid-template-columns: 1fr; } }
`

function apply(ctx) {
  const themeService = ctx.get('theme')
  const slots = ctx.get('slots')
  if (themeService === undefined || slots === undefined) return

  let removeOverride = null
  // 自定义主题 API：storage 接 localStorage，applyTokens 接真实 overrideTokens（CSS-only）。
  const customApi = createCustomThemeApi({
    storage: localStorage,
    builtinThemes: THEME_FAMILIES,
    applyTokens: (tokens) => {
      if (removeOverride) removeOverride()
      removeOverride = themeService.overrideTokens('dsh-theme-gallery', tokens)
    },
  })

  let selected = initialFamily()
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener(selected) }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  const paintBuiltin = (familyId) => {
    const family = THEME_FAMILIES.find((item) => item.id === familyId) || THEME_FAMILIES[0]
    selected = family.id
    if (removeOverride) removeOverride()
    removeOverride = themeService.overrideTokens('dsh-theme-gallery', family.tokens)
  }

  const activate = (familyId) => {
    paintBuiltin(familyId)
    writeStored(STORAGE_FAMILY_KEY, selected)
    customApi.activateFamily(familyId)
    notify()
  }

  ctx.effect(() => () => { if (removeOverride) removeOverride() })

  // 页面加载恢复：已应用自定义主题优先，否则内置。
  const appliedId = customApi.getCustomAppliedId()
  const hasCustomApplied = customApi.getCustomThemes().some((t) => t.id === appliedId)
  if (hasCustomApplied) {
    if (removeOverride) removeOverride()
    customApi.applyCustomTheme(appliedId)
  } else {
    activate(initialFamily())
  }

  function ThemeGallery() {
    const [query, setQuery] = React.useState('')
    const [json, setJson] = React.useState('')
    const [err, setErr] = React.useState('')
    const [, force] = React.useState(0)
    React.useEffect(() => subscribe((id) => { selected = id; force((v) => v + 1) }), [])

    const normalized = query.trim().toLowerCase()
    const visible = THEME_FAMILIES.filter((item) => !normalized || (item.label + ' ' + item.id).toLowerCase().includes(normalized))
    const effectiveActive = () => customApi.getCustomAppliedId()

    const doImport = async () => {
      setErr('')
      try {
        await customApi.importCustomTheme(json)
        setJson('')
        force((v) => v + 1)
      } catch (e) {
        setErr(e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '导入失败'))
      }
    }
    const doPreview = (id) => { try { customApi.previewCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doApply = (id) => { try { customApi.applyCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doDelete = (id) => { try { customApi.deleteCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doRestore = () => { customApi.restoreDefaultTheme(); activate('jade') }

    const customs = customApi.getCustomThemes()
    const activeId = effectiveActive()

    return React.createElement('div', { className: 'theme-gallery-root' },
      React.createElement('div', { className: 'theme-gallery-heading' },
        React.createElement('div', { className: 'theme-gallery-title' }, '精选主题'),
        React.createElement('div', { className: 'theme-gallery-count' }, visible.length + ' / ' + THEME_FAMILIES.length)
      ),
      React.createElement('div', { className: 'theme-gallery-hint' }, '明暗模式由 DSH 的“外观”设置统一控制；选择“跟随系统”时主题会自动切换。'),
      React.createElement('input', {
        className: 'theme-gallery-search', type: 'search', value: query,
        placeholder: '搜索主题…', 'aria-label': '搜索主题',
        onChange: (event) => setQuery(event.target.value),
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'theme-gallery-empty' }, '没有匹配的主题')
        : React.createElement('div', { className: 'theme-gallery-grid' }, ...visible.map((item) => React.createElement('button', {
            key: item.id, type: 'button',
            className: 'theme-gallery-card' + (item.id === activeId ? ' is-active' : ''),
            'aria-pressed': item.id === activeId,
            onClick: () => activate(item.id),
          },
            React.createElement('span', { className: 'theme-gallery-swatches' },
              React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.light.background } },
                React.createElement('span', { style: { background: item.preview.light.accent } })
              ),
              React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.dark.background } },
                React.createElement('span', { style: { background: item.preview.dark.accent } })
              )
            ),
            React.createElement('span', { className: 'theme-gallery-copy' },
              React.createElement('span', { className: 'theme-gallery-name' }, item.label),
              React.createElement('span', { className: 'theme-gallery-meta' }, '跟随 DSH 外观')
            )
          ))),
      React.createElement('div', { className: 'theme-gallery-custom' },
        React.createElement('div', { className: 'theme-gallery-custom-title' }, '自定义主题'),
        React.createElement('div', { className: 'theme-gallery-custom-text' }, '粘贴 JSON（含 id / label / tokens，token 名以 --dsw- 开头且含 light+dark）。仅注入 CSS 变量，不执行任何 JS。'),
        React.createElement('textarea', {
          className: 'theme-gallery-import', value: json, 'aria-label': '自定义主题 JSON',
          placeholder: '{ "id": "my-jade-tweak", "label": "我的主题", "tokens": { "--dsw-alias-bg-base": { "light": "#fff", "dark": "#111" } } }',
          onChange: (event) => setJson(event.target.value),
        }),
        err && React.createElement('div', { className: 'theme-gallery-err' }, err),
        React.createElement('div', { className: 'theme-gallery-actions' },
          React.createElement('button', { type: 'button', className: 'theme-gallery-action theme-gallery-action-primary', onClick: doImport, disabled: !json.trim() }, '导入'),
          React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: doRestore }, '恢复默认主题')
        ),
        customs.length === 0
          ? null
          : React.createElement('div', { className: 'theme-gallery-grid' }, ...customs.map((item) =>
              React.createElement('div', {
                key: item.id, className: 'theme-gallery-custom-item' + (item.id === activeId ? ' is-active' : ''),
              },
                React.createElement('span', { className: 'theme-gallery-copy' },
                  React.createElement('span', { className: 'theme-gallery-name' }, item.label),
                  React.createElement('span', { className: 'theme-gallery-meta' }, item.id)
                ),
                React.createElement('span', { className: 'theme-gallery-custom-ops' },
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doPreview(item.id) }, '试穿'),
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doApply(item.id) }, '应用'),
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doDelete(item.id) }, '删除')
                )
              )
            ))
      )
    )
  }

  ctx.effect(() => {
    const element = document.createElement('style')
    element.setAttribute('data-theme-gallery', '')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => element.remove()
  })

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'theme-gallery', order: 11 },
    ThemeGallery,
  ))
}

  module.exports = { apply };
  return module.exports;
} });
