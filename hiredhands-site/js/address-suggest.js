/* Hired Hands Moving Company: address suggestions on the free quote form.
   As someone types a street address, up to five real addresses appear underneath (Google, through
   SAI Console's /api/public/address, so no key is in this page). Clicking one, or picking it with
   the arrow keys and Enter, fills in the street, town and state, and the zip code box below it.
   Typing the address by hand always works: if the lookup fails, nothing appears. */
(function () {
  "use strict";

  var form = document.getElementById("quote-form");
  if (!form) return;
  var leadEndpoint = form.getAttribute("data-endpoint") || "";
  if (!/\/api\/public\/website-lead$/.test(leadEndpoint)) return;
  var ENDPOINT = leadEndpoint.replace(/website-lead$/, "address");
  var MIN_QUERY = 4;
  var DEBOUNCE_MS = 250;

  function newSession() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return String(Date.now()) + Math.random().toString(36).slice(2);
  }

  function getJSON(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function attach(input, zip) {
    var wrap = input.parentNode;
    wrap.classList.add("address-field");
    var list = document.createElement("ul");
    list.id = input.id + "-suggestions";
    list.className = "address-suggestions";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Suggested addresses");
    list.hidden = true;
    input.insertAdjacentElement("afterend", list);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("autocomplete", "off");

    var items = [];
    var active = -1;
    var timer = null;
    var ticket = 0;
    var session = "";

    function render() {
      list.innerHTML = "";
      items.forEach(function (item, i) {
        var li = document.createElement("li");
        li.id = list.id + "-" + i;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === active ? "true" : "false");
        li.textContent = item.text;
        li.addEventListener("mousedown", function (e) { e.preventDefault(); });
        li.addEventListener("click", function () { pick(item); });
        list.appendChild(li);
      });
      if (items.length) {
        var credit = document.createElement("li");
        credit.className = "address-suggestions-credit";
        credit.setAttribute("aria-hidden", "true");
        credit.textContent = "Suggestions by Google";
        list.appendChild(credit);
      }
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", items.length ? "true" : "false");
      if (active >= 0) input.setAttribute("aria-activedescendant", list.id + "-" + active);
      else input.removeAttribute("aria-activedescendant");
    }

    function close() {
      items = [];
      active = -1;
      render();
    }

    function lookUp(query) {
      var mine = ++ticket;
      session = session || newSession();
      getJSON(ENDPOINT + "?q=" + encodeURIComponent(query) + "&s=" + session).then(function (body) {
        if (mine !== ticket) return; // a newer keystroke already asked
        items = (body && body.suggestions) || [];
        active = -1;
        render();
      });
    }

    function pick(item) {
      ticket++;
      close();
      input.value = item.text;
      var url = ENDPOINT + "?id=" + encodeURIComponent(item.id) + "&s=" + session;
      session = ""; // the next address is a new session
      getJSON(url).then(function (body) {
        var a = body && body.address;
        if (a && a.line1) {
          input.value = a.line1 + ", " + a.city + ", " + a.state;
          if (zip && a.zip) {
            zip.value = a.zip;
            zip.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
    }

    input.addEventListener("input", function (e) {
      if (!e.isTrusted) return; // our own "input" after a pick
      clearTimeout(timer);
      var value = input.value.trim();
      if (value.length < MIN_QUERY) {
        ticket++;
        close();
        return;
      }
      timer = setTimeout(function () { lookUp(value); }, DEBOUNCE_MS);
    });

    input.addEventListener("keydown", function (e) {
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        render();
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault(); // pick, don't send the form
        pick(items[active]);
      } else if (e.key === "Escape") {
        close();
      }
    });

    input.addEventListener("blur", function () { setTimeout(close, 150); });
  }

  [["origin-address", "origin-zip"], ["destination-address", "destination-zip"]].forEach(function (pair) {
    var input = document.getElementById(pair[0]);
    if (input) attach(input, document.getElementById(pair[1]));
  });
})();
