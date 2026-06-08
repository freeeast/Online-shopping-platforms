(function () {
  var toggleButton = document.getElementById("sidebarToggle");
  var wrapper = document.getElementById("wrapper");
  if (!toggleButton || !wrapper) return;
  toggleButton.onclick = function () {
    wrapper.classList.toggle("toggled");
  };
})();
