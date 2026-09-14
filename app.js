/* ==========================================================================
   Carol's Library — replica app logic (vanilla JS, no build step)

   Mirrors the original site's behaviour, plus personal-library additions:
    - typewriter hero heading
    - a perspective bookshelf with hover pop-out + tooltip, drag/wheel/key
      scrolling, and a subtle per-book rotateY tied to scroll position
    - a book detail "flip open" modal, now with editable personal notes,
      an editable star rating, and mood-tag / format chips
    - a genre + mood filter and a free-text search bar
    - "Recommend a book" (visitor -> to-read shelf) and "Add a book"
      (owner -> main shelf) flows, both backed by live Open Library search
      so title/author/year/publisher/synopsis are real bibliographic data,
      not hand-typed guesses
    - a procedurally-styled spine (color, texture, wear) generated from a
      hash of the id + the cover's dominant color, so the shelf stays
      visually cohesive no matter how many books get added later
    - a toggleable light/dark theme, persisted and flash-free on load

   All of the "personal library" state (books you add, notes, mood edits,
   theme, visitor recommendations) lives in localStorage since this is a
   static, backend-free replica — see the README for how to wire a real
   backend in if you want it shared across devices/visitors.
   ========================================================================== */

(function () {
  "use strict";

  var GENRE_ORDER_FALLBACK = ["Nonfiction", "Fiction", "Sci-Fi", "Mystery & Thriller", "Fantasy", "Romance"];
  var MOOD_TAGS = [
    "Adventurous", "Cozy", "Dark & Moody", "Heartwarming", "Thought-provoking",
    "Fast-paced", "Slow & Contemplative", "Suspenseful", "Whimsical",
    "Bittersweet", "Uplifting", "Nostalgic",
  ];

  var STORAGE = {
    recommendations: "carollia-library:recommendations",
    addedBooks: "carollia-library:added-books",
    overlays: "carollia-library:overlays",
    theme: "carollia-library:theme",
    owner: "carollia-library:owner",
  };

  var FACE_CLASS = { serif: "font-display", sans: "font-sans", mono: "font-mono" };
  var FINISH_SHEEN = {
    gloss: "linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.06) 16%, rgba(255,255,255,0.34) 38%, rgba(255,255,255,0.10) 52%, rgba(0,0,0,0.14) 78%, rgba(0,0,0,0.36) 100%)",
    cloth: "linear-gradient(90deg, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0.14) 22%, rgba(255,255,255,0.10) 48%, rgba(0,0,0,0.12) 76%, rgba(0,0,0,0.34) 100%)",
    matte: "linear-gradient(90deg, rgba(0,0,0,0.36) 0%, rgba(0,0,0,0.10) 20%, rgba(255,255,255,0.13) 46%, rgba(0,0,0,0.10) 80%, rgba(0,0,0,0.30) 100%)",
  };
  var FINISH_TEXTURE = {
    gloss: "none",
    cloth: "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0.05) 1px 2px), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, rgba(0,0,0,0.04) 1px 2px)",
    matte: "repeating-linear-gradient(0deg, rgba(0,0,0,0.035) 0 2px, rgba(255,255,255,0.02) 2px 3px)",
  };

  var ICON_HEADPHONES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4.5" height="7" rx="1.6"/><rect x="17" y="13" width="4.5" height="7" rx="1.6"/></svg>';
  var ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z"/></svg>';

  // ------------------------------------------------------------------ utils

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function fnvHash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  function hexFromRgb(rgb) {
    return "#" + rgb.map(function (v) { return Math.round(v).toString(16).padStart(2, "0"); }).join("");
  }

  function relLuminance(rgb) {
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  }

  // Reads either a "#rrggbb" or "hsl(h s% l%)" string (the two formats
  // spine/band colors come in, depending on whether they were extracted
  // from a real cover or generated as a fallback) into an [h, s, l] triplet.
  function parseColorToHsl(str) {
    if (!str) return [210, 20, 50];
    var hex = /^#([0-9a-f]{6})$/i.exec(str.trim());
    if (hex) {
      var r = parseInt(hex[1].slice(0, 2), 16) / 255;
      var g = parseInt(hex[1].slice(2, 4), 16) / 255;
      var b = parseInt(hex[1].slice(4, 6), 16) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2, h = 0, s = 0;
      if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return [h, s * 100, l * 100];
    }
    var hsl = /hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(str);
    if (hsl) return [parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3])];
    return [210, 20, 50];
  }

  var GENRE_TYPOGRAPHY = {
    "Nonfiction": { face: "sans", italic: false },
    "Fiction": { face: "serif", italic: false },
    "Sci-Fi": { face: "mono", italic: false },
    "Mystery & Thriller": { face: "sans", italic: false, condensed: true },
    "Fantasy": { face: "serif", italic: true, caps: true },
    "Romance": { face: "serif", italic: true, caps: false },
  };

  // A few render-time-only visual touches layered on top of whatever
  // spine/band colors the book already has (real, extracted ones for
  // imported books; hashed fallbacks for anything else): a genre-driven
  // typeface personality, gold foil reserved for hardcovers, and a faint
  // second hue for a woven-cloth pattern rather than a flat tint. None of
  // this touches the underlying book data — it's derived fresh every
  // render from the id, so it's free to evolve without a data migration.
  function spineExtras(book) {
    var seed = fnvHash((book.id || book.title || "book") + ":extra");
    var typo = GENRE_TYPOGRAPHY[(book.genres && book.genres[0]) || "Fiction"] || { face: "serif" };
    var hsl = parseColorToHsl(book.band || book.spine);
    var shift = 22 + (seed % 26);
    var patternColor = "hsl(" + Math.round((hsl[0] + shift) % 360) + " " +
      Math.round(clamp(hsl[1] + 22, 45, 90)) + "% " + Math.round(clamp(hsl[2] + 22, 45, 88)) + "%)";
    return {
      face: typo.face,
      italic: !!typo.italic,
      condensed: !!typo.condensed,
      caps: typo.caps != null ? typo.caps : book.caps,
      foil: book.binding === "hardcover",
      patternColor: patternColor,
      patternDots: seed % 2 === 0,
    };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function truncate(text, max) {
    if (!text) return "";
    text = text.replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var lastSpace = cut.lastIndexOf(" ");
    return cut.slice(0, lastSpace > 40 ? lastSpace : max).trim() + "…";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // Sample a cover image down to an 80px-wide canvas and pick a spine /
  // band / ink color from it — same approach as the original site, kept
  // so any newly-added book's spine still feels drawn from its own cover.
  function extractCoverPalette(src) {
    return loadImage(src).then(function (img) {
      var w = 80;
      var h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      var sr = 0, sg = 0, sb = 0, n = 0;
      var best = [120, 120, 120], bestSat = -1;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          var r = data[i], g = data[i + 1], b = data[i + 2];
          if (x < 5) { sr += r; sg += g; sb += b; n++; }
          var sat = Math.max(r, g, b) - Math.min(r, g, b);
          var lum = relLuminance([r, g, b]);
          if (sat > bestSat && lum > 0.2 && lum < 0.85) { bestSat = sat; best = [r, g, b]; }
        }
      }
      if (!n) return null;
      var avg = [sr / n, sg / n, sb / n];
      return {
        spine: hexFromRgb(avg),
        band: hexFromRgb(best),
        ink: relLuminance(avg) > 0.55 ? "#241f19" : "#faf7f0",
      };
    }).catch(function () { return null; });
  }

  // Deterministically derive the procedural spine styling for a book that's
  // missing it — same formulas as the original's visitor-recommendation
  // pipeline, so every book (placeholder, added, or recommended) renders
  // with the same consistent, hand-bound-library look.
  function genBookStyle(book) {
    var seed = fnvHash(book.id || book.title || "book");
    function n(bit, scale, offset) {
      offset = offset || 0;
      return (((seed >> bit) % 1000) / 1000) * scale + offset;
    }
    var pages = book.pages || 300;
    var binding = book.binding || (pages > 420 ? "hardcover" : pages < 260 ? "mass" : "paperback");
    var finish = book.finish || (binding === "hardcover" ? "cloth" : n(3, 1) > 0.5 ? "gloss" : "matte");
    var height = book.height || Math.round((binding === "hardcover" ? 236 + n(5, 18) : binding === "mass" ? 196 + n(7, 14) : 214 + n(9, 16)));
    var width = book.width || Math.round(clamp(pages * 0.055 + n(11, 6), 16, 58));
    return {
      binding: binding,
      finish: finish,
      height: height,
      width: width,
      lean: book.lean != null ? book.lean : Number(n(13, 5, -2.5).toFixed(2)),
      depth: book.depth != null ? book.depth : Number(n(17, 14, -7).toFixed(1)),
      wear: book.wear != null ? book.wear : Number(n(19, 0.35).toFixed(2)),
      face: book.face || ["serif", "sans", "mono"][seed % 3],
      caps: book.caps != null ? book.caps : seed % 2 === 0,
      spine: book.spine || "hsl(" + (seed % 360) + " 28% 34%)",
      band: book.band || "hsl(" + ((seed + 60) % 360) + " 40% 62%)",
      ink: book.ink || "#faf7f0",
    };
  }

  function normalizeBook(raw) {
    var needsStyle = raw.spine == null || raw.width == null || raw.height == null;
    var book = needsStyle ? Object.assign({}, raw, genBookStyle(raw)) : Object.assign({}, raw);
    book.genres = book.genres || [];
    book.mood = book.mood || [];
    book.format = book.format || "physical";
    return book;
  }

  function searchOpenLibrary(query, signal) {
    var url = "https://openlibrary.org/search.json?q=" + encodeURIComponent(query) +
      "&limit=12&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,publisher,subject";
    return fetch(url, signal ? { signal: signal } : {}).then(function (res) {
      if (!res.ok) throw new Error("search failed");
      return res.json();
    }).then(function (json) {
      return (json.docs || []).filter(function (d) { return d.title && d.cover_i; }).map(function (d) {
        return {
          key: d.key,
          title: d.title,
          author: (d.author_name && d.author_name[0]) || "Unknown",
          year: d.first_publish_year || 0,
          cover: "https://covers.openlibrary.org/b/id/" + d.cover_i + "-L.jpg",
          pages: d.number_of_pages_median || 300,
          publisher: (d.publisher && d.publisher[0]) || "",
          subjects: (d.subject || []).slice(0, 8),
        };
      });
    });
  }

  // Pull the real work synopsis from Open Library so an added book's blurb
  // is accurate bibliographic text, not a placeholder — used by both the
  // "Add a book" and "Recommend a book" flows.
  function fetchOpenLibraryBlurb(key) {
    if (!key) return Promise.resolve("");
    return fetch("https://openlibrary.org" + key + ".json").then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (!data || !data.description) return "";
      var d = data.description;
      var text = typeof d === "string" ? d : (d.value || "");
      text = text.replace(/<[^>]+>/g, ""); // some OL descriptions carry stray HTML (links, etc.)
      return truncate(text, 280);
    }).catch(function () { return ""; });
  }

  // Best-effort guess at genres from Open Library subject tags, mapped onto
  // this site's existing genre vocabulary (falls back to "Fiction").
  function guessGenres(subjects) {
    var map = {
      "Nonfiction": ["nonfiction", "biography", "essays", "self-help", "business", "science", "history", "psychology"],
      "Sci-Fi": ["science fiction", "space opera", "dystopia", "cyberpunk"],
      "Fantasy": ["fantasy", "magic", "dragons", "epic fantasy"],
      "Mystery & Thriller": ["mystery", "thriller", "crime", "detective", "suspense"],
      "Romance": ["romance", "love stories"],
      "Fiction": ["fiction", "literary fiction", "novel"],
    };
    var lower = (subjects || []).map(function (s) { return s.toLowerCase(); });
    var hits = [];
    Object.keys(map).forEach(function (genre) {
      if (map[genre].some(function (kw) { return lower.some(function (s) { return s.indexOf(kw) !== -1; }); })) {
        hits.push(genre);
      }
    });
    return hits.length ? hits.slice(0, 2) : ["Fiction"];
  }

  // ----------------------------------------------------------------- store

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadRecommendations() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE.recommendations); } catch (e) {}
    if (raw) {
      try { return JSON.parse(raw); } catch (e) {}
    }
    // first visit ever — seed the to-read shelf from the wishlist bundled
    // with the site, if one was provided (see wishlist-data.js)
    var seed = (window.DEFAULT_RECOMMENDATIONS || []).slice();
    saveRecommendations(seed);
    return seed;
  }
  function saveRecommendations(list) { saveJSON(STORAGE.recommendations, list); }
  function loadAddedBooks() { return loadJSON(STORAGE.addedBooks, []); }
  function saveAddedBooks(list) { saveJSON(STORAGE.addedBooks, list); }
  function loadOverlays() { return loadJSON(STORAGE.overlays, {}); }
  function saveOverlays(map) { saveJSON(STORAGE.overlays, map); }

  var overlays = loadOverlays();

  function applyOverlay(book) {
    var o = overlays[book.id];
    if (!o) return book;
    return Object.assign({}, book, {
      notes: o.notes != null ? o.notes : book.notes,
      mood: o.mood != null ? o.mood : book.mood,
      rating: o.rating != null ? o.rating : book.rating,
      reading: o.reading != null ? o.reading : book.reading,
    });
  }

  function setOverlay(bookId, patch) {
    overlays[bookId] = Object.assign({}, overlays[bookId], patch);
    saveOverlays(overlays);
  }

  // ------------------------------------------------------------------ state

  var state = {
    allBooks: [],
    recommendations: loadRecommendations().map(normalizeBook).map(applyOverlay),
    selectedGenre: null,
    selectedMood: null,
    selectedFormat: null,
    searchQuery: "",
    searchIds: null,
    searching: false,
    justAddedMainId: null,
    justAddedToReadId: null,
  };

  function rebuildAllBooks() {
    var base = (window.LIBRARY_BOOKS || []).concat(loadAddedBooks());
    state.allBooks = base.map(normalizeBook).map(applyOverlay);
  }
  rebuildAllBooks();

  var els = {
    themeToggle: document.getElementById("themeToggle"),
    ownerToggle: document.getElementById("ownerToggle"),
    siteNameBtn: document.getElementById("siteNameBtn"),
    heroTitleFallback: document.getElementById("heroTitleFallback"),
    heroTitleSvgWrap: document.getElementById("heroTitleSvgWrap"),
    volumeCount: document.getElementById("volumeCount"),
    recommendBtn: document.getElementById("recommendBtn"),
    addBookBtn: document.getElementById("addBookBtn"),
    searchInput: document.getElementById("searchInput"),
    searchStatus: document.getElementById("searchStatus"),
    filterTrigger: document.getElementById("filterTrigger"),
    filterCount: document.getElementById("filterCount"),
    activeChips: document.getElementById("activeChips"),
    filterPanel: document.getElementById("filterPanel"),
    formatChips: document.getElementById("formatChips"),
    genreChips: document.getElementById("genreChips"),
    moodChips: document.getElementById("moodChips"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),
    filterDoneBtn: document.getElementById("filterDoneBtn"),
    mainShelfMount: document.getElementById("mainShelfMount"),
    visitorSection: document.getElementById("visitorSection"),
    toReadCount: document.getElementById("toReadCount"),
    toReadShelfMount: document.getElementById("toReadShelfMount"),
    readingSection: document.getElementById("readingSection"),
    readingShelfMount: document.getElementById("readingShelfMount"),
    modalMount: document.getElementById("modalMount"),
    dialogMount: document.getElementById("dialogMount"),
    heroReveal: document.getElementById("heroReveal"),
    shelfReveal: document.getElementById("shelfReveal"),
  };

  // -------------------------------------------------------------- dark mode

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORAGE.theme, theme); } catch (e) {}
  }

  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", function () {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  // ------------------------------------------------------------ owner mode
  //
  // This is a client-only site with no server, so this is a UX gate, not
  // real security — anyone with devtools open can bypass it. What it does
  // do: keep casual visitors from seeing "+ Add a book" or the note/rating/
  // mood editors, which is the actual goal ("only I should be able to add
  // books and write my thoughts"). The passphrase is checked as a SHA-256
  // hash so it isn't sitting in the page source in plain text.
  //
  // CHANGE THE DEFAULT PASSPHRASE — it's literally "change-me-please" right
  // now. To set your own: open this site, open the browser console, and run
  //   crypto.subtle.digest("SHA-256", new TextEncoder().encode("your new passphrase"))
  //     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("")))
  // then paste the printed hash in as OWNER_HASH below.

  var OWNER_HASH = "f5dcec9289c446e7099d483f2ed447c990b3868a2fab4ff4a39436c63589c70e";
  var activeModalRefresh = null; // set by openModal while a modal is open

  function isOwner() {
    try { return localStorage.getItem(STORAGE.owner) === "1"; } catch (e) { return false; }
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return window.crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  function setOwner(flag) {
    try {
      if (flag) localStorage.setItem(STORAGE.owner, "1");
      else localStorage.removeItem(STORAGE.owner);
    } catch (e) {}
    updateOwnerUI();
    if (activeModalRefresh) activeModalRefresh();
  }

  function updateOwnerUI() {
    var owner = isOwner();
    if (els.addBookBtn) els.addBookBtn.hidden = !owner;
    if (els.recommendBtn) els.recommendBtn.textContent = owner ? "+ Add to wishlist" : "Recommend a book";
    if (els.ownerToggle) {
      els.ownerToggle.classList.toggle("is-owner", owner);
      els.ownerToggle.setAttribute("aria-label", owner ? "Sign out of owner mode" : "Owner sign-in");
      els.ownerToggle.title = owner ? "Signed in as owner — click to sign out" : "Owner sign-in";
      var label = els.ownerToggle.querySelector(".owner-toggle-label");
      if (label) label.textContent = owner ? "Signed in" : "Owner";
    }
  }

  function openOwnerSignInDialog() {
    var root = document.createElement("div");
    root.className = "dialog-root";
    var backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "dialog-backdrop";
    backdrop.setAttribute("aria-label", "Close");
    var dialog = document.createElement("div");
    dialog.className = "dialog animate-scale-in owner-dialog";
    root.appendChild(backdrop);
    root.appendChild(dialog);
    els.dialogMount.appendChild(root);

    function close() {
      window.removeEventListener("keydown", onKey);
      root.remove();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", close);

    var error = null;
    function render() {
      dialog.innerHTML = "";
      var head = document.createElement("div");
      head.className = "dialog-head";
      var label = document.createElement("p");
      label.className = "dh-label";
      label.textContent = "Owner sign-in";
      head.appendChild(label);
      var input = document.createElement("input");
      input.type = "password";
      input.className = "dialog-search-input";
      input.placeholder = "Passphrase";
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(input.value); });
      head.appendChild(input);
      dialog.appendChild(head);

      var form = document.createElement("div");
      form.className = "dialog-form";
      if (error) {
        var err = document.createElement("p");
        err.className = "dialog-error";
        err.textContent = error;
        form.appendChild(err);
      }
      var footer = document.createElement("div");
      footer.className = "dialog-footer";
      var hint = document.createElement("span");
      hint.className = "back-link";
      hint.textContent = "Everyone else can still recommend & browse";
      var submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "submit-btn";
      submitBtn.textContent = "Sign in";
      submitBtn.addEventListener("click", function () { submit(input.value); });
      footer.appendChild(hint);
      footer.appendChild(submitBtn);
      form.appendChild(footer);
      dialog.appendChild(form);
      window.setTimeout(function () { input.focus(); }, 0);
    }

    function submit(value) {
      sha256Hex(value || "").then(function (hex) {
        if (hex === OWNER_HASH) {
          setOwner(true);
          close();
        } else {
          error = "That's not it.";
          render();
        }
      });
    }

    render();
  }

  if (els.ownerToggle) {
    els.ownerToggle.addEventListener("click", function () {
      if (isOwner()) setOwner(false);
      else openOwnerSignInDialog();
    });
  }
  updateOwnerUI();

  // ------------------------------------------------------------- typewriter

  // A real handwriting-drawn title: opentype.js turns Jane Austen's own
  // typeface (letterforms traced from her actual manuscripts by Pia
  // Frauss — see fonts/JaneAusten-LICENSE.txt, personal use only) into
  // one SVG path per glyph, which we stroke-draw (like watching a quill
  // trace each letter, with a small ink pool where the nib first touches
  // down) and then fill in solid, like ink settling. If the font or
  // opentype.js fails to load for any reason, the plain italic serif
  // title (already in the HTML) just stays visible — the page is never
  // left with a blank heading over a third-party script hiccup.
  var CURSIVE_FONT_URL = "fonts/JaneAusten.ttf";

  function runCursiveTitle() {
    var text = "Welcome to my library";
    var fallback = els.heroTitleFallback;
    var wrap = els.heroTitleSvgWrap;
    if (!window.opentype || !fallback || !wrap) return;

    window.opentype.load(CURSIVE_FONT_URL, function (err, font) {
      if (err || !font) return;
      try {
        var fontSize = 160;
        var fullPath = font.getPath(text, 0, 0, fontSize, { kerning: true });
        var box = fullPath.getBoundingBox();
        var pad = fontSize * 0.12;
        var vbX = box.x1 - pad, vbY = box.y1 - pad;
        var vbW = (box.x2 - box.x1) + pad * 2, vbH = (box.y2 - box.y1) + pad * 2;

        // one path per glyph, in reading order, so each letter can be
        // drawn on its own rather than the whole phrase tracing at once
        var glyphPaths = font.getPaths(text, 0, 0, fontSize, { kerning: true });

        var svgNS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", vbX + " " + vbY + " " + vbW + " " + vbH);

        var letterEls = [];
        var inkDots = [];
        glyphPaths.forEach(function (p) {
          var d = p.toPathData(3);
          if (!d) return;
          var pathEl = document.createElementNS(svgNS, "path");
          pathEl.setAttribute("d", d);
          svg.appendChild(pathEl);
          letterEls.push(pathEl);

          // a faint ink pool at the nib's starting point for each letter
          var start = p.commands && p.commands[0];
          var dot = document.createElementNS(svgNS, "circle");
          dot.setAttribute("cx", start ? start.x : 0);
          dot.setAttribute("cy", start ? start.y : 0);
          dot.setAttribute("r", "2.6");
          dot.setAttribute("class", "hero-ink-dot");
          svg.appendChild(dot);
          inkDots.push(dot);
        });
        wrap.appendChild(svg);
        if (!letterEls.length) throw new Error("no glyphs");

        var lengths = letterEls.map(function (p) {
          var len = p.getTotalLength() || 1;
          p.style.strokeDasharray = String(len);
          p.style.strokeDashoffset = String(len);
          p.style.fillOpacity = "0";
          return len;
        });

        fallback.style.display = "none";

        if (window.gsap) {
          var tl = window.gsap.timeline({
            delay: 0.2,
            onComplete: function () {
              // the stroke was only ever there to animate the draw-on;
              // once ink has "settled" (fill is in), drop it so the
              // resting title carries the font's true, lighter weight
              letterEls.forEach(function (p) { p.style.stroke = "none"; });
            },
          });
          var t = 0;
          letterEls.forEach(function (p, i) {
            // a quill moves fast on short strokes, slower through loops —
            // duration follows each letter's own path length rather than
            // a single fixed speed for the whole phrase
            var dur = Math.max(0.09, Math.min(0.3, lengths[i] / 700));
            tl.fromTo(inkDots[i], { opacity: 0 }, { opacity: 0.5, duration: dur * 0.25, ease: "power1.out" }, t);
            tl.to(inkDots[i], { opacity: 0, duration: dur * 0.4 }, t + dur * 0.3);
            tl.to(p, { strokeDashoffset: 0, duration: dur, ease: "power1.inOut" }, t);
            tl.to(p, { fillOpacity: 1, strokeOpacity: 0, duration: 0.22 }, t + dur * 0.6);
            // slight overlap into the next letter, like a hand that
            // never fully lifts the pen between strokes
            t += dur * 0.55;
          });
        } else {
          letterEls.forEach(function (p) {
            p.style.strokeDashoffset = "0";
            p.style.fillOpacity = "1";
            p.style.stroke = "none";
          });
          inkDots.forEach(function (dot) { dot.style.opacity = "0"; });
        }
      } catch (e) {
        fallback.style.display = "";
        wrap.innerHTML = "";
      }
    });
  }

  // --------------------------------------------------------- filter chrome

  function tagCounts(books, field) {
    var map = new Map();
    books.forEach(function (b) {
      (b[field] || []).forEach(function (g) { map.set(g, (map.get(g) || 0) + 1); });
    });
    return Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return e[0]; });
  }

  function renderGenrePills() {
    var genres = tagCounts(state.allBooks, "genres");
    if (genres.length === 0) genres = GENRE_ORDER_FALLBACK.slice();
    els.genreChips.innerHTML = "";
    els.genreChips.appendChild(makePill("All", state.selectedGenre === null, function () {
      state.selectedGenre = null;
      renderGenrePills();
      renderActiveChips();
      applyFilters();
    }));
    genres.forEach(function (g) {
      els.genreChips.appendChild(makePill(g, state.selectedGenre === g, function () {
        state.selectedGenre = state.selectedGenre === g ? null : g;
        renderGenrePills();
        renderActiveChips();
        applyFilters();
      }));
    });
  }

  function renderMoodPills() {
    var moods = tagCounts(state.allBooks, "mood");
    els.moodChips.innerHTML = "";
    if (moods.length === 0) return;
    els.moodChips.appendChild(makePill("Any", state.selectedMood === null, function () {
      state.selectedMood = null;
      renderMoodPills();
      renderActiveChips();
      applyFilters();
    }, "mood-chip"));
    moods.forEach(function (m) {
      els.moodChips.appendChild(makePill(m, state.selectedMood === m, function () {
        state.selectedMood = state.selectedMood === m ? null : m;
        renderMoodPills();
        renderActiveChips();
        applyFilters();
      }, "mood-chip"));
    });
  }

  function renderFormatPills() {
    els.formatChips.innerHTML = "";
    [
      { value: null, label: "All formats" },
      { value: "audiobook", label: "Audiobooks" },
      { value: "physical", label: "Physical books" },
    ].forEach(function (opt) {
      els.formatChips.appendChild(makePill(opt.label, state.selectedFormat === opt.value, function () {
        state.selectedFormat = state.selectedFormat === opt.value ? null : opt.value;
        renderFormatPills();
        renderActiveChips();
        applyFilters();
      }));
    });
  }

  function makePill(label, active, onClick, extraClass) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill" + (extraClass ? " " + extraClass : "") + (active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  // -------------------------------------------------------- filter panel

  function filterActiveCount() {
    return (state.selectedFormat !== null ? 1 : 0) +
      (state.selectedGenre !== null ? 1 : 0) +
      (state.selectedMood !== null ? 1 : 0);
  }

  function renderActiveChips() {
    var count = filterActiveCount();
    els.filterCount.hidden = count === 0;
    els.filterCount.textContent = String(count);

    els.activeChips.innerHTML = "";
    function addChip(label, onRemove) {
      var chip = document.createElement("span");
      chip.className = "active-chip";
      var text = document.createElement("span");
      text.textContent = label;
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", "Remove filter: " + label);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", onRemove);
      chip.appendChild(text);
      chip.appendChild(removeBtn);
      els.activeChips.appendChild(chip);
    }
    if (state.selectedFormat !== null) {
      addChip(state.selectedFormat === "audiobook" ? "Audiobooks" : "Physical books", function () {
        state.selectedFormat = null;
        renderFormatPills();
        renderActiveChips();
        applyFilters();
      });
    }
    if (state.selectedGenre !== null) {
      addChip(state.selectedGenre, function () {
        state.selectedGenre = null;
        renderGenrePills();
        renderActiveChips();
        applyFilters();
      });
    }
    if (state.selectedMood !== null) {
      addChip(state.selectedMood, function () {
        state.selectedMood = null;
        renderMoodPills();
        renderActiveChips();
        applyFilters();
      });
    }
  }

  var filterCloseTimer = null;

  function openFilterPanel() {
    if (filterCloseTimer) { window.clearTimeout(filterCloseTimer); filterCloseTimer = null; }
    els.filterPanel.classList.remove("is-closing");
    els.filterPanel.hidden = false;
    els.filterTrigger.setAttribute("aria-expanded", "true");
    window.setTimeout(function () { document.addEventListener("pointerdown", onDocClickCloseFilter, true); }, 0);
  }
  function closeFilterPanel() {
    if (els.filterPanel.hidden || filterCloseTimer) return;
    els.filterPanel.classList.add("is-closing");
    els.filterTrigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocClickCloseFilter, true);
    // let the close animation play before actually hiding it, so the
    // panel eases out instead of vanishing instantly
    filterCloseTimer = window.setTimeout(function () {
      els.filterPanel.hidden = true;
      els.filterPanel.classList.remove("is-closing");
      filterCloseTimer = null;
    }, 180);
  }
  function onDocClickCloseFilter(e) {
    // capture-phase pointerdown, not a bubbling click — a chip's own click
    // handler rebuilds its whole group's DOM (innerHTML = ""), which
    // detaches the clicked element before a bubbling listener would see
    // it, making `contains()` wrongly say "outside". Capture-phase
    // pointerdown runs before any of that mutation happens.
    if (!els.filterPanel.contains(e.target) && e.target !== els.filterTrigger && !els.filterTrigger.contains(e.target)) {
      closeFilterPanel();
    }
  }
  function initFilterPanel() {
    els.filterTrigger.addEventListener("click", function () {
      var isOpen = !els.filterPanel.hidden && !els.filterPanel.classList.contains("is-closing");
      if (isOpen) closeFilterPanel(); else openFilterPanel();
    });
    els.filterDoneBtn.addEventListener("click", closeFilterPanel);
    els.clearFiltersBtn.addEventListener("click", function () {
      state.selectedFormat = null;
      state.selectedGenre = null;
      state.selectedMood = null;
      renderFormatPills();
      renderGenrePills();
      renderMoodPills();
      renderActiveChips();
      applyFilters();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !els.filterPanel.hidden) closeFilterPanel();
    });
  }

  // ---------------------------------------------------------------- search

  function scoreMatch(book, q) {
    var title = book.title.toLowerCase();
    var author = book.author.toLowerCase();
    var genres = (book.genres || []).join(" ").toLowerCase();
    var mood = (book.mood || []).join(" ").toLowerCase();
    var score = -1;
    if (title.indexOf(q) === 0) score = 100;
    else if (title.indexOf(q) !== -1) score = 70;
    else if (author.indexOf(q) !== -1) score = 50;
    else if (mood.indexOf(q) !== -1) score = 35;
    else if (genres.indexOf(q) !== -1) score = 30;
    return score;
  }

  var searchDebounce = null;
  els.searchInput.addEventListener("input", function (e) {
    var q = e.target.value;
    state.searchQuery = q;
    window.clearTimeout(searchDebounce);
    if (q.trim().length < 2) {
      state.searchIds = null;
      state.searching = false;
      updateSearchStatus();
      applyFilters();
      return;
    }
    state.searching = true;
    updateSearchStatus();
    searchDebounce = window.setTimeout(function () {
      var query = q.trim().toLowerCase();
      var scored = state.allBooks
        .map(function (b) { return { id: b.id, score: scoreMatch(b, query) }; })
        .filter(function (r) { return r.score > 0; })
        .sort(function (a, b) { return b.score - a.score; });
      state.searchIds = scored.map(function (r) { return r.id; });
      state.searching = false;
      updateSearchStatus();
      applyFilters();
    }, 350);
  });

  function updateSearchStatus() {
    var q = state.searchQuery.trim();
    if (q.length < 2) { els.searchStatus.hidden = true; return; }
    els.searchStatus.hidden = false;
    if (state.searching) {
      els.searchStatus.textContent = "Reading the shelves…";
    } else {
      var n = state.searchIds ? state.searchIds.length : 0;
      els.searchStatus.textContent = n + " found";
    }
  }

  function applyFilters(justAddedId) {
    // books marked "currently reading" live on their own shelf, not here —
    // this is "everything I've finished", so an in-progress book shouldn't
    // count toward the volume total either
    var list = state.allBooks.filter(function (b) { return !b.reading; });
    var active = state.selectedGenre !== null || state.selectedMood !== null ||
      state.selectedFormat !== null || state.searchIds !== null;
    if (state.selectedGenre !== null) {
      list = list.filter(function (b) { return (b.genres || []).indexOf(state.selectedGenre) !== -1; });
    }
    if (state.selectedMood !== null) {
      list = list.filter(function (b) { return (b.mood || []).indexOf(state.selectedMood) !== -1; });
    }
    if (state.selectedFormat !== null) {
      list = list.filter(function (b) { return b.format === state.selectedFormat; });
    }
    if (state.searchIds !== null) {
      var order = new Map(state.searchIds.map(function (id, i) { return [id, i]; }));
      list = list.filter(function (b) { return order.has(b.id); })
        .sort(function (a, b) { return order.get(a.id) - order.get(b.id); });
    }
    els.volumeCount.textContent = list.length + " " + (active ? "matching " : "") + "volumes";
    var resolvedJustAdded = justAddedId || state.justAddedMainId;
    mainShelf.setBooks(list, resolvedJustAdded, { animate: !resolvedJustAdded });
  }

  // ----------------------------------------------------------------- shelf

  function createShelfController(mount, kind) {
    var wrap = document.createElement("div");
    wrap.className = "shelf-wrap";
    var fadeL = document.createElement("div");
    fadeL.className = "shelf-fade left";
    var fadeR = document.createElement("div");
    fadeR.className = "shelf-fade right";
    var shelf = document.createElement("div");
    shelf.className = "shelf";
    wrap.appendChild(fadeL);
    wrap.appendChild(fadeR);
    wrap.appendChild(shelf);
    var edgeLine = document.createElement("div");
    edgeLine.className = "shelf-edge-line";
    var edgeShadow = document.createElement("div");
    edgeShadow.className = "shelf-edge-shadow";

    mount.innerHTML = "";
    mount.appendChild(wrap);
    mount.appendChild(edgeLine);
    mount.appendChild(edgeShadow);

    var books = [];
    var repeated = [];
    var repeatCount = 1;
    var rafId = null;
    var dragState = null;
    var velocityTracker = null;
    var momentumRaf = null;
    var justAddedId = null;

    function stopMomentum() {
      if (momentumRaf) { window.cancelAnimationFrame(momentumRaf); momentumRaf = null; }
    }

    function startMomentum(v0) {
      stopMomentum();
      if (Math.abs(v0) < 0.03) return;
      var v = v0; // px per ms
      var last = performance.now();
      function step(now) {
        var dt = Math.min(now - last, 48);
        last = now;
        shelf.scrollLeft += v * dt;
        v *= Math.pow(0.94, dt);
        if (Math.abs(v) < 0.02) { momentumRaf = null; return; }
        momentumRaf = window.requestAnimationFrame(step);
      }
      momentumRaf = window.requestAnimationFrame(step);
    }

    // cached per-slot geometry (offsetLeft/offsetWidth + its --ry custom
    // property target), rebuilt once per layout() — updateTilts() then runs
    // on pure arithmetic against this cache instead of calling
    // getBoundingClientRect() on every spine on every scroll frame, which
    // is what was actually causing the scroll lag on a 225+ book shelf
    // (up to ~675 forced-layout reads per frame, tripled for the infinite
    // loop — that's the whole story, nothing else needed changing)
    var slotGeometry = [];

    function layout() {
      shelf.innerHTML = "";
      var total = books.reduce(function (s, b) { return s + b.width + 2; }, 0);
      repeatCount = total > 2600 ? 3 : 1;
      repeated = [];
      for (var r = 0; r < repeatCount; r++) repeated = repeated.concat(books);

      var frag = document.createDocumentFragment();
      var faceEls = [];
      repeated.forEach(function (book, idx) {
        var slot = document.createElement("span");
        slot.className = "book-slot";
        slot.style.width = book.width + "px";
        slot.style.setProperty("--spine-w", book.width + "px");
        if (justAddedId && book.id === justAddedId && idx >= (repeatCount > 1 ? books.length : 0)) {
          slot.classList.add("animate-shelve-in");
        }
        var el = buildBookSpineEl(book, {
          onSelect: function () { openModal(repeated, idx, el, controller, kind); },
        });
        slot.appendChild(el);
        frag.appendChild(slot);
        faceEls.push(slot.querySelector(".book-face"));
      });
      shelf.appendChild(frag);

      window.requestAnimationFrame(function () {
        var overflow = shelf.scrollWidth > shelf.clientWidth + 4;
        fadeL.style.display = overflow ? "" : "none";
        fadeR.style.display = overflow ? "" : "none";
        shelf.classList.toggle("justify-center", !overflow);
        if (repeatCount > 1) {
          shelf.scrollLeft = shelf.scrollWidth / repeatCount;
        } else {
          shelf.scrollLeft = 0;
        }
        // one batch of layout reads, cached for every subsequent scroll frame
        slotGeometry = [];
        for (var i = 0; i < shelf.children.length; i++) {
          var slotEl = shelf.children[i];
          slotGeometry.push({ left: slotEl.offsetLeft, width: slotEl.offsetWidth, face: faceEls[i] });
        }
        updateTilts();
        if (justAddedId) {
          var targetIdx = repeated.findIndex(function (b, i) { return b.id === justAddedId && i >= (repeatCount > 1 ? books.length : 0); });
          var targetEl = shelf.children[targetIdx];
          if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      });
    }

    function updateTilts() {
      var scrollLeft = shelf.scrollLeft;
      var viewport = shelf.clientWidth;
      var centerX = scrollLeft + viewport / 2;
      var half = viewport / 2 || 1;
      for (var i = 0; i < slotGeometry.length; i++) {
        var g = slotGeometry[i];
        var right = g.left + g.width;
        if (right < scrollLeft - 200 || g.left > scrollLeft + viewport + 200) continue;
        var a = clamp((g.left + g.width / 2 - centerX) / half, -1, 1);
        var ry = Math.sign(a) * Math.pow(Math.abs(a), 1.35) * 34;
        g.face.style.setProperty("--ry", ry.toFixed(2) + "deg");
      }
    }

    function requestTiltUpdate() {
      if (rafId) return;
      rafId = window.requestAnimationFrame(function () { rafId = null; updateTilts(); });
    }

    var wrapping = false;
    function handleLoopScroll() {
      if (repeatCount <= 1 || wrapping) return;
      var segment = shelf.scrollWidth / repeatCount;
      if (shelf.scrollLeft < segment * 0.5) {
        wrapping = true;
        shelf.scrollLeft += segment;
        wrapping = false;
      } else if (shelf.scrollLeft > segment * 1.5) {
        wrapping = true;
        shelf.scrollLeft -= segment;
        wrapping = false;
      }
    }

    shelf.addEventListener("scroll", function () { handleLoopScroll(); requestTiltUpdate(); }, { passive: true });

    shelf.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      stopMomentum();
      shelf.scrollLeft += e.deltaY;
      e.preventDefault();
      e.stopPropagation(); // don't let Lenis's page-level listener also react to this gesture
    }, { passive: false });

    shelf.addEventListener("pointerdown", function (e) {
      stopMomentum();
      dragState = { x: e.clientX, left: shelf.scrollLeft };
      velocityTracker = { lastX: e.clientX, lastT: performance.now(), v: 0 };
    });
    shelf.addEventListener("pointermove", function (e) {
      if (!dragState) return;
      shelf.scrollLeft = dragState.left - (e.clientX - dragState.x);
      var now = performance.now();
      var dt = now - velocityTracker.lastT;
      if (dt > 4) {
        velocityTracker.v = (e.clientX - velocityTracker.lastX) / dt;
        velocityTracker.lastX = e.clientX;
        velocityTracker.lastT = now;
      }
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
      shelf.addEventListener(ev, function () {
        // a natural-feeling deceleration after a drag-release, so letting go
        // of the shelf doesn't just stop dead the way a plain scrollLeft
        // assignment would
        if (dragState && velocityTracker) startMomentum(-velocityTracker.v);
        dragState = null;
        velocityTracker = null;
      });
    });

    new ResizeObserver(function () {
      var overflow = shelf.scrollWidth > shelf.clientWidth + 4;
      fadeL.style.display = overflow ? "" : "none";
      fadeR.style.display = overflow ? "" : "none";
    }).observe(shelf);

    var crossfadeTimer = null;
    var controller = {
      setBooks: function (list, newJustAddedId, opts) {
        opts = opts || {};
        books = list;
        justAddedId = newJustAddedId || null;
        if (opts.animate && shelf.children.length) {
          window.clearTimeout(crossfadeTimer);
          stopMomentum();
          shelf.style.transition = "opacity 0.16s var(--ease-premium)";
          shelf.style.opacity = "0";
          crossfadeTimer = window.setTimeout(function () {
            layout();
            window.requestAnimationFrame(function () { shelf.style.opacity = "1"; });
          }, 160);
        } else {
          layout();
        }
      },
      shelfEl: shelf,
    };

    return controller;
  }

  function buildBookSpineEl(book, handlers) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "book";
    btn.style.width = book.width + "px";
    btn.style.height = book.height + "px";
    btn.setAttribute("aria-label", book.title + " by " + book.author + (book.format === "audiobook" ? " (audiobook)" : ""));

    var showAuthor = book.width >= 44;
    var showPublisher = book.width >= 30;
    var fontSize = clamp(book.width * 0.33, 8.5, 15);
    var isHardcover = book.binding === "hardcover";
    var accent = book.band || book.ink;
    var extras = spineExtras(book);

    var face = document.createElement("span");
    face.className = "book-face";
    face.setAttribute("aria-hidden", "true");
    face.style.transform = "rotateY(var(--ry, -26deg)) rotateZ(" + book.lean + "deg) translateZ(" + book.depth + "px) translateY(0px)";
    face.style.backgroundColor = book.spine;
    face.style.color = book.ink;

    var body = document.createElement("span");
    body.className = "book-body";
    body.style.backgroundColor = book.spine;

    if (book.cover) {
      var img = document.createElement("img");
      img.className = "book-cover-bleed";
      img.src = book.cover;
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      img.addEventListener("error", function () { img.style.display = "none"; });
      body.appendChild(img);
    }

    var tint = document.createElement("span");
    tint.className = "book-tint";
    tint.style.backgroundColor = book.spine;
    body.appendChild(tint);

    var pattern = document.createElement("span");
    pattern.className = "book-pattern";
    pattern.style.opacity = String(book.finish === "cloth" ? 0.34 : 0.2);
    if (extras.patternDots) {
      pattern.style.backgroundImage = "radial-gradient(circle at 2px 2px, " + extras.patternColor + " 1.5px, transparent 1.8px)";
      pattern.style.backgroundSize = "8px 8px";
    } else {
      pattern.style.backgroundImage = "repeating-linear-gradient(45deg, " + extras.patternColor + " 0 2px, transparent 2px 8px)";
    }
    body.appendChild(pattern);

    var bandTop = document.createElement("span");
    bandTop.className = "book-band-line";
    bandTop.style.top = "13px";
    bandTop.style.backgroundColor = accent;
    bandTop.style.opacity = "0.6";
    body.appendChild(bandTop);

    var bandBottom = document.createElement("span");
    bandBottom.className = "book-band-line";
    bandBottom.style.bottom = "30px";
    bandBottom.style.backgroundColor = accent;
    bandBottom.style.opacity = "0.5";
    body.appendChild(bandBottom);

    // hardcovers get thin framing rules around the title, the way a real
    // hardbound classic borders its stamped spine title
    if (isHardcover && book.width >= 34) {
      var ruleTop = document.createElement("span");
      ruleTop.className = "book-rule";
      ruleTop.style.top = "16px";
      ruleTop.style.height = "2px";
      ruleTop.style.backgroundColor = "#d1a949";
      ruleTop.style.boxShadow = "0 1px 0 rgba(0,0,0,0.35)";
      ruleTop.style.opacity = "0.9";
      body.appendChild(ruleTop);

      var ruleBottom = document.createElement("span");
      ruleBottom.className = "book-rule";
      ruleBottom.style.bottom = (showAuthor ? 114 : 34) + "px";
      ruleBottom.style.height = "2px";
      ruleBottom.style.backgroundColor = "#d1a949";
      ruleBottom.style.boxShadow = "0 1px 0 rgba(0,0,0,0.35)";
      ruleBottom.style.opacity = "0.9";
      body.appendChild(ruleBottom);
    }

    var titleEl = document.createElement("span");
    titleEl.className = "book-title-text " + FACE_CLASS[extras.face] +
      (extras.foil ? " is-foil" : "") +
      (extras.italic ? " is-italic" : "") +
      (extras.condensed ? " is-condensed" : "");
    titleEl.style.top = "20px";
    titleEl.style.bottom = (showAuthor ? 118 : 38) + "px";
    // the CSS .is-foil rule needs to own `color` itself (it clips a gold
    // gradient to the text) — an inline color here would beat it, since
    // an element's own inline style always outranks a class rule
    if (!extras.foil) titleEl.style.color = book.ink;
    titleEl.style.fontSize = fontSize + "px";
    titleEl.style.letterSpacing = extras.face === "serif" ? "0.06em" : "0.02em";
    titleEl.style.textTransform = extras.caps ? "uppercase" : "none";
    titleEl.style.fontWeight = extras.face === "sans" ? "700" : "500";
    titleEl.style.opacity = String(0.94 - book.wear * 0.24);
    if (!extras.foil) {
      titleEl.style.textShadow = "0 0.5px 0 rgba(0,0,0,0.35), 0 -0.5px 0 rgba(255,255,255,0.12)";
    }
    var titleSpan = document.createElement("span");
    titleSpan.textContent = book.title;
    titleEl.appendChild(titleSpan);
    body.appendChild(titleEl);

    if (showAuthor) {
      var authorEl = document.createElement("span");
      authorEl.className = "book-author-text";
      authorEl.style.bottom = "34px";
      authorEl.style.height = "84px";
      authorEl.style.color = book.ink;
      authorEl.style.opacity = String(0.62 - book.wear * 0.15);
      authorEl.style.textShadow = "0 0.5px 0 rgba(0,0,0,0.3)";
      var authorSpan = document.createElement("span");
      authorSpan.textContent = book.author;
      authorEl.appendChild(authorSpan);
      body.appendChild(authorEl);
    }

    if (showPublisher && book.publisher) {
      var pubEl = document.createElement("span");
      pubEl.className = "book-publisher-text";
      pubEl.style.color = book.ink;
      pubEl.style.opacity = "0.4";
      var pubSpan = document.createElement("span");
      pubSpan.textContent = book.publisher.split(" ")[0];
      pubEl.appendChild(pubSpan);
      body.appendChild(pubEl);
    }

    var texture = document.createElement("span");
    texture.className = "book-texture";
    texture.style.backgroundImage = FINISH_TEXTURE[book.finish];
    texture.style.opacity = "0.55";
    body.appendChild(texture);

    var sheen = document.createElement("span");
    sheen.className = "book-sheen";
    sheen.style.backgroundImage = FINISH_SHEEN[book.finish];
    body.appendChild(sheen);

    var wear = document.createElement("span");
    wear.className = "book-wear";
    wear.style.backgroundImage = "linear-gradient(180deg, rgba(255,246,224,0.22), rgba(255,246,224,0) 14%), linear-gradient(0deg, rgba(0,0,0,0.16), rgba(0,0,0,0) 8%)";
    wear.style.opacity = String(book.wear);
    body.appendChild(wear);

    var insetShadow = document.createElement("span");
    insetShadow.className = "book-inset-shadow";
    insetShadow.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255," + (0.05 + book.wear * 0.12) + "), inset 0 2px 3px rgba(0,0,0,0.18)";
    body.appendChild(insetShadow);

    if (book.format === "audiobook") {
      var badge = document.createElement("span");
      badge.className = "book-format-badge";
      badge.style.color = book.ink;
      badge.innerHTML = ICON_HEADPHONES;
      body.appendChild(badge);
    }

    face.appendChild(body);

    var side = document.createElement("span");
    side.className = "book-side";
    side.setAttribute("aria-hidden", "true");
    side.style.width = "178px";
    side.style.backgroundColor = book.spine;
    if (book.cover) {
      var sideImg = document.createElement("img");
      sideImg.src = book.cover;
      sideImg.alt = "";
      sideImg.loading = "lazy";
      sideImg.draggable = false;
      sideImg.addEventListener("error", function () { sideImg.style.display = "none"; });
      side.appendChild(sideImg);
    }
    var sideShade = document.createElement("span");
    sideShade.className = "book-side-shade";
    side.appendChild(sideShade);
    face.appendChild(side);

    var top = document.createElement("span");
    top.className = "book-top";
    top.setAttribute("aria-hidden", "true");
    top.style.height = (isHardcover ? 8 : 5) + "px";
    top.style.backgroundImage = "linear-gradient(90deg, #efeae0, #cfc8ba), linear-gradient(0deg, rgba(120,96,60," + (book.wear * 0.5) + "), rgba(120,96,60,0))";
    face.appendChild(top);

    if (isHardcover) {
      var hc = document.createElement("span");
      hc.className = "book-hardcover-band";
      hc.setAttribute("aria-hidden", "true");
      hc.style.backgroundColor = accent;
      hc.style.opacity = "0.85";
      face.appendChild(hc);
    }

    btn.appendChild(face);

    var tooltip = null;
    var hideTimer = null;

    function showHover() {
      window.clearTimeout(hideTimer);
      btn.style.zIndex = "40";
      btn.classList.add("is-hovering");
      face.style.transform = "rotateY(var(--ry, -26deg)) rotateZ(0deg) translateZ(" + (book.depth + 96) + "px) translateY(-26px)";
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "book-tooltip";
        tooltip.setAttribute("aria-hidden", "true");
        var tt = document.createElement("span");
        tt.className = "tt-title font-display";
        tt.textContent = book.title;
        var ta = document.createElement("span");
        ta.className = "tt-author";
        ta.textContent = book.author;
        var tm = document.createElement("span");
        tm.className = "tt-meta";
        tm.textContent = book.year + " · " + (book.format === "audiobook" ? "audiobook" : book.binding === "mass" ? "paperback" : book.binding) + (book.rating ? " · " + book.rating.toFixed(1) + "★" : "");
        tooltip.appendChild(tt);
        tooltip.appendChild(ta);
        tooltip.appendChild(tm);
        var tagBits = [].concat(book.genres || []).slice(0, 2).concat((book.mood || []).slice(0, 2));
        if (tagBits.length) {
          var tg = document.createElement("span");
          tg.className = "tt-genres";
          tg.textContent = tagBits.join(" / ");
          tooltip.appendChild(tg);
        }
        document.body.appendChild(tooltip);
      }
      var rect = btn.getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width / 2) + "px";
      tooltip.style.top = (rect.top - 14) + "px";
      tooltip.style.display = "block";
    }

    function hideHover() {
      hideTimer = window.setTimeout(function () {
        face.style.transform = "rotateY(var(--ry, -26deg)) rotateZ(" + book.lean + "deg) translateZ(" + book.depth + "px) translateY(0px)";
        btn.style.zIndex = "";
        btn.classList.remove("is-hovering");
        if (tooltip) tooltip.style.display = "none";
      }, 90);
    }

    btn.addEventListener("mouseenter", showHover);
    btn.addEventListener("mousemove", showHover);
    btn.addEventListener("mouseleave", hideHover);
    btn.addEventListener("focus", showHover);
    btn.addEventListener("blur", hideHover);
    btn.addEventListener("click", function () {
      hideHover();
      if (tooltip) tooltip.style.display = "none";
      handlers.onSelect();
    });

    return btn;
  }

  // ----------------------------------------------------------------- modal

  var activeModal = null;

  function openModal(list, index, spineEl, shelfController, kind) {
    var rect = spineEl.getBoundingClientRect();
    spineEl.style.visibility = "hidden";
    spineEl.style.opacity = "0";

    var root = document.createElement("div");
    root.className = "modal-root";

    var backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("aria-label", "Close");

    var modalBook = document.createElement("div");
    modalBook.className = "modal-book";
    modalBook.setAttribute("aria-hidden", "true");
    modalBook.style.left = rect.left + "px";
    modalBook.style.top = rect.top + "px";
    modalBook.style.width = rect.width + "px";
    modalBook.style.height = rect.height + "px";
    modalBook.style.transform = "translate3d(0px,0px,0px) scale(1) rotateY(-26deg)";

    var info = document.createElement("div");
    info.className = "modal-info";

    root.appendChild(backdrop);
    root.appendChild(modalBook);
    root.appendChild(info);
    els.modalMount.appendChild(root);

    var closing = false;
    var editingNotes = false;
    var editingMood = false;

    function currentBook() { return list[index % list.length]; }

    function updateCurrentBook(patch) {
      if (!isOwner()) return; // defense in depth — the UI shouldn't offer this path at all
      var book = currentBook();
      Object.assign(book, patch);
      setOverlay(book.id, {
        notes: book.notes != null ? book.notes : undefined,
        mood: book.mood,
        rating: book.rating,
        reading: book.reading,
      });
      // keep the in-memory shelf lists in sync so the tooltip / re-opens see it
      state.allBooks.forEach(function (b) { if (b.id === book.id) Object.assign(b, patch); });
      state.recommendations.forEach(function (b) { if (b.id === book.id) Object.assign(b, patch); });
      if ("reading" in patch) {
        applyFilters();
        renderCurrentlyReading();
      }
    }

    function layoutModal(open) {
      var book = currentBook();
      var vw = window.innerWidth, vh = window.innerHeight;
      var mobile = vw < 720;
      var displayH = Math.min(mobile ? vh * 0.42 : vh * 0.6, 480);
      var scale = displayH / rect.height;
      var sideW = 178 * scale;
      var left = mobile ? (vw - sideW) / 2 : vw * 0.5 - sideW - 28;
      var top = mobile ? vh * 0.08 : (vh - displayH) / 2;
      var dx = left - rect.left;
      var dy = top - rect.top;

      modalBook.style.transform = open
        ? "translate3d(" + dx + "px, " + dy + "px, 0) scale(" + scale + ") rotateY(-90deg)"
        : "translate3d(0px, 0px, 0px) scale(1) rotateY(-26deg)";

      var infoTop = mobile ? top + displayH + 28 : top;
      info.style.left = (mobile ? 24 : left + sideW + 48) + "px";
      info.style.top = infoTop + "px";
      info.style.right = (mobile ? "24px" : Math.max(24, vw * 0.06) + "px");
      info.style.maxHeight = Math.max(220, vh - infoTop - 28) + "px";

      renderModalBookVisual(book);
      renderModalInfo(book);
    }

    function renderModalBookVisual(book) {
      modalBook.innerHTML = "";
      var accent = book.band || book.ink;

      var spineFace = document.createElement("div");
      spineFace.className = "modal-spine-face grain";
      spineFace.style.backgroundColor = book.spine;
      spineFace.style.color = book.ink;

      var shade = document.createElement("span");
      shade.className = "modal-spine-shade";
      spineFace.appendChild(shade);

      var bandTop = document.createElement("span");
      bandTop.className = "modal-band-top";
      bandTop.style.backgroundColor = accent;
      spineFace.appendChild(bandTop);

      var bandBottom = document.createElement("span");
      bandBottom.className = "modal-band-bottom";
      bandBottom.style.backgroundColor = accent;
      spineFace.appendChild(bandBottom);

      var modalExtras = spineExtras(book);
      var titleWrap = document.createElement("span");
      titleWrap.className = "modal-spine-title " + FACE_CLASS[modalExtras.face] +
        (modalExtras.foil ? " is-foil" : "") +
        (modalExtras.italic ? " is-italic" : "");
      titleWrap.style.textTransform = modalExtras.caps ? "uppercase" : "none";
      var titleInner = document.createElement("span");
      titleInner.textContent = book.title;
      titleWrap.appendChild(titleInner);
      spineFace.appendChild(titleWrap);

      var sideFace = document.createElement("div");
      sideFace.className = "modal-side-face grain";
      sideFace.style.backgroundColor = book.spine;
      sideFace.style.color = book.ink;

      if (book.cover) {
        var img = document.createElement("img");
        img.src = book.cover;
        img.alt = "Cover of " + book.title;
        img.draggable = false;
        img.addEventListener("error", function () { img.remove(); sideFace.insertBefore(buildFallback(), sideFace.firstChild); });
        sideFace.appendChild(img);
      } else {
        sideFace.appendChild(buildFallback());
      }
      function buildFallback() {
        var fallback = document.createElement("div");
        fallback.className = "modal-side-fallback";
        var ft = document.createElement("span");
        ft.className = "fb-title font-display";
        ft.textContent = book.title;
        var fa = document.createElement("span");
        fa.className = "fb-author font-mono";
        fa.textContent = book.author;
        fallback.appendChild(ft);
        fallback.appendChild(fa);
        return fallback;
      }
      var sheen = document.createElement("div");
      sheen.className = "modal-side-sheen";
      sideFace.appendChild(sheen);

      var topEdge = document.createElement("div");
      topEdge.className = "modal-top-edge";

      modalBook.appendChild(spineFace);
      modalBook.appendChild(sideFace);
      modalBook.appendChild(topEdge);
    }

    function renderModalInfo(book) {
      info.innerHTML = "";
      var owner = isOwner();

      var status = document.createElement("p");
      status.className = "mi-status";
      status.textContent = book.reading ? "Currently reading"
        : book.recommender ? book.finished
        : (book.finished ? "Finished " + book.finished : "In the collection");
      info.appendChild(status);

      var title = document.createElement("h2");
      title.className = "mi-title font-display";
      title.textContent = book.title;
      info.appendChild(title);

      var author = document.createElement("p");
      author.className = "mi-author font-display";
      author.textContent = book.author;
      info.appendChild(author);

      if (book.blurb) {
        var blurb = document.createElement("p");
        blurb.className = "mi-blurb";
        blurb.textContent = book.blurb;
        info.appendChild(blurb);
      }

      // star rating — editable for the owner, plain display for everyone else
      var rating = document.createElement("p");
      rating.className = "mi-rating" + (owner ? " editable" : "");
      if (owner) {
        for (var i = 1; i <= 5; i++) {
          (function (starValue) {
            var starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.textContent = "★";
            starBtn.className = (book.rating >= starValue) ? "filled" : "";
            starBtn.setAttribute("aria-label", "Rate " + starValue + " star" + (starValue > 1 ? "s" : ""));
            starBtn.addEventListener("click", function () {
              var newRating = book.rating === starValue ? 0 : starValue;
              updateCurrentBook({ rating: newRating });
              renderModalInfo(currentBook());
            });
            rating.appendChild(starBtn);
          })(i);
        }
        if (!book.rating) {
          var unratedTag = document.createElement("span");
          unratedTag.className = "unrated";
          unratedTag.style.marginLeft = "0.6rem";
          unratedTag.textContent = "Tap to rate";
          rating.appendChild(unratedTag);
        }
      } else if (book.rating > 0) {
        rating.textContent = "★".repeat(book.rating);
        var emptyStars = document.createElement("span");
        emptyStars.className = "empty";
        emptyStars.textContent = "★".repeat(5 - book.rating);
        rating.appendChild(emptyStars);
      } else {
        rating.innerHTML = '<span class="unrated">Unrated</span>';
      }
      info.appendChild(rating);

      // format + mood tags
      var tags = document.createElement("div");
      tags.className = "mi-tags";
      var formatTag = document.createElement("span");
      formatTag.className = "mi-tag format";
      formatTag.innerHTML = (book.format === "audiobook" ? ICON_HEADPHONES : ICON_BOOK) + "<span>" + (book.format === "audiobook" ? "Audiobook" : (book.binding === "mass" ? "Paperback" : (book.binding || "Physical"))) + "</span>";
      tags.appendChild(formatTag);
      (book.mood || []).forEach(function (m) {
        var t = document.createElement("span");
        t.className = "mi-tag mood";
        t.textContent = m;
        tags.appendChild(t);
      });
      if (owner) {
        var editMoodBtn = document.createElement("button");
        editMoodBtn.type = "button";
        editMoodBtn.className = "mi-tag";
        editMoodBtn.style.cursor = "pointer";
        editMoodBtn.textContent = editingMood ? "Done" : "+ Mood";
        editMoodBtn.addEventListener("click", function () {
          editingMood = !editingMood;
          renderModalInfo(currentBook());
        });
        tags.appendChild(editMoodBtn);

        var readingBtn = document.createElement("button");
        readingBtn.type = "button";
        readingBtn.className = "mi-tag" + (book.reading ? " reading-active" : "");
        readingBtn.style.cursor = "pointer";
        readingBtn.textContent = book.reading ? "✓ Reading — tap to finish" : "+ Mark as reading";
        readingBtn.addEventListener("click", function () {
          updateCurrentBook({ reading: !book.reading });
          renderModalInfo(currentBook());
        });
        tags.appendChild(readingBtn);
      }
      info.appendChild(tags);

      if (editingMood && owner) {
        var moodPicker = document.createElement("div");
        moodPicker.className = "chip-select";
        moodPicker.style.marginTop = "0.6rem";
        MOOD_TAGS.forEach(function (m) {
          var chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip" + ((book.mood || []).indexOf(m) !== -1 ? " selected" : "");
          chip.textContent = m;
          chip.addEventListener("click", function () {
            var current = (book.mood || []).slice();
            var idx = current.indexOf(m);
            if (idx === -1) current.push(m); else current.splice(idx, 1);
            updateCurrentBook({ mood: current });
            renderMoodPills();
            renderModalInfo(currentBook());
          });
          moodPicker.appendChild(chip);
        });
        info.appendChild(moodPicker);
      }

      // personal notes — editable for the owner; visitors see them read-only
      // (and the section just doesn't render if there's nothing to read yet)
      if (owner || book.notes) {
        var notesWrap = document.createElement("div");
        notesWrap.className = "mi-notes";
        var notesLabel = document.createElement("div");
        notesLabel.className = "notes-label";
        var nlSpan = document.createElement("span");
        nlSpan.textContent = "My thoughts";
        notesLabel.appendChild(nlSpan);
        if (owner && !editingNotes) {
          var editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "notes-edit-btn";
          editBtn.textContent = book.notes ? "Edit" : "+ Add";
          editBtn.addEventListener("click", function () {
            editingNotes = true;
            renderModalInfo(currentBook());
          });
          notesLabel.appendChild(editBtn);
        }
        notesWrap.appendChild(notesLabel);

        if (owner && editingNotes) {
          var textarea = document.createElement("textarea");
          textarea.placeholder = "What did you think of it? Favorite lines, how it made you feel, who you'd recommend it to…";
          textarea.value = book.notes || "";
          notesWrap.appendChild(textarea);
          window.setTimeout(function () { textarea.focus(); }, 0);

          var actions = document.createElement("div");
          actions.className = "notes-form-actions";
          var cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.textContent = "Cancel";
          cancelBtn.addEventListener("click", function () {
            editingNotes = false;
            renderModalInfo(currentBook());
          });
          var saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "save";
          saveBtn.textContent = "Save";
          saveBtn.addEventListener("click", function () {
            updateCurrentBook({ notes: textarea.value.trim() });
            editingNotes = false;
            renderModalInfo(currentBook());
          });
          actions.appendChild(cancelBtn);
          actions.appendChild(saveBtn);
          notesWrap.appendChild(actions);
        } else {
          var notesText = document.createElement("p");
          notesText.className = "notes-text" + (book.notes ? "" : " empty");
          notesText.textContent = book.notes || "Nothing written yet — click “+ Add” to jot down your thoughts.";
          notesWrap.appendChild(notesText);
        }
        info.appendChild(notesWrap);
      }

      var actionsRow = document.createElement("div");
      actionsRow.className = "modal-actions";
      var prev = document.createElement("button");
      prev.type = "button";
      prev.textContent = "← Previous";
      prev.addEventListener("click", function () { go(-1); });
      var next = document.createElement("button");
      next.type = "button";
      next.textContent = "Next →";
      next.addEventListener("click", function () { go(1); });
      var shelveBtn = document.createElement("button");
      shelveBtn.type = "button";
      shelveBtn.className = "shelve-btn";
      shelveBtn.textContent = "Shelve it";
      shelveBtn.addEventListener("click", close);
      actionsRow.appendChild(prev);
      actionsRow.appendChild(next);
      if (owner && kind === "wishlist") {
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "remove-btn";
        removeBtn.textContent = "Remove from wishlist";
        removeBtn.addEventListener("click", function () {
          var b = currentBook();
          state.recommendations = state.recommendations.filter(function (r) { return r.id !== b.id; });
          saveRecommendations(state.recommendations);
          close();
          renderVisitorShelf();
        });
        actionsRow.appendChild(removeBtn);
      }
      actionsRow.appendChild(shelveBtn);
      info.appendChild(actionsRow);
    }

    function go(dir) {
      editingNotes = false;
      editingMood = false;
      index = (index + dir + list.length) % list.length;
      var newSpineEl = shelfController.shelfEl.children[index] && shelfController.shelfEl.children[index].firstChild;
      if (newSpineEl) {
        spineEl.style.visibility = "";
        spineEl.style.opacity = "";
        spineEl = newSpineEl;
        rect = spineEl.getBoundingClientRect();
        spineEl.style.visibility = "hidden";
        spineEl.style.opacity = "0";
        modalBook.style.left = rect.left + "px";
        modalBook.style.top = rect.top + "px";
        modalBook.style.width = rect.width + "px";
        modalBook.style.height = rect.height + "px";
      }
      layoutModal(true);
    }

    function close() {
      if (closing) return;
      closing = true;
      backdrop.classList.remove("show");
      info.classList.remove("show");
      layoutModal(false);
      window.setTimeout(function () {
        spineEl.style.visibility = "";
        spineEl.style.opacity = "";
        root.remove();
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onResize);
        activeModal = null;
        if (activeModalRefresh === refreshInfo) activeModalRefresh = null;
      }, 620);
    }

    function onKey(e) {
      if (document.activeElement && ["INPUT", "TEXTAREA"].indexOf(document.activeElement.tagName) !== -1) {
        if (e.key === "Escape") document.activeElement.blur();
        return;
      }
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    function onResize() { layoutModal(!closing); }

    backdrop.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    activeModal = { close: close };
    function refreshInfo() { renderModalInfo(currentBook()); }
    activeModalRefresh = refreshInfo;

    layoutModal(false);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        backdrop.classList.add("show");
        info.classList.add("show");
        layoutModal(true);
      });
    });
  }

  // ------------------------------------------------------- shared dialog UI

  function buildSegmented(options, value, onChange) {
    var wrap = document.createElement("div");
    wrap.className = "segmented";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = value === opt.value ? "active" : "";
      btn.innerHTML = (opt.icon || "") + "<span>" + opt.label + "</span>";
      btn.addEventListener("click", function () { onChange(opt.value); });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function buildStarPicker(value, onChange) {
    var wrap = document.createElement("div");
    wrap.className = "star-picker";
    for (var i = 1; i <= 5; i++) {
      (function (v) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "★";
        btn.className = value >= v ? "filled" : "";
        btn.addEventListener("click", function () { onChange(value === v ? 0 : v); });
        wrap.appendChild(btn);
      })(i);
    }
    return wrap;
  }

  function buildChipSelect(options, selected, onToggle) {
    var wrap = document.createElement("div");
    wrap.className = "chip-select";
    options.forEach(function (opt) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (selected.indexOf(opt) !== -1 ? " selected" : "");
      chip.textContent = opt;
      chip.addEventListener("click", function () { onToggle(opt); });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  // -------------------------------------------------------- recommend flow

  function openRecommendDialog() {
    var root = document.createElement("div");
    root.className = "dialog-root";
    var backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "dialog-backdrop";
    backdrop.setAttribute("aria-label", "Close");
    var dialog = document.createElement("div");
    dialog.className = "dialog animate-scale-in";
    root.appendChild(backdrop);
    root.appendChild(dialog);
    els.dialogMount.appendChild(root);

    var picked = null;
    var results = [];
    var loading = false;
    var debounceTimer = null;
    var controller = null;
    var recommenderName = "";
    var note = "";
    var submitting = false;
    var errorMsg = null;
    var query = "";

    function close() {
      if (controller) controller.abort();
      window.removeEventListener("keydown", onKey);
      root.remove();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", close);

    var owner = isOwner();

    function render() {
      dialog.innerHTML = "";
      var head = document.createElement("div");
      head.className = "dialog-head";
      var label = document.createElement("p");
      label.className = "dh-label";
      label.textContent = owner ? "Add to wishlist" : "Recommend a book";
      head.appendChild(label);

      if (picked) {
        var pt = document.createElement("p");
        pt.className = "dialog-picked-title font-display";
        pt.textContent = picked.title;
        head.appendChild(pt);
      } else {
        var input = document.createElement("input");
        input.type = "text";
        input.className = "dialog-search-input";
        input.placeholder = "Search by title or author…";
        input.value = query;
        input.addEventListener("input", function (e) { onQuery(e.target.value); });
        head.appendChild(input);
        window.setTimeout(function () { input.focus(); }, 0);
      }
      dialog.appendChild(head);

      if (picked) {
        var form = document.createElement("div");
        form.className = "dialog-form";

        var row = document.createElement("div");
        row.className = "dialog-picked-row";
        var img = document.createElement("img");
        img.src = picked.cover;
        img.alt = "";
        var meta = document.createElement("p");
        meta.className = "dp-meta";
        meta.textContent = picked.author + (picked.year ? " · " + picked.year : "");
        row.appendChild(img);
        row.appendChild(meta);
        form.appendChild(row);

        if (!owner) {
          var nameField = document.createElement("div");
          nameField.className = "field";
          var nameLabel = document.createElement("label");
          var nlSpan = document.createElement("span");
          nlSpan.className = "field-label";
          nlSpan.textContent = "Your name";
          var nameInput = document.createElement("input");
          nameInput.type = "text";
          nameInput.maxLength = 60;
          nameInput.placeholder = "Who's recommending this?";
          nameInput.value = recommenderName;
          nameInput.addEventListener("input", function (e) { recommenderName = e.target.value; submitBtn.disabled = recommenderName.trim().length === 0 || submitting; });
          nameLabel.appendChild(nlSpan);
          nameLabel.appendChild(nameInput);
          nameField.appendChild(nameLabel);
          form.appendChild(nameField);
        }

        var noteField = document.createElement("div");
        noteField.className = "field";
        var noteLabel = document.createElement("label");
        var nfSpan = document.createElement("span");
        nfSpan.className = "field-label";
        nfSpan.textContent = owner ? "Notes (optional)" : "Why should I read it?";
        var noteInput = document.createElement("textarea");
        noteInput.rows = 3;
        noteInput.maxLength = 500;
        noteInput.placeholder = "Optional — a line or two";
        noteInput.value = note;
        noteInput.addEventListener("input", function (e) { note = e.target.value; });
        noteLabel.appendChild(nfSpan);
        noteLabel.appendChild(noteInput);
        noteField.appendChild(noteLabel);
        form.appendChild(noteField);

        if (errorMsg) {
          var err = document.createElement("p");
          err.className = "dialog-error";
          err.textContent = errorMsg;
          form.appendChild(err);
        }

        var footer = document.createElement("div");
        footer.className = "dialog-footer";
        var back = document.createElement("button");
        back.type = "button";
        back.className = "back-link";
        back.textContent = "← Another book";
        back.addEventListener("click", function () { picked = null; errorMsg = null; render(); });
        var submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "submit-btn";
        submitBtn.textContent = submitting ? "Shelving…" : "Send it";
        submitBtn.disabled = (!owner && recommenderName.trim().length === 0) || submitting;
        submitBtn.addEventListener("click", submit);
        footer.appendChild(back);
        footer.appendChild(submitBtn);
        form.appendChild(footer);

        dialog.appendChild(form);
      } else {
        var list = document.createElement("ul");
        list.className = "dialog-results";
        if (loading && results.length === 0) {
          var li = document.createElement("li");
          li.className = "dialog-status";
          li.textContent = "Searching…";
          list.appendChild(li);
        } else if (!loading && query.trim().length >= 2 && results.length === 0) {
          var li2 = document.createElement("li");
          li2.className = "dialog-status";
          li2.textContent = "Nothing found";
          list.appendChild(li2);
        }
        results.forEach(function (r) {
          var li3 = document.createElement("li");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "result-btn";
          var img = document.createElement("img");
          img.src = r.cover;
          img.alt = "";
          img.loading = "lazy";
          var info = document.createElement("span");
          info.className = "rb-info";
          var t = document.createElement("span");
          t.className = "rb-title font-display";
          t.textContent = r.title;
          var a = document.createElement("span");
          a.className = "rb-author";
          a.textContent = r.author + (r.year ? " · " + r.year : "");
          info.appendChild(t);
          info.appendChild(a);
          var pick = document.createElement("span");
          pick.className = "rb-pick";
          pick.textContent = "Pick";
          btn.appendChild(img);
          btn.appendChild(info);
          btn.appendChild(pick);
          btn.addEventListener("click", function () {
            picked = r;
            picked.blurbPromise = fetchOpenLibraryBlurb(r.key);
            render();
          });
          li3.appendChild(btn);
          list.appendChild(li3);
        });
        dialog.appendChild(list);
      }
    }

    function onQuery(v) {
      query = v;
      window.clearTimeout(debounceTimer);
      var q = v.trim();
      if (q.length < 2) { results = []; loading = false; render(); return; }
      loading = true;
      render();
      debounceTimer = window.setTimeout(function () {
        if (controller) controller.abort();
        controller = new AbortController();
        searchOpenLibrary(q, controller.signal).then(function (r) {
          results = r;
          loading = false;
          render();
        }).catch(function (e) {
          if (e.name !== "AbortError") { loading = false; render(); }
        });
      }, 280);
    }

    function submit() {
      if (!picked || (!owner && recommenderName.trim().length === 0) || submitting) return;
      submitting = true;
      errorMsg = null;
      render();

      var basePick = picked;
      Promise.all([extractCoverPalette(basePick.cover), Promise.resolve(basePick.blurbPromise || "")]).then(function (res) {
        var palette = res[0];
        var blurb = res[1] || "";
        var seedBook = Object.assign({ id: (basePick.key || basePick.title).replace(/\W+/g, "-") + "-" + Date.now() }, basePick, palette || {});
        var style = genBookStyle(seedBook);
        var recommender = owner ? "My wishlist" : recommenderName.trim().slice(0, 60);
        var book = normalizeBook(Object.assign({
          id: seedBook.id,
          title: basePick.title,
          author: basePick.author,
          cover: basePick.cover,
          year: basePick.year,
          genres: guessGenres(basePick.subjects),
          blurb: blurb,
          rating: 0,
          finished: owner ? "Want to read" : "Recommended by " + recommender,
          recommender: recommender,
          note: note.trim(),
          publisher: basePick.publisher,
        }, style));
        if (note.trim()) setOverlay(book.id, { notes: note.trim() });

        state.recommendations = [book].concat(state.recommendations);
        saveRecommendations(state.recommendations);
        state.justAddedToReadId = book.id;
        renderVisitorShelf();
        window.setTimeout(function () { state.justAddedToReadId = null; }, 1400);

        submitting = false;
        close();
      }).catch(function () {
        submitting = false;
        errorMsg = "Couldn't shelve that. Try again.";
        render();
      });
    }

    render();
  }

  // -------------------------------------------------------------- add flow

  function openAddBookDialog() {
    if (!isOwner()) return; // defense in depth — the button that calls this is hidden for non-owners
    var root = document.createElement("div");
    root.className = "dialog-root";
    var backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "dialog-backdrop";
    backdrop.setAttribute("aria-label", "Close");
    var dialog = document.createElement("div");
    dialog.className = "dialog animate-scale-in";
    root.appendChild(backdrop);
    root.appendChild(dialog);
    els.dialogMount.appendChild(root);

    var picked = null;
    var results = [];
    var loading = false;
    var debounceTimer = null;
    var controller = null;
    var submitting = false;
    var errorMsg = null;
    var query = "";

    var form = {
      title: "",
      author: "",
      format: "physical",
      rating: 0,
      finished: monthYearNow(),
      genres: [],
      mood: [],
      notes: "",
      reading: false,
    };

    function monthYearNow() {
      return new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }

    function close() {
      if (controller) controller.abort();
      window.removeEventListener("keydown", onKey);
      root.remove();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", close);

    function render() {
      dialog.innerHTML = "";
      var head = document.createElement("div");
      head.className = "dialog-head";
      var label = document.createElement("p");
      label.className = "dh-label";
      label.textContent = "Add a book to the shelf";
      head.appendChild(label);

      if (picked) {
        var pt = document.createElement("p");
        pt.className = "dialog-picked-title font-display";
        pt.textContent = picked.title;
        head.appendChild(pt);
      } else {
        var input = document.createElement("input");
        input.type = "text";
        input.className = "dialog-search-input";
        input.placeholder = "Search by title or author…";
        input.value = query;
        input.addEventListener("input", function (e) { onQuery(e.target.value); });
        head.appendChild(input);
        window.setTimeout(function () { input.focus(); }, 0);
      }
      dialog.appendChild(head);

      if (!picked) {
        var list = document.createElement("ul");
        list.className = "dialog-results";
        if (loading && results.length === 0) {
          var li = document.createElement("li");
          li.className = "dialog-status";
          li.textContent = "Searching…";
          list.appendChild(li);
        } else if (!loading && query.trim().length >= 2 && results.length === 0) {
          var li2 = document.createElement("li");
          li2.className = "dialog-status";
          li2.textContent = "Nothing found — you can still enter it by hand below.";
          list.appendChild(li2);
          list.appendChild(manualEntryRow());
        }
        results.forEach(function (r) {
          var li3 = document.createElement("li");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "result-btn";
          var img = document.createElement("img");
          img.src = r.cover;
          img.alt = "";
          img.loading = "lazy";
          var info = document.createElement("span");
          info.className = "rb-info";
          var t = document.createElement("span");
          t.className = "rb-title font-display";
          t.textContent = r.title;
          var a = document.createElement("span");
          a.className = "rb-author";
          a.textContent = r.author + (r.year ? " · " + r.year : "");
          info.appendChild(t);
          info.appendChild(a);
          var pick = document.createElement("span");
          pick.className = "rb-pick";
          pick.textContent = "Pick";
          btn.appendChild(img);
          btn.appendChild(info);
          btn.appendChild(pick);
          btn.addEventListener("click", function () { choose(r); });
          li3.appendChild(btn);
          list.appendChild(li3);
        });
        dialog.appendChild(list);
        return;
      }

      var scroller = document.createElement("div");
      scroller.className = "dialog-form";

      var row = document.createElement("div");
      row.className = "dialog-picked-row";
      var img = document.createElement("img");
      img.src = picked.cover || "";
      img.alt = "";
      if (!picked.cover) img.style.visibility = "hidden";
      var meta = document.createElement("p");
      meta.className = "dp-meta";
      meta.textContent = "From Open Library — double-check the fields below";
      row.appendChild(img);
      row.appendChild(meta);
      scroller.appendChild(row);

      scroller.appendChild(field("Title", textInput(form.title, function (v) { form.title = v; })));
      scroller.appendChild(field("Author", textInput(form.author, function (v) { form.author = v; })));

      var fieldRow = document.createElement("div");
      fieldRow.className = "field-row";

      var formatField = document.createElement("div");
      formatField.className = "field";
      formatField.appendChild(fieldLabel("Format"));
      formatField.appendChild(buildSegmented([
        { value: "physical", label: "Physical", icon: ICON_BOOK },
        { value: "audiobook", label: "Audiobook", icon: ICON_HEADPHONES },
      ], form.format, function (v) { form.format = v; render(); }));
      fieldRow.appendChild(formatField);

      var ratingField = document.createElement("div");
      ratingField.className = "field";
      ratingField.appendChild(fieldLabel("Your rating"));
      ratingField.appendChild(buildStarPicker(form.rating, function (v) { form.rating = v; render(); }));
      fieldRow.appendChild(ratingField);
      scroller.appendChild(fieldRow);

      var statusField = document.createElement("div");
      statusField.className = "field";
      statusField.appendChild(fieldLabel("Status"));
      statusField.appendChild(buildSegmented([
        { value: false, label: "Finished" },
        { value: true, label: "Currently reading" },
      ], form.reading, function (v) { form.reading = v; render(); }));
      scroller.appendChild(statusField);

      if (!form.reading) {
        scroller.appendChild(field("Finished", textInput(form.finished, function (v) { form.finished = v; }, "e.g. Jul 2026")));
      }

      var genreField = document.createElement("div");
      genreField.className = "field";
      genreField.appendChild(fieldLabel("Genre"));
      genreField.appendChild(buildChipSelect(GENRE_ORDER_FALLBACK, form.genres, function (g) {
        var idx = form.genres.indexOf(g);
        if (idx === -1) form.genres.push(g); else form.genres.splice(idx, 1);
        render();
      }));
      scroller.appendChild(genreField);

      var moodField = document.createElement("div");
      moodField.className = "field";
      moodField.appendChild(fieldLabel("Mood"));
      moodField.appendChild(buildChipSelect(MOOD_TAGS, form.mood, function (m) {
        var idx = form.mood.indexOf(m);
        if (idx === -1) form.mood.push(m); else form.mood.splice(idx, 1);
        render();
      }));
      scroller.appendChild(moodField);

      var notesField = document.createElement("div");
      notesField.className = "field";
      var notesLbl = document.createElement("label");
      var nfSpan = document.createElement("span");
      nfSpan.className = "field-label";
      nfSpan.textContent = "Your thoughts (optional)";
      var notesArea = document.createElement("textarea");
      notesArea.rows = 3;
      notesArea.maxLength = 800;
      notesArea.placeholder = "Anything you want to remember about it";
      notesArea.value = form.notes;
      notesArea.addEventListener("input", function (e) { form.notes = e.target.value; });
      notesLbl.appendChild(nfSpan);
      notesLbl.appendChild(notesArea);
      notesField.appendChild(notesLbl);
      scroller.appendChild(notesField);

      if (errorMsg) {
        var err = document.createElement("p");
        err.className = "dialog-error";
        err.textContent = errorMsg;
        scroller.appendChild(err);
      }

      var footer = document.createElement("div");
      footer.className = "dialog-footer";
      var back = document.createElement("button");
      back.type = "button";
      back.className = "back-link";
      back.textContent = "← Another book";
      back.addEventListener("click", function () { picked = null; errorMsg = null; render(); });
      var submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "submit-btn";
      submitBtn.textContent = submitting ? "Shelving…" : "Add to shelf";
      submitBtn.disabled = form.title.trim().length === 0 || form.author.trim().length === 0 || submitting;
      submitBtn.addEventListener("click", submit);
      footer.appendChild(back);
      footer.appendChild(submitBtn);
      scroller.appendChild(footer);

      dialog.appendChild(scroller);
    }

    function field(labelText, control) {
      var f = document.createElement("div");
      f.className = "field";
      f.appendChild(fieldLabel(labelText));
      f.appendChild(control);
      return f;
    }
    function fieldLabel(text) {
      var span = document.createElement("span");
      span.className = "field-label";
      span.textContent = text;
      return span;
    }
    function textInput(value, onInput, placeholder) {
      var input = document.createElement("input");
      input.type = "text";
      input.value = value;
      if (placeholder) input.placeholder = placeholder;
      input.addEventListener("input", function (e) { onInput(e.target.value); submitBtnGuard(); });
      return input;
    }
    function submitBtnGuard() {
      var btn = dialog.querySelector(".submit-btn");
      if (btn) btn.disabled = form.title.trim().length === 0 || form.author.trim().length === 0 || submitting;
    }
    function manualEntryRow() {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "result-btn";
      btn.style.justifyContent = "center";
      var span = document.createElement("span");
      span.className = "rb-pick";
      span.textContent = "Enter manually →";
      btn.appendChild(span);
      btn.addEventListener("click", function () {
        choose({ title: query.trim(), author: "", year: 0, cover: "", publisher: "", pages: 300, subjects: [] });
      });
      li.appendChild(btn);
      return li;
    }

    function choose(r) {
      picked = r;
      form.title = r.title || "";
      form.author = r.author || "";
      form.genres = guessGenres(r.subjects);
      picked.blurbPromise = r.key ? fetchOpenLibraryBlurb(r.key) : Promise.resolve("");
      render();
    }

    function onQuery(v) {
      query = v;
      window.clearTimeout(debounceTimer);
      var q = v.trim();
      if (q.length < 2) { results = []; loading = false; render(); return; }
      loading = true;
      render();
      debounceTimer = window.setTimeout(function () {
        if (controller) controller.abort();
        controller = new AbortController();
        searchOpenLibrary(q, controller.signal).then(function (r) {
          results = r;
          loading = false;
          render();
        }).catch(function (e) {
          if (e.name !== "AbortError") { loading = false; render(); }
        });
      }, 280);
    }

    function submit() {
      if (!picked || form.title.trim().length === 0 || form.author.trim().length === 0 || submitting) return;
      submitting = true;
      errorMsg = null;
      render();

      var coverPromise = picked.cover ? extractCoverPalette(picked.cover) : Promise.resolve(null);
      Promise.all([coverPromise, Promise.resolve(picked.blurbPromise || "")]).then(function (res) {
        var palette = res[0];
        var blurb = res[1] || "";
        var id = (form.title + "-" + Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        var seedBook = Object.assign({ id: id, pages: picked.pages }, palette || {});
        var style = genBookStyle(seedBook);
        var book = normalizeBook(Object.assign({
          id: id,
          title: form.title.trim(),
          author: form.author.trim(),
          cover: picked.cover || "",
          year: picked.year || null,
          genres: form.genres.length ? form.genres : guessGenres(picked.subjects),
          mood: form.mood,
          blurb: blurb,
          rating: form.rating,
          finished: form.reading ? null : (form.finished.trim() || monthYearNow()),
          publisher: picked.publisher || "",
          format: form.format,
          reading: form.reading,
        }, style));
        if (form.notes.trim()) setOverlay(book.id, { notes: form.notes.trim() });

        var added = loadAddedBooks();
        added.unshift(book);
        saveAddedBooks(added);
        rebuildAllBooks();
        renderGenrePills();
        renderMoodPills();
        renderFormatPills();
        if (form.reading) {
          renderCurrentlyReading();
          applyFilters();
        } else {
          state.justAddedMainId = book.id;
          applyFilters(book.id);
          window.setTimeout(function () { state.justAddedMainId = null; }, 1400);
        }

        submitting = false;
        close();
      }).catch(function () {
        submitting = false;
        errorMsg = "Couldn't add that book. Try again.";
        render();
      });
    }

    render();
  }

  // ---------------------------------------------------------------- shelves

  var mainShelf = createShelfController(els.mainShelfMount, "owned");
  var toReadShelf = null;
  var readingShelf = null;

  function renderVisitorShelf() {
    if (state.recommendations.length === 0) {
      els.visitorSection.hidden = true;
      return;
    }
    els.visitorSection.hidden = false;
    els.toReadCount.textContent = state.recommendations.length + " " + (state.recommendations.length === 1 ? "book" : "books");
    if (!toReadShelf) {
      toReadShelf = createShelfController(els.toReadShelfMount, "wishlist");
    }
    toReadShelf.setBooks(state.recommendations, state.justAddedToReadId);
    observeReveal(els.visitorSection);
  }

  function renderCurrentlyReading() {
    if (!els.readingSection) return;
    var list = state.allBooks.filter(function (b) { return b.reading; });
    if (list.length === 0) {
      els.readingSection.hidden = true;
      return;
    }
    els.readingSection.hidden = false;
    if (!readingShelf) {
      readingShelf = createShelfController(els.readingShelfMount, "reading");
    }
    readingShelf.setBooks(list);
    observeReveal(els.readingSection);
  }

  // ------------------------------------------------------------------ init

  // GSAP-driven reveal when available (a proper eased tween instead of a
  // single CSS keyframe), falling back to the plain CSS animation if the
  // CDN script didn't load for some reason — never leave content stuck
  // invisible because a third-party script failed.
  function playReveal(el) {
    if (!el || el.dataset.revealed) return;
    el.dataset.revealed = "1";
    // shelves render up to ~450+ tripled spine elements for the infinite
    // scroll loop, but only ~15-20 are ever actually on screen at reveal
    // time — animating all of them at once (tried first) hit a real
    // Chromium compositing edge case where the shelf silently never got
    // its post-animation repaint and stayed blank until the next
    // hover/click forced one. Scoping the stagger to just the
    // currently-visible spines sidesteps it and is the right amount of
    // work anyway, since the rest are off-screen.
    var allBookEls = el.querySelectorAll(".book");
    var visibleBooks = Array.prototype.filter.call(allBookEls, function (b) {
      var r = b.getBoundingClientRect();
      return r.right > -40 && r.left < window.innerWidth + 40;
    });
    if (window.gsap && allBookEls.length) {
      // shelves get their spines cascading into place one after another,
      // rather than the whole section (all ~50+ spines at once) doing one
      // uniform blur-fade — the header text still gets the normal reveal.
      // `el` itself still needs its own opacity cleared here too: the
      // ".reveal" CSS class starts every section at opacity:0, and that
      // was only ever lifted by the old single fromTo(el, ...) below —
      // skipping it left the whole section permanently invisible even
      // though its child spines were individually fine.
      window.gsap.set(el, { opacity: 1 });
      window.gsap.set(allBookEls, { opacity: 1 });
      var header = el.querySelector(".shelf-header");
      if (header) {
        window.gsap.fromTo(header,
          { opacity: 0, y: 18, filter: "blur(10px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, ease: "power3.out" }
        );
      }
      window.gsap.fromTo(visibleBooks,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: { each: 0.02, from: "start" } }
      );
    } else if (window.gsap) {
      // a soft blur-to-sharp entrance (the react-bits "BlurText" look),
      // built with plain GSAP so it works without React/shadcn
      window.gsap.fromTo(el,
        { opacity: 0, y: 18, filter: "blur(10px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, ease: "power3.out" }
      );
    } else {
      el.classList.add("in");
    }
  }

  function revealSoon(el, delay) {
    window.setTimeout(function () { playReveal(el); }, delay);
  }

  // below-the-fold sections animate in as they're scrolled into view,
  // rather than all firing at once on load — a small thing, but it's the
  // difference between a page that feels alive while you scroll and one
  // that just dumps everything on you immediately
  function observeReveal(el) {
    if (!el || el.dataset.revealed) return;
    if (!("IntersectionObserver" in window)) { playReveal(el); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          playReveal(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    io.observe(el);
  }

  // Lenis smooths the page's own vertical scroll (inertia/easing on wheel
  // and trackpad) — separate from the shelf's own horizontal drag/momentum
  // physics, which keeps its native scrollLeft-based approach untouched.
  // Synced to ScrollTrigger's clock so the parallax below tracks Lenis's
  // eased position instead of the raw (jumpier) native scroll.
  function initSmoothScroll() {
    if (!window.Lenis) return;
    var lenis = new window.Lenis({ duration: 1.05, smoothWheel: true });
    if (window.ScrollTrigger) {
      lenis.on("scroll", function () { window.ScrollTrigger.update(); });
    }
    function raf(time) {
      lenis.raf(time);
      window.requestAnimationFrame(raf);
    }
    window.requestAnimationFrame(raf);
  }

  // scroll-tied parallax: the hero's title fades/blurs/drifts down as the
  // page scrolls it out of view, tied to the scrollbar (scrub) rather than
  // a fixed-duration animation — the react-bits-style hero effect, built
  // with plain GSAP + ScrollTrigger so it doesn't need React
  function initHeroParallax() {
    if (!window.gsap || !window.ScrollTrigger || !els.heroReveal) return;
    window.gsap.registerPlugin(window.ScrollTrigger);
    var targets = els.heroReveal.querySelectorAll(".eyebrow, .hero-title");
    if (!targets.length) return;
    window.gsap.to(targets, {
      y: 70,
      opacity: 0,
      filter: "blur(6px)",
      ease: "none",
      scrollTrigger: {
        trigger: els.heroReveal,
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });
  }

  function init() {
    runCursiveTitle();
    renderGenrePills();
    renderMoodPills();
    renderFormatPills();
    renderActiveChips();
    initFilterPanel();
    applyFilters();
    renderCurrentlyReading();
    renderVisitorShelf();
    initSmoothScroll();
    initHeroParallax();
    els.recommendBtn.addEventListener("click", openRecommendDialog);
    els.addBookBtn.addEventListener("click", openAddBookDialog);
    if (els.siteNameBtn) {
      els.siteNameBtn.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      if (window.gsap) {
        window.gsap.fromTo(
          els.siteNameBtn,
          { opacity: 0, y: -10, letterSpacing: "0.1em" },
          { opacity: 1, y: 0, letterSpacing: "0.28em", duration: 1.1, delay: 0.15, ease: "power2.out" }
        );
      }
    }
    if (els.heroReveal) revealSoon(els.heroReveal, 30);
    if (els.shelfReveal) revealSoon(els.shelfReveal, 220);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
