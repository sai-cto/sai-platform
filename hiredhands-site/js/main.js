/* Hired Hands Moving Company: site navigation.
   Mobile menu toggle, disclosure dropdowns, and aria-current on the link to this page. */
(function () {
  "use strict";

  var nav = document.getElementById("site-nav");
  var menuToggle = document.querySelector(".menu-toggle");
  var submenuToggles = Array.prototype.slice.call(document.querySelectorAll(".submenu-toggle"));

  if (!nav) return;

  /* ----- Mark the current page ----- */
  var current = window.location.pathname.split("/").pop() || "index.html";
  Array.prototype.forEach.call(document.querySelectorAll(".site-header a[href], .site-footer a[href]"), function (link) {
    if (link.getAttribute("href") === current) {
      link.setAttribute("aria-current", "page");
    }
  });

  /* ----- Dropdowns (disclosure pattern) ----- */
  function submenuFor(toggle) {
    return document.getElementById(toggle.getAttribute("aria-controls"));
  }

  function setSubmenu(toggle, open) {
    toggle.setAttribute("aria-expanded", String(open));
    submenuFor(toggle).hidden = !open;
  }

  function closeAllSubmenus(except) {
    submenuToggles.forEach(function (toggle) {
      if (toggle !== except) setSubmenu(toggle, false);
    });
  }

  submenuToggles.forEach(function (toggle) {
    setSubmenu(toggle, false);

    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      closeAllSubmenus(toggle);
      setSubmenu(toggle, open);
    });

    // Close a dropdown when keyboard focus leaves its menu item.
    toggle.parentElement.addEventListener("focusout", function (event) {
      if (!toggle.parentElement.contains(event.relatedTarget)) {
        setSubmenu(toggle, false);
      }
    });
  });

  /* ----- Mobile menu ----- */
  function setMenu(open) {
    if (!menuToggle) return;
    menuToggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", function () {
      setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
    });
  }

  /* ----- Escape and outside clicks ----- */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;

    var openToggle = submenuToggles.filter(function (t) {
      return t.getAttribute("aria-expanded") === "true";
    })[0];

    if (openToggle) {
      setSubmenu(openToggle, false);
      openToggle.focus();
    } else if (menuToggle && menuToggle.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuToggle.focus();
    }
  });

  document.addEventListener("click", function (event) {
    if (!nav.contains(event.target)) closeAllSubmenus();
  });
})();
