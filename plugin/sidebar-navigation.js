window.createSidebarNavigation = (home, editor) => (opened) => {
  home.hidden = opened;
  editor.hidden = !opened;
  home.inert = opened;
  editor.inert = !opened;
};
