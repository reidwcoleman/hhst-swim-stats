/* =============================================================
   HHST Swim Stats — Shared mobile hamburger nav
   -------------------------------------------------------------
   Injects a <button class="nav-burger"> into every
   `header nav` that contains a `.nav-links` element and toggles
   the class `nav-open` on that <nav> to open / close a stacked
   dropdown of the existing nav links.

   Contract (shared across all public pages):
     • idempotent — never injects two burgers
     • toggles `nav-open` on the parent <nav>
     • keeps aria-expanded in sync, wires aria-controls
     • closes on link tap, on Escape, and on outside click
     • plain vanilla JS, no dependencies, defensive

   The matching CSS lives in assets/styles.css under the
   "MOBILE NAV (hamburger)" block: the burger is hidden on
   desktop and shown at max-width:760px, where `.nav-links`
   becomes an absolutely-positioned dropdown panel.
   ============================================================= */
(function () {
  'use strict';

  var BURGER_CLASS = 'nav-burger';
  var OPEN_CLASS = 'nav-open';
  var idCounter = 0;

  function uniqueId() {
    idCounter += 1;
    var id = 'nav-links-' + idCounter;
    // Guard against a collision with anything already on the page.
    while (document.getElementById(id)) {
      idCounter += 1;
      id = 'nav-links-' + idCounter;
    }
    return id;
  }

  function buildBurger(navLinksId) {
    var btn = document.createElement('button');
    btn.className = BURGER_CLASS;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    if (navLinksId) {
      btn.setAttribute('aria-controls', navLinksId);
    }
    // Three bars — styled by .nav-burger span in styles.css.
    for (var i = 0; i < 3; i++) {
      btn.appendChild(document.createElement('span'));
    }
    return btn;
  }

  function setupNav(nav) {
    if (!nav) return;
    // Idempotent: skip if this nav already has a burger.
    if (nav.querySelector('.' + BURGER_CLASS)) return;

    var navLinks = nav.querySelector('.nav-links');
    if (!navLinks) return;

    // Ensure the dropdown panel has an id so aria-controls can point at it.
    if (!navLinks.id) {
      navLinks.id = uniqueId();
    }

    var burger = buildBurger(navLinks.id);

    function isOpen() {
      return nav.classList.contains(OPEN_CLASS);
    }

    function open() {
      nav.classList.add(OPEN_CLASS);
      burger.setAttribute('aria-expanded', 'true');
    }

    function close() {
      if (!isOpen()) return;
      nav.classList.remove(OPEN_CLASS);
      burger.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      if (isOpen()) {
        close();
      } else {
        open();
      }
    }

    burger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    // Close when a link inside the menu is tapped (lets navigation proceed).
    navLinks.addEventListener('click', function (e) {
      var target = e.target;
      if (target && typeof target.closest === 'function' && target.closest('a')) {
        close();
      }
    });

    // Append the burger as the last child of the nav so it sits on the
    // right; the brand stays on the left. CSS handles visibility.
    nav.appendChild(burger);

    // Close on outside click / tap.
    document.addEventListener('click', function (e) {
      if (!isOpen()) return;
      if (!nav.contains(e.target)) {
        close();
      }
    });

    // Close on Escape, and return focus to the burger for keyboard users.
    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        close();
        if (typeof burger.focus === 'function') {
          burger.focus();
        }
      }
    });
  }

  function init() {
    var navs = document.querySelectorAll('header nav');
    if (!navs || !navs.length) return; // no nav on this page — nothing to do
    for (var i = 0; i < navs.length; i++) {
      setupNav(navs[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already parsed (e.g. script loaded late / defer already fired).
    init();
  }
})();
