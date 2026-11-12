/* Hired Hands Moving Company: free quote form validation.
   Every field is required. Validates on blur and on submit, writes inline errors
   (aria-invalid + aria-describedby) and an error summary that takes focus on a failed submit.
   Nothing is sent anywhere: see the TODO on the form's action attribute in free-quote.html. */
(function () {
  "use strict";

  var form = document.getElementById("quote-form");
  if (!form) return;

  var summary = document.getElementById("error-summary");
  var summaryList = document.getElementById("error-summary-list");
  var success = document.getElementById("form-success");
  var moveDate = document.getElementById("move-date");

  /* ----- Move date can't be in the past ----- */
  function todayISO() {
    var d = new Date();
    var month = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + month + "-" + day;
  }

  if (moveDate) moveDate.min = todayISO();

  /* ----- Rules: one entry per control, in form order ----- */
  var ZIP = /^\d{5}(-\d{4})?$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var rules = {
    "email": {
      empty: "Enter your email address",
      check: function (v) {
        return EMAIL.test(v) ? "" : "Enter an email address in the correct format, like name@example.com";
      }
    },
    "first-name": { empty: "Enter your first name" },
    "last-name": { empty: "Enter your last name" },
    "country-code": { empty: "Select your country code" },
    "phone": {
      empty: "Enter your mobile number",
      check: function (v) {
        var digits = v.replace(/\D/g, "");
        var code = document.getElementById("country-code").value;
        if (code === "US" || code === "CA") {
          if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
          return digits.length === 10 ? "" : "Enter a 10-digit mobile number, like 607 555 0123";
        }
        return digits.length >= 6 && digits.length <= 15 ? "" : "Enter a mobile number between 6 and 15 digits";
      }
    },
    "move-date": {
      empty: "Enter your move date",
      check: function (v, el) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || el.validity.badInput) return "Enter a real move date";
        return v < el.min ? "Move date must be today or in the future" : "";
      }
    },
    "origin-address": { empty: "Enter the address you are moving from" },
    "origin-zip": {
      empty: "Enter the zip code you are moving from",
      check: function (v) {
        return ZIP.test(v) ? "" : "Enter a 5-digit zip code, like 14850";
      }
    },
    "destination-address": { empty: "Enter the address you are moving to" },
    "destination-zip": {
      empty: "Enter the zip code you are moving to",
      check: function (v) {
        return ZIP.test(v) ? "" : "Enter a 5-digit zip code, like 14850";
      }
    },
    "referral-source": { empty: "Tell us how you heard about us" },
    "customer-note": { empty: "Enter a note about your move or your question" }
  };

  var ids = Object.keys(rules);

  function errorFor(el) {
    var rule = rules[el.id];
    var value = el.value.trim();
    // A date input reports "" for partial entries, so check badInput before treating it as empty.
    if (!value && !(el.validity && el.validity.badInput)) return rule.empty;
    return rule.check ? rule.check(value, el) : "";
  }

  function showError(el, message) {
    var slot = document.getElementById(el.id + "-error");
    if (message) {
      el.setAttribute("aria-invalid", "true");
      slot.innerHTML = '<span class="visually-hidden">Error: </span>';
      slot.appendChild(document.createTextNode(message));
    } else {
      el.removeAttribute("aria-invalid");
      slot.textContent = "";
    }
  }

  function validate(el) {
    var message = errorFor(el);
    showError(el, message);
    return message;
  }

  /* ----- Blur: validate once the person leaves a field ----- */
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener("blur", function () {
      validate(el);
    });
    // Once a field is flagged, clear the error as soon as it's fixed.
    el.addEventListener("input", function () {
      if (el.getAttribute("aria-invalid") === "true") validate(el);
    });
    el.addEventListener("change", function () {
      if (el.getAttribute("aria-invalid") === "true") validate(el);
    });
  });

  // Changing the country code changes the phone rule.
  document.getElementById("country-code").addEventListener("change", function () {
    var phone = document.getElementById("phone");
    if (phone.value.trim()) validate(phone);
  });

  /* ----- Submit ----- */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    success.hidden = true;

    var errors = [];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      var message = validate(el);
      if (message) errors.push({ id: id, message: message });
    });

    summaryList.textContent = "";

    if (errors.length) {
      errors.forEach(function (error) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = "#" + error.id;
        a.textContent = error.message;
        a.addEventListener("click", function (e) {
          e.preventDefault();
          var field = document.getElementById(error.id);
          var label = form.querySelector('label[for="' + error.id + '"]');
          (label || field).scrollIntoView({ block: "center" });
          field.focus({ preventScroll: true });
        });
        li.appendChild(a);
        summaryList.appendChild(li);
      });
      summary.hidden = false;
      summary.focus();
      return;
    }

    // TODO: Send the request to the real destination here once one is chosen. Nothing is sent while action="#".
    summary.hidden = true;
    form.reset();
    if (moveDate) moveDate.min = todayISO();
    form.hidden = true;
    success.hidden = false;
    success.focus();
  });
})();
