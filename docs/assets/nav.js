// Shared, optional JS for sdlc-harness documentation pages.
// Three small behaviors, no dependencies, no build step:
//   1. Highlight the current page's link in the top nav.
//   2. If a page has a <div id="toc"></div>, populate it with a linked list of
//      that page's own <h2> headings (adds an id to each heading if missing).
//   3. Persist any <input type="checkbox"> state to localStorage, keyed by page
//      path + checkbox index, so pre-flight/checklist pages remember what's
//      already been done if you leave and come back mid-setup.
// All three are no-ops if their target elements aren't present, so this script
// is safe to include on every page unconditionally.

(function () {
  "use strict";

  function highlightCurrentNavLink() {
    var here = window.location.pathname.replace(/\/index\.html$/, "/");
    var links = document.querySelectorAll("nav.top a[href]");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var linkPath = new URL(link.getAttribute("href"), window.location.href).pathname;
      if (linkPath === here || linkPath === window.location.pathname) {
        link.classList.add("current");
      }
    }
  }

  function buildTableOfContents() {
    var tocContainer = document.getElementById("toc");
    if (!tocContainer) return;

    var headings = document.querySelectorAll("main h2");
    if (headings.length < 2) {
      tocContainer.remove();
      return;
    }

    var list = document.createElement("ul");
    headings.forEach(function (heading, index) {
      if (!heading.id) {
        heading.id = "section-" + (index + 1);
      }
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + heading.id;
      link.textContent = heading.textContent;
      item.appendChild(link);
      list.appendChild(item);
    });

    var details = document.createElement("details");
    details.open = true;
    var summary = document.createElement("summary");
    summary.textContent = "On this page";
    details.appendChild(summary);
    details.appendChild(list);
    tocContainer.appendChild(details);
  }

  function persistChecklistState() {
    var checkboxes = document.querySelectorAll('main input[type="checkbox"]');
    if (checkboxes.length === 0) return;

    var storageKeyPrefix = "sdlc-harness-checklist:" + window.location.pathname + ":";

    checkboxes.forEach(function (checkbox, index) {
      var key = storageKeyPrefix + index;
      var saved = window.localStorage.getItem(key);
      if (saved === "true") {
        checkbox.checked = true;
      }
      checkbox.addEventListener("change", function () {
        window.localStorage.setItem(key, checkbox.checked ? "true" : "false");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    highlightCurrentNavLink();
    buildTableOfContents();
    persistChecklistState();
  });
})();
